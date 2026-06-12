#!/usr/bin/env python3
"""Evaluator stage: score a model on the 12-area framework
(docs/phase3/model_scoring.md) and write a scorecard.

Usage:
  python evaluate_model.py openai/whisper-large-v3 --task automatic-speech-recognition

Exit code 0 = deployable (score >= 16, all gates pass), 1 = rejected.
Heuristic areas (endpoint compat, benchmarks) deserve a human/agent re-check —
see skills/model_card_audit.md.
"""
import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from huggingface_hub import HfApi, ModelCard

COMMERCIAL_OK = {"apache-2.0", "mit", "bsd-3-clause", "bsd-2-clause", "cc-by-4.0", "gpl-3.0"}
COMMERCIAL_READ_TERMS = {"openrail", "creativeml-openrail-m", "llama2", "llama3", "llama3.1",
                         "llama3.2", "gemma", "bigscience-openrail-m"}
MAJOR_ORGS = {"openai", "google", "microsoft", "meta-llama", "facebook", "qwen", "nvidia",
              "mistralai", "stabilityai", "sentence-transformers", "baai", "hf-audio"}
GATES = {"task_match", "license", "files", "custom_code"}


def score_model(repo_id: str, task: str) -> dict:
    api = HfApi()
    info = api.model_info(repo_id, files_metadata=True)
    tags = set(info.tags or [])
    files = [s.rfilename for s in (info.siblings or [])]
    s, notes = {}, {}

    # 1. Task match (GATE)
    s["task_match"] = 2 if info.pipeline_tag == task else 0
    notes["task_match"] = f"pipeline_tag={info.pipeline_tag!r} vs requested {task!r}"

    # 2. Downloads / 3. Likes
    dl, likes = info.downloads or 0, info.likes or 0
    s["downloads"] = 2 if dl > 10_000 else 1 if dl > 1_000 else 0
    s["likes"] = 2 if likes > 100 else 1 if likes > 10 else 0
    notes["downloads"], notes["likes"] = f"{dl}/month", str(likes)

    # 4. Last updated
    age = (datetime.now(timezone.utc) - info.last_modified).days if info.last_modified else 9999
    s["last_updated"] = 2 if age < 365 else 1 if age < 730 else 0
    notes["last_updated"] = f"{age} days ago"

    # 5. License (GATE)
    lic = next((t.split(":", 1)[1] for t in tags if t.startswith("license:")), None)
    s["license"] = 2 if lic in COMMERCIAL_OK else 1 if lic in COMMERCIAL_READ_TERMS else 0
    notes["license"] = lic or "NONE — disqualified"

    # 6. Model card
    try:
        card = ModelCard.load(repo_id).text.lower()
        documented = any(k in card for k in ("limitation", "intended use", "out-of-scope"))
        s["model_card"] = 2 if documented and len(card) > 1500 else 1 if len(card) > 300 else 0
        notes["model_card"] = f"{len(card)} chars, limitations documented: {documented}"
    except Exception as e:
        card, s["model_card"], notes["model_card"] = "", 0, f"no card ({e.__class__.__name__})"

    # 7. Files (GATE): weights + config present
    has_weights = any(re.search(r"\.(safetensors|bin|gguf|onnx|h5|msgpack)$", f) for f in files)
    has_config = "config.json" in files
    has_tok = any("tokenizer" in f or f.endswith((".model", "vocab.json")) or "processor" in f
                  for f in files)
    s["files"] = 2 if (has_weights and has_config and has_tok) else 1 if (has_weights and has_config) else 0
    notes["files"] = f"weights={has_weights} config={has_config} tokenizer/processor={has_tok}"

    # 8. Pipeline support
    is_tf = "transformers" in tags or info.library_name == "transformers"
    s["pipeline_support"] = 2 if (is_tf and info.pipeline_tag) else 1 if info.pipeline_tag else 0
    notes["pipeline_support"] = f"library={info.library_name}, tag={info.pipeline_tag}"

    # 9. Endpoint compatibility (heuristic)
    s["endpoint_compat"] = 2 if (is_tf and any(f.endswith(".safetensors") for f in files)) else 1 if is_tf else 0
    notes["endpoint_compat"] = "heuristic: transformers + safetensors — verify on deploy"

    # 10. Custom code (GATE, soft)
    needs_custom = "custom_code" in tags
    org = repo_id.split("/")[0].lower()
    s["custom_code"] = 2 if not needs_custom else (1 if org in MAJOR_ORGS else 0)
    notes["custom_code"] = ("not required" if not needs_custom
                            else f"trust_remote_code required — author {org!r} "
                                 + ("(major org: isolated tiers only)" if org in MAJOR_ORGS
                                    else "(unknown author: DISQUALIFIED)"))

    # 11. Benchmarks
    has_eval = bool(getattr(info, "model_index", None)) or "model-index" in tags
    mentions = any(b in card for b in ("wer", "accuracy", "f1", "benchmark", "leaderboard", "mmlu"))
    s["benchmarks"] = 2 if has_eval else 1 if mentions else 0
    notes["benchmarks"] = f"model-index={has_eval}, card mentions evals={mentions}"

    # 12. Hardware cost (from weight size)
    gb = sum(x.size or 0 for x in (info.siblings or [])
             if re.search(r"\.(safetensors|bin|gguf)$", x.rfilename)) / 1e9
    s["hardware_cost"] = 2 if 0 < gb < 1 else 1 if gb < 8 else 0
    notes["hardware_cost"] = f"~{gb:.1f} GB of weights"

    total = sum(s.values())
    gates_ok = all(s[g] >= 1 for g in GATES)
    return {
        "repo_id": repo_id, "task": task, "date": datetime.now(timezone.utc).date().isoformat(),
        "scores": s, "notes": notes, "total": total, "max": 24,
        "gates_passed": gates_ok,
        "verdict": "DEPLOYABLE" if (total >= 16 and gates_ok) else "REJECTED",
    }


def main():
    p = argparse.ArgumentParser(description="Score a HF model (12-area framework)")
    p.add_argument("repo_id")
    p.add_argument("--task", required=True, help="HF pipeline tag the business task needs")
    p.add_argument("--out", default=str(Path(__file__).parent.parent / "evals" / "model_scorecards"))
    args = p.parse_args()

    card = score_model(args.repo_id, args.task)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{card['date']}_{args.repo_id.replace('/', '__')}.json"
    out.write_text(json.dumps(card, indent=2))

    print(f"\n{card['repo_id']} — {card['total']}/24 — gates {'PASS' if card['gates_passed'] else 'FAIL'}"
          f" — {card['verdict']}\n")
    for area, sc in card["scores"].items():
        gate = " [GATE]" if area in GATES else ""
        print(f"  {sc}  {area:<18}{gate:<8} {card['notes'][area]}")
    print(f"\nScorecard: {out}")
    sys.exit(0 if card["verdict"] == "DEPLOYABLE" else 1)


if __name__ == "__main__":
    main()
