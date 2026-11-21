"""Train a local 4-bit LoRA adapter on explicitly liked desktop responses."""
import argparse
import json
import os
import uuid
from pathlib import Path


def liked_pairs(turns, votes):
    question = None
    previous = None
    index = 0
    for turn in turns:
        role = turn.get("role")
        if role == "user":
            question = turn.get("content") if not turn.get("previewImages") else None
        elif role == "assistant":
            turns_question = question
            answer = turn.get("content")
            if (votes.get(str(index)) == "좋아요" and isinstance(question, str) and question.strip()
                    and isinstance(answer, str) and answer.strip()
                    and not any(turn.get(k) for k in ("image", "untrusted", "sourceOutput"))):
                if previous and votes.get(str(index - 1)) == "별로예요" and any(
                        marker in question for marker in ("아니", "말고", "정정", "고쳐", "다시", "내 말은", "뜻이야")):
                    original, rejected = previous
                    question = f"이전 요청: {original}\n이전 응답: {rejected}\n사용자의 교정: {question}"
                yield question, answer
            previous = (turns_question, answer) if turns_question and isinstance(answer, str) and not any(turn.get(k) for k in ("image", "untrusted", "sourceOutput")) else None
            question = None
            index += 1


def samples():
    prefs = Path(os.environ["LOCALAPPDATA"]) / "LocalGemmaDesktop/preferences.json"
    if not prefs.exists():
        return []
    chats = {}
    for key, vote in json.loads(prefs.read_text("utf-8-sig")).get("ratings", {}).items():
        chat, _, index = key.partition("/")
        try:
            if str(uuid.UUID(chat)) != chat or not index.isdecimal():
                continue
        except ValueError:
            continue
        chats.setdefault(chat, {})[index] = vote
    pairs = []
    for chat, votes in chats.items():
        path = Path(__file__).parent / "대화기록" / (chat + ".json")
        if path.exists():
            pairs.extend(liked_pairs(json.loads(path.read_text("utf-8-sig")), votes))
    return pairs


def train(base, output, pairs):
    import torch
    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
    from transformers import AutoConfig, AutoModelForCausalLM, AutoModelForImageTextToText, AutoTokenizer, BitsAndBytesConfig

    tokenizer = AutoTokenizer.from_pretrained(base, local_files_only=True)
    batches = []
    for question, answer in pairs:
        messages = [dict(role="user", content=question)]
        prefix = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        full = tokenizer.apply_chat_template(messages + [dict(role="assistant", content=answer)], tokenize=False)
        ids = tokenizer(full, add_special_tokens=False).input_ids
        prompt_ids = tokenizer(prefix, add_special_tokens=False).input_ids
        if ids[:len(prompt_ids)] == prompt_ids and len(prompt_ids) < len(ids) <= 2048:
            batches.append((ids, len(prompt_ids)))
    if not batches:
        raise SystemExit("No eligible examples within 2048 tokens with a matching chat template.")
    config = AutoConfig.from_pretrained(base, local_files_only=True)
    loader = AutoModelForImageTextToText if hasattr(config, "vision_config") else AutoModelForCausalLM
    quant = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype=torch.bfloat16)
    model = loader.from_pretrained(base, device_map={"": 0}, quantization_config=quant, local_files_only=True)
    model = prepare_model_for_kbit_training(model)
    model = get_peft_model(model, LoraConfig(r=8, lora_alpha=16, target_modules=["q_proj", "v_proj"], task_type="CAUSAL_LM"))
    model.train()
    optimizer = torch.optim.AdamW((p for p in model.parameters() if p.requires_grad), lr=0.0001)
    for ids, prompt_length in batches:
        inputs = torch.tensor([ids], device=model.device)
        labels = inputs.clone()
        labels[:, :prompt_length] = -100
        loss = model(input_ids=inputs, labels=labels, use_cache=False).loss
        if not torch.isfinite(loss):
            raise ValueError("Non-finite training loss")
        loss.backward()
        optimizer.step()
        optimizer.zero_grad()
    output.mkdir(parents=True, exist_ok=False)
    model.save_pretrained(output)
    print(f"Saved adapter from {len(batches)} examples to {output}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", type=Path, help="Local Transformers checkpoint directory")
    parser.add_argument("--output", type=Path, help="New adapter directory")
    args = parser.parse_args()
    pairs = samples()
    print(f"Eligible liked text pairs: {len(pairs)}")
    if args.base or args.output:
        if not (args.base and args.output and args.base.is_dir() and not args.output.exists() and pairs):
            parser.error("Training needs a local base checkpoint, a new output path, and liked answers.")
        train(args.base, args.output, pairs)
