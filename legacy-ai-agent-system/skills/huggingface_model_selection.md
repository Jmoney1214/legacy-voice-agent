# Skill: Hugging Face Model Selection

Procedure for finding model candidates for a task spec. Used by the HF Research Agent.

## Steps
1. **Tag search:** `hub_repo_search` with `repo_types: ["model"]`,
   `filters: ["<pipeline_tag>"]`, `sort: downloads`, limit 10.
2. **Keyword search:** repeat with 2–3 plain-language queries (e.g. for
   `automatic-speech-recognition`: "speech to text", "transcription", "whisper") —
   authors mistag models constantly.
3. **Trending check:** one more pass with `sort: trendingScore` — catches strong
   new releases the downloads sort buries.
4. **Detail pull:** `hub_repo_details` on the union (usually 8–15 repos):
   license, lastModified, file list, card.
5. **Cut to 3–5:** drop empty-shell repos (no weights), dead licenses, and
   >24-month-stale entries unless nothing newer exists. Keep at least one
   major-org candidate (openai, google, microsoft, meta-llama, Qwen, nvidia…).
6. **Hardware note per survivor:** param count, quantized variants
   (gguf/awq/int8 tags), whether the HF Inference API serves it.

## Anti-patterns
- Picking by downloads alone (the hard rule exists because of this).
- Trusting the pipeline tag without reading a card example.
- Ignoring distil/turbo/quantized variants — for a small business the smaller
  variant is usually the right answer.
