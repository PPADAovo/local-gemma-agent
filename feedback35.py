"""Fit the final RMSNorm of the installed GGUF using teacher-forced hidden states."""
import contextlib
import hashlib
import html
import json
import os
import secrets
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

import gguf
import numpy as np

ROOT = Path(os.environ["LOCALAPPDATA"]) / "LocalGemmaDesktop/training"
MODEL = "qwen3.5:35b"

def source():
    spec = subprocess.check_output(["ollama","show","--modelfile",MODEL],encoding="utf8")
    files = [Path(line[5:].strip('"')) for line in spec.splitlines() if line.startswith("FROM ")]
    return spec, max(files,key=lambda p:p.stat().st_size)

@contextlib.contextmanager
def server(model):
    exe = Path(shutil.which("ollama")).parent/"lib/ollama/llama-server.exe"
    with socket.socket() as sock:
        sock.bind(("127.0.0.1",0))
        port = sock.getsockname()[1]
    token = secrets.token_hex(24)
    def api(endpoint, body=None):
        req = urllib.request.Request(f"http://127.0.0.1:{port}/"+endpoint,
            data=json.dumps(body).encode() if body is not None else None,
            headers={"Authorization":"Bearer "+token,"Content-Type":"application/json"})
        with urllib.request.urlopen(req,timeout=300) as response:
            return json.load(response)
    with (ROOT/"35b-server.log").open("w",encoding="utf8") as log:
        proc = subprocess.Popen([str(exe),"-m",str(model),"--host","127.0.0.1","--port",str(port),
            "--api-key",token,"-c","1024","-np","1","-ngl","0","--embedding","--pooling","none","--embd-normalize","-1"],
            stdout=subprocess.DEVNULL,stderr=log,creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            for _ in range(300):
                if proc.poll() is not None: raise RuntimeError("35B server failed: see 35b-server.log")
                try:
                    api("health")
                    break
                except (urllib.error.URLError, TimeoutError): time.sleep(1)
            else: raise TimeoutError("35B startup")
            yield api
        finally:
            proc.terminate()
            proc.wait()

def train(pairs, smoke=False):
    _, path = source()
    tensors={t.name:t for t in gguf.GGUFReader(path).tensors}
    output=tensors["output.weight"]
    norm=tensors["output_norm.weight"].data.copy()
    scale=np.ones_like(norm)
    rng=np.random.default_rng(2026)
    history=[]
    def example(api,q,a):
        def tokens(s):
            return api("tokenize",{"content":s,"add_special":False,"parse_special":True})["tokens"]
        prefix=tokens("<|im_start|>user\n"+q+"<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n")
        answer=tokens(a+"<|im_end|>")
        if not prefix or not answer or len(prefix)+len(answer)>1024: return None
        ids=prefix+answer[:-1]
        vec=np.asarray(api("embedding",{"content":ids})[0]["embedding"],dtype=np.float32)
        if vec.shape!=(len(ids),len(norm)): raise ValueError(f"Unexpected embeddings {vec.shape}")
        hidden=vec[len(prefix)-1:]
        vocab=np.unique(np.concatenate((answer,rng.integers(0,output.data.shape[0],size=512))))
        weights=gguf.dequantize(output.data[vocab],output.tensor_type)
        return hidden,weights,np.searchsorted(vocab,answer)
    def objective(ex):
        h,w,y=ex
        scores=(h*scale)@w.T
        scores-=scores.max(axis=1,keepdims=True)
        probs=np.exp(scores)
        probs/=probs.sum(axis=1,keepdims=True)
        loss=-np.log(np.maximum(probs[np.arange(len(y)),y],1e-30)).mean()
        probs[np.arange(len(y)),y]-=1
        grad=((probs@w)*h).mean(axis=0)
        return float(loss),grad
    with server(path) as api:
        probe=example(api,"5에서 2를 빼면?","3입니다.")
        before,_=objective(probe)
        for q,a in pairs:
            ex=example(api,q,a)
            if ex is None: continue
            loss,g=objective(ex)
            scale-=0.00015*g/(np.sqrt(np.mean(g*g))+1e-8)
            np.clip(scale,0.97,1.03,out=scale)
            history.append(loss)
        after,_=objective(probe)
    updated=norm*scale
    if not history or not np.isfinite(updated).all() or np.array_equal(updated,norm): raise ValueError("No valid weight update")
    folder=ROOT/("smoke" if smoke else "runs")/("35b-"+datetime.now().strftime("%Y%m%d-%H%M%S-%f"))
    folder.mkdir(parents=True)
    np.save(folder/"output_norm.npy",updated,allow_pickle=False)
    report=dict(base=MODEL,source=path.name,method="output_norm",steps=len(history),loss=history,
                changed=int(np.count_nonzero(updated!=norm)),probe_before=before,probe_after=after)
    (folder/"비교.html").write_text(f'<meta charset="utf-8"><h1>Qwen3.5 35B 출력층 학습</h1><p>업데이트 {len(history)}회 · 변경된 가중치 {report["changed"]:,}개</p><p>고정 산술 예제의 후보 토큰 교차 엔트로피 (낮을수록 좋음): {before:.6f} → {after:.6f}</p><p>이 수치는 전체 대화 성능을 측정하지 않습니다.</p>',encoding="utf8")
    (folder/"result.json").write_text(json.dumps(report,indent=2),encoding="utf8")
    print(folder,flush=True)

def apply(folder):
    spec,src=source()
    report=json.loads((folder/"result.json").read_text())
    if report["source"]!=src.name: raise ValueError("Base model changed")
    with tempfile.TemporaryDirectory(dir=ROOT) as tmp:
        dest=Path(tmp)/"model.gguf"
        shutil.copyfile(src,dest)
        reader=gguf.GGUFReader(dest,"r+")
        tensor=next(t for t in reader.tensors if t.name=="output_norm.weight")
        tensor.data[:]=np.load(folder/"output_norm.npy",allow_pickle=False)
        tensor.data.flush()
        del tensor,reader
        (Path(tmp)/"Modelfile").write_text(spec.replace("FROM "+str(src),"FROM ./model.gguf"),encoding="utf8")
        subprocess.run(["ollama","create","feedback-qwen:"+folder.name,"-f","Modelfile"],cwd=tmp,check=True)
