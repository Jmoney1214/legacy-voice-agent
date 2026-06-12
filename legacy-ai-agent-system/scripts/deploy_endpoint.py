#!/usr/bin/env python3
"""Execution stage (tier 3): deploy a VALIDATED model to a HF Inference Endpoint.

Preconditions (see skills/inference_endpoint_deploy.md):
  - scorecard in evals/model_scorecards/ says DEPLOYABLE
  - HF account has billing (PRO/Team); HF_TOKEN has write scope

Usage:
  python deploy_endpoint.py openai/whisper-large-v3-turbo --name voicemail-asr
  python deploy_endpoint.py --name voicemail-asr --status
  python deploy_endpoint.py --name voicemail-asr --delete
"""
import argparse
import os
import sys
from pathlib import Path

from huggingface_hub import HfApi

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / "configs" / "hf_config.env")
except ImportError:
    pass


def main():
    p = argparse.ArgumentParser(description="Deploy/inspect/delete a HF Inference Endpoint")
    p.add_argument("model", nargs="?", help="repo_id to deploy")
    p.add_argument("--name", required=True, help="endpoint name — name it for the TASK, not the model")
    p.add_argument("--instance", default="x4", help="instance size (default x4 = small)")
    p.add_argument("--instance-type", default="intel-icl", help="e.g. intel-icl (cpu), nvidia-t4 (gpu)")
    p.add_argument("--accelerator", default="cpu", choices=["cpu", "gpu"])
    p.add_argument("--status", action="store_true")
    p.add_argument("--delete", action="store_true")
    args = p.parse_args()

    token = os.environ.get("HF_TOKEN")
    if not token:
        sys.exit("HF_TOKEN not set — copy configs/hf_config.env.example to hf_config.env")
    api = HfApi(token=token)

    if args.status:
        ep = api.get_inference_endpoint(args.name)
        print(f"{ep.name}: {ep.status} — {ep.url or 'no url yet'}")
        return
    if args.delete:
        api.delete_inference_endpoint(args.name)
        print(f"deleted endpoint {args.name!r} — no further billing")
        return
    if not args.model:
        sys.exit("model repo_id required to deploy")

    ep = api.create_inference_endpoint(
        name=args.name,
        repository=args.model,
        framework="pytorch",
        accelerator=args.accelerator,
        instance_size=args.instance,
        instance_type=args.instance_type,
        region="us-east-1",
        vendor="aws",
        type="protected",
        min_replica=0,          # scale-to-zero: idle time costs nothing
        max_replica=1,
        scale_to_zero_timeout=15,
    )
    print(f"deploying {args.model} as {ep.name!r} (scale-to-zero ON, 15 min idle timeout)")
    print("first call after idle takes 1-4 min (cold start)")
    ep.wait(timeout=600)
    print(f"ready: {ep.url}")
    print(f"smoke-test now:  python run_inference.py {args.name} "
          f"--endpoint-url {ep.url} --task <task> --input <fixture>")
    print(f"tear down when done:  python deploy_endpoint.py --name {args.name} --delete")


if __name__ == "__main__":
    main()
