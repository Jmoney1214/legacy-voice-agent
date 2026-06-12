# Skill: Space Tool Selection

Procedure for finding MCP-enabled Spaces. Used by the HF Research Agent.
Spaces are the default execution tier (free, zero setup), so this lane runs first.

## Steps
1. `space_search` with `mcp: true` and the task in plain language, limit 6–10.
2. Score author trust:
   - **Official org** (hf-audio, an org behind the model) → trusted
   - **Established community author** (1000+ likes across Spaces, maintained) → acceptable
   - **Hackathon/anonymous** (Agents-MCP-Hackathon, fresh accounts) → demo-only,
     fails the privacy gate automatically
3. `dynamic_space` with `operation: view_parameters` on the shortlist — confirm
   the API surface actually accepts our input type (file? URL? base64?).
4. Check liveness: a Space that errors or sleeps >60s on cold start gets a note;
   two failures = drop.

## Vetted defaults (re-verify freshness on every run)
| Category | Space |
|----------|-------|
| OCR | prithivMLmods/Multimodal-OCR |
| Background removal | not-lain/background-removal |
| Image classification | prithivMLmods/SAM3-Demo, atalaydenknalbant/DINOv3 |
| Audio transcription | hf-audio/whisper-large-v3 |
| Document extraction | prithivMLmods/VLM-Parsing |

## Rule
A Space is someone else's computer. Nothing with `pii: true` goes to a community
Space, ever — that traffic uses official Spaces, endpoints, or local execution.
