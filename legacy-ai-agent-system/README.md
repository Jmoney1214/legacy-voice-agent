# Legacy AI Agent System

A Hugging Face agentic system for Legacy Wine & Liquor. Implements the
[Phase 3 core agent workflow](../docs/phase3/agent_workflow.md): plain-English
business tasks go in, validated ML tooling and a 60-second business report come out.

## Layout

| Directory | Contents |
|-----------|----------|
| `agents/` | One prompt/spec per pipeline agent (Planner → … → Business Report) |
| `skills/` | Reusable procedures agents load on demand (model selection, card audit, endpoint deploy) |
| `workflows/` | Per-use-case YAML pipelines (image classification, document extraction, …) |
| `scripts/` | Runnable Python: search, score, infer, deploy |
| `evals/` | Test fixtures, benchmark results, model scorecards |
| `configs/` | MCP server config + env templates (real `.env` files are gitignored) |

## Quick start

```bash
pip install huggingface_hub python-dotenv pyyaml

cp configs/hf_config.env.example configs/hf_config.env       # add your HF token
cp configs/openai_config.env.example configs/openai_config.env

# 1. Research: find candidates for a task
python scripts/search_hf_models.py --task automatic-speech-recognition --limit 5

# 2. Evaluate: score a candidate (12-area framework, writes a scorecard)
python scripts/evaluate_model.py openai/whisper-large-v3 --task automatic-speech-recognition

# 3. Execute: run a test inference via the HF Inference API
python scripts/run_inference.py openai/whisper-large-v3 --input evals/test_documents/sample.mp3

# 4. Deploy (only after a PASS verdict)
python scripts/deploy_endpoint.py openai/whisper-large-v3 --name voicemail-asr
```

## Rules of the system

1. **Score before use.** Every model goes through `evaluate_model.py`
   (the [12-area framework](../docs/phase3/model_scoring.md)) before any inference
   on real business data. Gates: task match, license, files, custom code.
2. **Cheapest tier first.** MCP Space → local → endpoint. Never rent a GPU for
   a job a free Space can do.
3. **Privacy gate.** Customer PII and vendor financials never go to community
   Spaces — official Spaces, paid endpoints, or local only.
4. **Every run leaves a record** — scorecard in `evals/model_scorecards/`,
   row in `evals/benchmark_results.csv`, report for Jay.
