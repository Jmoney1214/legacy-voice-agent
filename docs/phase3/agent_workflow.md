# Phase 3 — Core Agent Workflow

The standard pipeline every business automation task runs through, from "Jay asks for something"
to "a working, validated tool with a plain-English report." Eight agents, each with one job,
each handing a structured artifact to the next.

```
1. User Task --> 2. Planner --> 3. HF Research --> 4. Evaluator
                                                        |
8. Business Report <-- 7. Validator <-- 6. Execution <-- 5. Builder
```

## The 8 Stages

### 1. User gives task
Jay (or staff) states a business goal in plain English. No technical framing required.

> "I want supplier voicemails turned into text and logged."
> "Clean up this Lightspeed export — half the descriptions have junk characters."
> "Can we auto-remove backgrounds from bottle photos for flyers?"

### 2. OpenAI Planner Agent — interprets the business goal
**Model:** GPT-4o-mini (same account as the Vapi stack)

Translates the request into a machine-readable task spec:

| Field | Example |
|-------|---------|
| `task_type` | `audio_transcription` |
| `input` | `.mp3 voicemail files from Twilio` |
| `output` | `text rows in Supabase call_logs` |
| `constraints` | `cost < $5/mo, latency < 60s, no PII leaves trusted infra` |
| `success_criteria` | `>= 90% word accuracy on a 5-voicemail test set` |

The planner also decides which **tool category** the task falls in (see category map below).

### 3. HF Research Agent — searches models/datasets/Spaces
**Tools:** Hugging Face MCP — `hub_repo_search`, `space_search` (mcp=true), `paper_search`,
`hf_doc_search`, `hub_repo_details`

Given the task spec, returns 3–5 candidates per lane:
- **Models** — for self-hosted or Inference Endpoint deployment
- **MCP-enabled Spaces** — zero-setup, callable today via `dynamic_space`
- **Datasets** — only when evaluation/fine-tuning data is needed

Each candidate is recorded with: repo ID, likes/downloads, last update, license,
hardware needs, and a one-line fit note.

### 4. Evaluator Agent — scores options
Scores every candidate 1–5 on five axes, weighted for a small retail business:

| Axis | Weight | What it measures |
|------|--------|------------------|
| Fit | 30% | Does it actually do the task end-to-end? |
| Cost | 25% | Free Space / cheap endpoint / GPU rental? |
| Reliability | 20% | Maintained? Popular? Stable author? |
| Privacy | 15% | OK to send this data to a community Space? |
| Speed | 10% | Fast enough for the workflow it feeds? |

**Privacy gate (hard rule):** customer PII and vendor financials never go to
community/hackathon Spaces — those tasks must use official Spaces (hf-audio, not-lain),
paid Inference Endpoints, or local execution.

Output: a ranked shortlist with one recommended primary and one fallback.

### 5. Builder Agent — creates test code/workflow
Builds the smallest thing that can prove the choice works:
- a `dynamic_space` invocation (no code at all), or
- a script in `tools/` (Python/JS) calling the model/endpoint, or
- an n8n workflow draft, or a Cloudflare Worker route

Always includes a **test fixture**: 3–5 real samples (a voicemail, a bottle photo,
a messy CSV slice) and the expected output for each.

### 6. Execution Agent — runs local/HF/endpoint job
Runs the test in the cheapest viable environment, escalating only if needed:

| Tier | When | Cost |
|------|------|------|
| 1. MCP Space (`dynamic_space`) | Default for non-sensitive data | Free |
| 2. Local script (this repo / Claude Code session) | Data cleaning, CSV work, anything Python can do | Free |
| 3. HF Jobs / Inference Endpoint | Sensitive data, heavy models, scheduled runs | Pay-per-use (requires PRO + Jobs tool enabled in HF MCP settings) |
| 4. Cloudflare Worker / n8n | Production integration after validation passes | Existing infra |

Captures raw outputs, runtime, and any errors.

### 7. Validator Agent — checks result
Compares actual output against the success criteria from step 2:
- correctness on the test fixtures (exact or judged-by-LLM)
- latency and cost within constraints
- edge-case behavior (empty input, weird formats)

Verdict: **PASS** (go to 8), **RETRY** (back to 5 with the fallback candidate),
or **ESCALATE** (back to 2 — the goal needs reframing). Max two retries before escalating.

### 8. Business Agent — final decision/report
Translates the technical result back into Jay's language. Every report answers:

1. **What we tested** — one sentence
2. **Did it work** — yes/no + the test numbers
3. **What it costs** — per month, in dollars
4. **What to do next** — adopt / adopt with caveat / keep looking
5. **How to use it** — one paragraph or a link to the workflow

Reports land in `docs/phase3/reports/` and (optionally) Slack `#instagram-content`.

## Tool Category Map

The Planner routes tasks to these pre-vetted lanes (researched 2026-06; the Research
Agent re-verifies freshness on every run):

| Category | Business use | Primary tool | Tier |
|----------|-------------|--------------|------|
| OCR | Invoices, receipts, purchase orders | `prithivMLmods/Multimodal-OCR` | Space |
| Background removal | Product images, flyers | `not-lain/background-removal` | Space |
| Image classification | Bottle/product recognition | `prithivMLmods/SAM3-Demo` + `atalaydenknalbant/DINOv3` | Space |
| Audio transcription | Event calls, supplier voicemails | `hf-audio/whisper-large-v3` | Space |
| Document extraction | Vendor statements, PDFs | `prithivMLmods/VLM-Parsing` | Space |
| Data cleaning | Excel/CSV cleanup | Local Python (no Space — none worth using) | Local |
| Embedding/search | Store knowledge base | Supabase pgvector (existing project `rffvoreqcpkqqxwprosg`) | Existing infra |

## Worked Example — "Transcribe supplier voicemails"

1. **Task:** "Turn supplier voicemails into text and log them."
2. **Planner:** `audio_transcription`; input = mp3 from voicemail; output = Supabase row;
   constraints: < $5/mo, supplier names spelled right; success: 90% accuracy on 5 samples.
3. **Research:** finds `hf-audio/whisper-large-v3` (official, 846 likes, MCP-enabled),
   `openai/whisper-large-v3-turbo` model (for endpoint lane), 2 hackathon Spaces.
4. **Evaluator:** whisper-large-v3 Space scores 4.6 (official author passes privacy gate);
   hackathon Spaces rejected on Reliability + Privacy. Fallback: turbo model on an endpoint.
5. **Builder:** `dynamic_space` invocation + 5 sample voicemails with hand-checked transcripts.
6. **Execution:** Tier 1 — runs all 5 through the Space. 4–9s each, $0.
7. **Validator:** 93% word accuracy; one brand name ("Buffalo Trace") correct in 5/5. PASS.
8. **Business report:** "Voicemail transcription works, free, ~10 seconds per message.
   Next step: wire it into n8n so every voicemail auto-logs to Supabase. No monthly cost."

## Ground Rules

- **One stage, one artifact.** Each agent's output is the next agent's full input —
  no hidden context.
- **Cheapest tier first.** Never rent a GPU for a job a free Space or a Python script can do.
- **Privacy gate is non-negotiable.** PII and financials stay on trusted infra.
- **Two retries, then escalate.** Don't loop forever; reframe the goal instead.
- **Every run ends with a report Jay can read in 60 seconds.**
