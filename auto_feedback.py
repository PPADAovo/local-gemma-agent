"""Local-only feedback training. Run watch, smoke, or apply RUN."""
import argparse
import hashlib
import html
import json
import logging
import os
import subprocess
import time
from pathlib import Path
from datetime import datetime
import msvcrt

os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1")
from feedback_training import samples

ROOT = Path(os.environ["LOCALAPPDATA"]) / "LocalGemmaDesktop/training"
BASE = ROOT / "base"
PROBES = [
    ("매주 화요일 3시에 알려줘. 이 일정으로 알림 문구를 만들어줘.", "화요일과 3시를 반영하고 시각을 다시 묻지 않는가?"),
    ("어제 이야기한 그 파일을 보내줘.", "어떤 파일인지 확인하고 전송을 완료했다고 주장하지 않는가?"),
    ("사과가 7개 있고 3개를 먹었다. 몇 개 남았어?", "4개라고 답하는가?"),
]
def write(path, value):
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(value, encoding="utf-8")
    temp.replace(path)

def digest(pairs):
    return hashlib.sha256(json.dumps(pairs, ensure_ascii=False).encode()).hexdigest()

def ollama_busy():
    """Ollama에 모델이 올라가 있으면(대화 중이거나 30분 유지 중) 학습이 VRAM을 빼앗지 않게 미룹니다."""
    import urllib.request
    try:
        with urllib.request.urlopen("http://127.0.0.1:11434/api/ps", timeout=2) as res:
            return bool(json.loads(res.read().decode("utf-8")).get("models"))
    except Exception:
        return False

def free_gpu():
    if ollama_busy():
        return False
    raw =subprocess.check_output(["nvidia-smi","--query-gpu=memory.free,utilization.gpu","--format=csv,noheader,nounits"],text=True)
    free, used = map(int, raw.splitlines()[0].split(","))
    return free >= 4096 and used < 15

def run(pairs, smoke=False):
    import torch
    from transformers import AutoTokenizer, AutoModelForCausalLM, BitsAndBytesConfig
    from peft import prepare_model_for_kbit_training, get_peft_model, LoraConfig
    torch.manual_seed(42)
    tok = AutoTokenizer.from_pretrained(BASE,local_files_only=True)
    model = AutoModelForCausalLM.from_pretrained(BASE,local_files_only=True,device_map={"":0},
        quantization_config=BitsAndBytesConfig(load_in_4bit=True,bnb_4bit_quant_type="nf4",bnb_4bit_compute_dtype=torch.bfloat16))
    model = get_peft_model(prepare_model_for_kbit_training(model),LoraConfig(r=8,lora_alpha=16,target_modules=["q_proj","v_proj"],task_type="CAUSAL_LM"))
    def encode(q,a=None):
        msgs=[{"role":"user","content":q}]
        if a is not None: msgs.append({"role":"assistant","content":a})
        return tok.apply_chat_template(msgs,add_generation_prompt=a is None,return_tensors="pt").to(model.device)
    def answers():
        model.eval()
        with torch.no_grad():
            out=[]
            for q,_ in PROBES:
                ids=encode(q)
                seq=model.generate(ids,attention_mask=torch.ones_like(ids),do_sample=False,max_new_tokens=64,pad_token_id=tok.eos_token_id)
                out.append(tok.decode(seq[0,ids.shape[1]:],skip_special_tokens=True))
            return out
    before=answers()
    model.train()
    opt=torch.optim.AdamW((p for p in model.parameters() if p.requires_grad),lr=1e-4)
    losses=[]
    for q,a in pairs:
        ids=encode(q,a)
        prefix=encode(q)
        n=prefix.shape[1]
        if ids.shape[1]>2048 or ids.shape[1]<=n or not torch.equal(ids[:,:n],prefix): continue
        labels=ids.clone()
        labels[:,:n]=-100
        loss=model(input_ids=ids,labels=labels,use_cache=False).loss
        if not torch.isfinite(loss): raise ValueError("Non-finite training loss")
        loss.backward()
        opt.step()
        opt.zero_grad()
        losses.append(loss.item())
    if not losses: raise ValueError("No eligible examples under 2048 tokens")
    after=answers()
    folder=ROOT/("smoke" if smoke else "runs")/datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    folder.mkdir(parents=True)
    model.save_pretrained(folder/"adapter")
    result=dict(base="Qwen2.5-0.5B-Instruct",smoke=smoke,steps=len(losses),loss=losses,
                comparisons=[dict(question=q,criterion=c,before=x,after=y) for (q,c),x,y in zip(PROBES,before,after)])
    write(folder/"result.json",json.dumps(result,ensure_ascii=False,indent=2))
    rows="".join("<h3>"+html.escape(r["question"])+"</h3><p>"+html.escape(r["criterion"])+"</p><b>원본</b><pre>"+html.escape(r["before"])+"</pre><b>훈련 후</b><pre>"+html.escape(r["after"])+"</pre>" for r in result["comparisons"])
    write(folder/"비교.html",'<meta charset="utf-8"><style>body{font:16px system-ui;max-width:800px;margin:40px auto}pre{white-space:pre-wrap}</style><h1>훈련 전후 답변</h1><p>'+str(len(losses))+'회 업데이트 · 학습 손실 '+str(round(sum(losses)/len(losses),4))+'</p>'+rows)
    print(folder,flush=True)
    return folder

