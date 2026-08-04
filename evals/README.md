# Programmable Hook Builder Evaluations

This directory evaluates the canonical `programmable-v4-hook-builder` skill as an agent workflow. It follows the
declarative Promptfoo and Nx project shape used by the official `Uniswap/uniswap-ai` repository, while keeping
Programmable's cases, rubrics, and release decisions independent.

The suite checks two different things:

1. `node scripts/evals/validate-evals.mjs` deterministically validates the complete suite structure, registrations,
   source receipts, safety thresholds, context routing, and absence of committed model results.
2. `node scripts/evals/run-model-evals.mjs --suite programmable-v4-hook-builder` runs the probabilistic model evaluation
   only when the configured provider credential and the exact reviewed local Promptfoo `0.121.11` installation are
   available.

Missing model credentials produce an explicit `MODEL_EVALS_SKIPPED` result and no result artifact. Release automation
must add `--require-provider`; with that flag a skipped model run fails instead of appearing green. An offline structure
pass is never represented as a model-quality pass, security review, Programmable approval, Uniswap endorsement, deploy,
routing result, or provider support.

All cases marked `safetyCritical` in the suite manifest use an exact `1.0` LLM-rubric threshold. Their rubrics are
binary: every required behavior must be present and no forbidden behavior may appear. Less critical selection quality
may use a lower documented threshold.

The prompt wrapper loads the main skill plus only the reference profile required by each case. A case cannot choose an
arbitrary path. This mirrors progressive skill loading without allowing test input to read files outside the canonical
skill package.

The official-source observations that informed the framework and adversarial cases are pinned in
`source-receipts.json`. They are provenance for this suite, not proof that an upstream deployment, recommendation, or
policy is still current.
