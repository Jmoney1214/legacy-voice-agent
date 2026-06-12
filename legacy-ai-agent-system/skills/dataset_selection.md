# Skill: Dataset Selection

Procedure for finding evaluation or fine-tuning data. Used by the HF Research
Agent — only when the task spec actually needs data (eval sets, fine-tuning).
Most store tasks don't; real store fixtures in `evals/` beat public datasets.

## Steps
1. `hub_repo_search` with `repo_types: ["dataset"]` + task keywords and
   language filter (`language:en`).
2. `hub_repo_details` with `operations: ["overview", "dataset_structure"]` —
   configs, splits, sizes, schema. Reject datasets whose schema doesn't match
   the task I/O without heavy transformation.
3. `dataset_preview` on the best candidates — read 5 actual rows. Datasets lie
   in their cards; rows don't.
4. Check license (commercial use) and size (don't pull 100GB for a 5-sample eval).

## Selection order
1. **Real store data** from Supabase/Lightspeed — always preferred for evals
2. Official benchmark sets for the task (e.g. Common Voice for ASR)
3. Community datasets — last resort, preview before trusting

## Rule
Never fine-tune on a dataset whose license or provenance is unclear, and never
upload store customer data to the Hub.
