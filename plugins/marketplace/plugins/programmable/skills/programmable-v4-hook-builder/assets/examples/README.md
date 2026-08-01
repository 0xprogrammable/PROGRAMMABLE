# Example scenarios

The JSON files in this directory are ordered scenario patches used by the validator tests. They are not complete `submission.json` documents.

List the packaged examples:

```bash
node scripts/materialize-example.mjs --list
```

Create a complete submission from one named step:

```bash
node scripts/materialize-example.mjs \
  --example transparent-pool-scoped-fee \
  --step fully-specified \
  --output submission.json
```

The command starts from the canonical submission template, applies each patch through the selected step and validates the result against `references/submission.schema.json` before writing it. The same inputs produce byte-identical JSON. It reads JSON only and does not import, compile or execute candidate source code.

Run the compatibility preflight separately:

```bash
node scripts/validate-submission.mjs submission.json
```

A structurally ready example is still a proposal. For Builder `v0.2.1`, every materialized scenario also inherits the
mandatory root `programmableFee` policy from the canonical template. A scenario may vary project economics, but cannot
replace the 10 bps canonical-pool platform allocation with an LP fee, transfer tax, router charge, app payment, or
alternative pool. The examples are not audits, deployments, proof of live fee collection, routing approvals, or
production releases.
