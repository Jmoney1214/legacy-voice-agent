#!/usr/bin/env python3
"""Execution stage (tier 2/3): run a test inference via the HF Inference API
or a deployed endpoint, and record latency.

Usage:
  python run_inference.py openai/whisper-large-v3 --task automatic-speech-recognition \
      --input ../evals/test_documents/voicemail_01.mp3
  python run_inference.py sentence-transformers/all-MiniLM-L6-v2 --task feature-extraction \
      --text "smoky scotch under 60 dollars"
  python run_inference.py voicemail-asr --endpoint-url https://xxx.endpoints.huggingface.cloud \
      --task automatic-speech-recognition --input sample.mp3
"""
import argparse
import json
import os
import sys
import time
from pathlib import Path

from huggingface_hub import InferenceClient

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / "configs" / "hf_config.env")
except ImportError:
    pass


def main():
    p = argparse.ArgumentParser(description="Run one inference and report output + latency")
    p.add_argument("model", help="repo_id, or endpoint name when --endpoint-url is set")
    p.add_argument("--task", required=True)
    p.add_argument("--input", help="path to input file (audio/image/document)")
    p.add_argument("--text", help="text input (for text tasks / embeddings)")
    p.add_argument("--endpoint-url", help="use a dedicated Inference Endpoint instead of serverless")
    args = p.parse_args()

    token = os.environ.get("HF_TOKEN")
    if not token:
        sys.exit("HF_TOKEN not set — copy configs/hf_config.env.example to hf_config.env")

    client = InferenceClient(model=args.endpoint_url or args.model, token=token)
    data = Path(args.input).read_bytes() if args.input else None

    t0 = time.perf_counter()
    if args.task == "automatic-speech-recognition":
        result = client.automatic_speech_recognition(data)
    elif args.task in ("image-classification", "zero-shot-image-classification"):
        result = client.image_classification(data)
    elif args.task == "image-segmentation":
        result = client.image_segmentation(data)
    elif args.task == "feature-extraction":
        result = client.feature_extraction(args.text)
        result = f"embedding dim={len(result[0]) if hasattr(result[0], '__len__') else len(result)}"
    elif args.task == "image-text-to-text":
        result = client.chat_completion(
            messages=[{"role": "user", "content": [
                {"type": "text", "text": args.text or "Extract vendor, date, line items, total as JSON."},
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{__import__('base64').b64encode(data).decode()}"}},
            ]}], max_tokens=1024,
        ).choices[0].message.content
    else:
        sys.exit(f"task {args.task!r} not wired up yet — add a branch here")
    latency = time.perf_counter() - t0

    record = {
        "model": args.model, "task": args.task,
        "input": args.input or args.text, "latency_s": round(latency, 2),
        "output": result if isinstance(result, (str, int, float)) else json.loads(json.dumps(result, default=str)),
    }
    print(json.dumps(record, indent=2, default=str))


if __name__ == "__main__":
    main()