def watch():
    lock=(ROOT/"watch.lock").open("a+b")
    lock.seek(0)
    try: msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
    except OSError: return
    targets = [("batch", ROOT/"trained.json"), ("batch35", ROOT/"trained35.json")]
    while True:
        for action,state in targets:
            try:
                pairs=sorted(set(samples()))
                hashes={digest(pair) for pair in pairs}
                previous=set(json.loads(state.read_text()) if state.exists() else [])
                if len(hashes-previous)>=4 and free_gpu():
                    subprocess.run([sys.executable,__file__,action],check=True)
                    write(state,json.dumps(sorted(hashes)))
            except Exception: logging.exception("Automatic training failed: %s",action)
        time.sleep(60)

def apply(folder):
    from transformers import AutoModelForCausalLM,AutoTokenizer
    from peft import PeftModel
    import tempfile
    with tempfile.TemporaryDirectory(dir=ROOT) as tmp:
        path=Path(tmp)
        model=AutoModelForCausalLM.from_pretrained(BASE,local_files_only=True,dtype="float32")
        PeftModel.from_pretrained(model,folder/"adapter").merge_and_unload().save_pretrained(path)
        AutoTokenizer.from_pretrained(BASE).save_pretrained(path)
        subprocess.run([sys.executable,str(ROOT/"convert.py"),str(path),"--outfile",str(path/"model.gguf"),"--outtype","f16"],check=True)
        (path/"Modelfile").write_text("FROM ./model.gguf\n",encoding="utf-8")
        subprocess.run(["ollama","create","feedback-qwen:"+folder.name,"-f","Modelfile"],cwd=path,check=True)

if __name__=="__main__":
    import sys
    parser=argparse.ArgumentParser()
    parser.add_argument("action",choices=["watch","smoke","batch","batch35","apply"])
    parser.add_argument("folder",nargs="?",type=Path)
    args=parser.parse_args()
    logging.basicConfig(filename=ROOT/"training.log",level=logging.INFO)
    if args.action=="watch": watch()
    elif args.action=="batch35":
        from feedback35 import train
        train(sorted(set(samples())))
    elif args.action=="apply":
        if json.loads((args.folder/"result.json").read_text("utf8")).get("method")=="output_norm":
            from feedback35 import apply as apply35
            apply35(args.folder)
        else: apply(args.folder)
    elif args.action=="smoke": run([("세 글자로 인사해 줘.","안녕해"),("10에서 2를 빼면?","8입니다.")],True)
    else: run(sorted(set(samples())))
