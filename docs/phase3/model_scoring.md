# Model Scoring Framework

Every Hugging Face model is scored **before** use. This is the Evaluator Agent's
checklist (stage 4 of the [core agent workflow](agent_workflow.md)) whenever a
candidate is a model — as opposed to an MCP Space, which has its own lighter checks.

> **Hard rule:** Do not deploy a Hugging Face model just because it has high
> downloads. Validate task fit, license, and runtime first. Downloads measure
> popularity, not suitability — a 10M-download chat model is still the wrong
> tool for reading invoices.

## The 12 Score Areas

Each area scores 0–2 (0 = fail, 1 = acceptable, 2 = strong). Areas marked **GATE**
are pass/fail: a 0 disqualifies the model no matter how well it scores elsewhere.

| # | Score area | What to check | How to check (HF MCP) |
|---|-----------|---------------|----------------------|
| 1 | **Task match** — GATE | Does it actually solve the requested task? Pipeline tag matches the task spec; examples in the card resemble our use case | `hub_repo_details` → pipeline tag, card examples |
| 2 | Downloads | Is it actively used? (>10k/mo strong, >1k acceptable, near-zero is a flag) | `hub_repo_search` sorted by downloads |
| 3 | Likes | Community signal — corroborates downloads, catches astroturfed repos | `hub_repo_search` / `hub_repo_details` |
| 4 | Last updated | Is it stale? Updated within 12 months strong; >24 months with open issues is a flag | `hub_repo_details` → lastModified |
| 5 | **License** — GATE | Can we use it commercially? Apache-2.0/MIT = 2; OpenRAIL/Llama-style = 1 (read terms); NC/research-only/no license = 0 | `hub_repo_details` → license tag; read the actual LICENSE file if nonstandard |
| 6 | Model card | Are limitations documented? Intended use, known failure modes, training data described | `hub_repo_details` → card content |
| 7 | **Files** — GATE | Are weights/config/tokenizer actually present? (Some repos are empty shells or pointers) | `hub_repo_details` / `hf_hub_query` → file listing: `*.safetensors`, `config.json`, tokenizer files |
| 8 | Pipeline support | Does it work with the Transformers `pipeline()` API? (Means standard, low-maintenance integration) | Pipeline tag present + library_name `transformers` |
| 9 | Endpoint compatibility | Can it run in production — HF Inference Endpoints, TGI/vLLM support, or a deployable Space? | `hub_repo_details` → inference status; `hf_doc_search` for endpoint support |
| 10 | **Custom code** — GATE (soft) | Does it require `trust_remote_code=True`? That executes the author's Python on our machines — higher risk. Only acceptable from major, verifiable orgs | Card + config mention of trust_remote_code |
| 11 | Benchmarks | Are eval results shown? Numbers on standard benchmarks, ideally with comparisons | Card eval section; `paper_search` for the accompanying paper |
| 12 | Hardware cost | Can it run cheaply? Param count + quantized variants available; fits free tier / CPU / small GPU | `hub_repo_details` → size, quantization tags (gguf, awq, int8) |

## Scoring

- **Maximum:** 24 points (12 areas × 2)
- **Deploy threshold:** ≥ 16 **and** all four GATE areas (task match, license,
  files, custom code) at 1 or better
- **15 and below:** use the Evaluator's fallback candidate or return to Research (stage 3)
- **Custom-code exception:** `trust_remote_code=True` from an unknown author is an
  automatic disqualify. From a major org (Microsoft, Qwen, NVIDIA, etc.) it scores 1
  and the Execution Agent must run it in an isolated tier (HF endpoint or sandbox),
  never on production infra

## How this feeds the Evaluator rubric

The 12 areas roll up into the five weighted axes from the workflow spec:

| Evaluator axis | Fed by score areas |
|----------------|--------------------|
| Fit (30%) | 1 task match, 11 benchmarks |
| Cost (25%) | 12 hardware cost, 9 endpoint compatibility |
| Reliability (20%) | 2 downloads, 3 likes, 4 last updated, 6 model card, 7 files, 8 pipeline support |
| Privacy (15%) | 10 custom code, plus the workflow's privacy gate |
| Speed (10%) | 12 hardware cost (latency side), 9 endpoint compatibility |

## Worked example — scoring `openai/whisper-large-v3` for voicemail transcription

| Area | Score | Note |
|------|-------|------|
| Task match | 2 | automatic-speech-recognition, exactly the task |
| Downloads | 2 | Millions/month |
| Likes | 2 | Thousands |
| Last updated | 2 | Actively maintained |
| License | 2 | Apache-2.0 — commercial OK |
| Model card | 2 | Limitations, languages, WER documented |
| Files | 2 | safetensors + config + tokenizer + processor |
| Pipeline support | 2 | `pipeline("automatic-speech-recognition")` |
| Endpoint compatibility | 2 | Inference Endpoints one-click; many Spaces |
| Custom code | 2 | No trust_remote_code |
| Benchmarks | 2 | WER on Common Voice et al. in card + paper |
| Hardware cost | 1 | large-v3 wants a GPU; turbo/distil variants exist for CPU |
| **Total** | **23/24** | Deploy — all gates pass |

Score sheets for evaluated models live in `docs/phase3/reports/` alongside the
business reports.
