# Skill: Inference Endpoint Deploy

Procedure for deploying a validated model to a HF Inference Endpoint.
Used by the Execution Agent (tier 3) — only after the Evaluator passed the
model and tier 1/2 were ruled out (sensitive data, GPU need, scheduled load).

## Preconditions
- Scorecard exists in `evals/model_scorecards/` with all gates passed
- HF account has billing enabled (PRO/Team)
- `HF_TOKEN` with write scope in `configs/hf_config.env`

## Steps
1. **Size the instance:** smallest that fits — check param count × dtype.
   Rule of thumb: 2 bytes/param (fp16) + 20% headroom. Prefer `int8`/`awq`
   variants to drop a tier.
2. **Deploy:** `python scripts/deploy_endpoint.py <repo_id> --name <task-name>`
   — defaults to `scale-to-zero` so idle time costs nothing.
3. **Smoke test:** run the Builder's fixtures through the endpoint URL before
   declaring it live; first call after scale-to-zero takes 1–4 min (cold start).
4. **Record:** endpoint name, instance type, $/hour, and projected monthly cost
   into the run record. Cost projection = rate × expected active hours.
5. **Tear down** (`--delete`) if this was a test run. Endpoints left running
   are the #1 source of surprise bills.

## Rules
- Scale-to-zero ON by default; always-on requires a written cost justification
  in the run record.
- One endpoint per task, named for the task (`voicemail-asr`), not the model.
- Models needing `trust_remote_code` run ONLY here or in a sandbox — never local
  on production machines.
