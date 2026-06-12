# Skill: Model Card Audit

Deep-read procedure for a model card. Used by the Evaluator Agent for areas
1 (task match), 5 (license), 6 (model card), 10 (custom code), 11 (benchmarks)
when the automated check in `evaluate_model.py` is inconclusive.

## Checklist
1. **Intended use** — does the author's stated use case include ours? A chat
   model that "can also do extraction" is a 1, not a 2, on task match.
2. **Limitations section** — present and honest? Cards that list zero
   limitations are a yellow flag, not a green one.
3. **License fine print** — the tag says one thing; the LICENSE file rules.
   Watch for: use-case restrictions (RAIL clauses), user-count thresholds
   (Llama-style), attribution requirements, NC riders.
4. **Training data** — described at all? Undisclosed data + commercial use =
   note the risk in the scorecard.
5. **Custom code** — search card and `config.json` for `trust_remote_code`.
   If required: who is the author? What does the custom module actually do?
   (Read it — it's usually <300 lines.)
6. **Benchmarks** — are numbers on standard benchmarks, with comparisons?
   Self-reported numbers with no methodology score 1; reproduced/leaderboard
   numbers score 2; none score 0.
7. **Bias/safety notes** — relevant for anything customer-facing (the voice
   agent must never inherit an unfiltered model's behavior).

## Output
Two-to-five bullet annotation appended to the model's scorecard under
`card_audit:`, with quotes from the card for anything load-bearing.
