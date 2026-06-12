#!/usr/bin/env python3
"""Research stage: find model candidates for a task.

Usage:
  python search_hf_models.py --task automatic-speech-recognition --limit 5
  python search_hf_models.py --task image-segmentation --query "background removal"
"""
import argparse
from datetime import datetime, timezone

from huggingface_hub import HfApi


def main():
    p = argparse.ArgumentParser(description="Search HF Hub for model candidates")
    p.add_argument("--task", required=True, help="HF pipeline tag, e.g. automatic-speech-recognition")
    p.add_argument("--query", default=None, help="optional keyword search alongside the tag")
    p.add_argument("--limit", type=int, default=5)
    p.add_argument("--sort", default="downloads", choices=["downloads", "likes", "trending_score"])
    args = p.parse_args()

    api = HfApi()
    models = api.list_models(
        pipeline_tag=args.task,
        search=args.query,
        sort=args.sort,
        limit=args.limit,
        expand=["downloads", "likes", "lastModified", "tags"],
    )

    now = datetime.now(timezone.utc)
    print(f"{'repo_id':<48} {'downloads':>10} {'likes':>6} {'age_days':>8}  license")
    print("-" * 100)
    for m in models:
        license_tags = [t.split(":", 1)[1] for t in (m.tags or []) if t.startswith("license:")]
        age = (now - m.last_modified).days if m.last_modified else -1
        custom = "  [CUSTOM CODE]" if "custom_code" in (m.tags or []) else ""
        print(
            f"{m.id:<48} {m.downloads or 0:>10} {m.likes or 0:>6} {age:>8}  "
            f"{','.join(license_tags) or '?'}{custom}"
        )

    print("\nNext: score candidates with  python evaluate_model.py <repo_id> --task " + args.task)


if __name__ == "__main__":
    main()
