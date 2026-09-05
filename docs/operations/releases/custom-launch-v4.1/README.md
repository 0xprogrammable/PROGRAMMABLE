# Robinhood API release 4.1

This directory contains the successor release contract. Its initial activation record has
`proof: null`; source changes and local tests do not enable public writes. Version 4.0
retains its own immutable CLI, machine contracts, deployment provenance and clean-room
evidence. Ethereum is outside this successor's launch scope.

The deployed graph factory, stamp router and Phase A deployment evidence remain shared.
The 4.1 policy/profile tuple, backend release authorization, Phase B promotion, public
machine-contract bytes, CLI release and clean-room producer are independently bound.
The new promotion evidence lives under `release/robinhood-chain-4663/v4.1/`.

The source-owned binding command can produce a candidate after the 4.1 machine contracts
have been generated:

```sh
node scripts/programmable-launch-v41-release-binding.mjs create-inactive-candidate --repository-root "$PWD"
```

It writes JSON to standard output. All six evidence objects are null and every release
gate remains closed. A reviewer must bind the final protected policy source and actual
backend artifacts before the successor promotion workflow can create ready evidence.

The protected CLI release workflow selects exactly 4.0.0 or 4.1.0. It audits the matching
binding, authenticates backend authorization, repeats fresh provider/backend checks and
publishes immutable source-bound assets. Unsupported 4.x versions fail closed.

The successor clean-room workflow installs the immutable 4.1 CLI and builds the distributed
native20 example with explicit launch-value and gas budgets. It must obtain an actual
authenticated API response through `wallet_action_required`, replay the same idempotent
request, and bind the server's fee review, funding plan and initial-buy review to the exact
admission receipt, graph, prepared artifact and wallet transaction. A local fixture is
never a release proof. The USD minimum is an authorization-time reference quote; it is
not a guarantee of the execution-time USD price.

Only a successful protected clean-room run can be imported:

```sh
node scripts/programmable-v41-api-activation.mjs generate \
  --repository-root "$PWD" --run-id RUN_ID --artifact-id ARTIFACT_ID \
  --artifact-digest sha256:EXACT_DIGEST --archive /absolute/path/to/artifact.zip \
  --output-directory /absolute/path/outside-the-repository
```

The import verifies the owner-run metadata, exact workflow and source commit, immutable
release assets, artifact digest, signed attestation and canonical evidence before writing
reviewable files. The audit command reauthenticates preserved proof bytes without relying
on GitHub ZIP retention:

```sh
node scripts/programmable-v41-api-activation.mjs audit --repository-root "$PWD"
```

The root release owner then selects this successor in discovery. Its API readiness scope
ends at the wallet handoff. Wallet signing, transaction broadcast, finalized execution,
deployed child-vault runtime observation and public indexing remain separate evidence.

The original 4.0 clean-room script and workflow are byte-bound by historical activation
proofs. They must not be refactored in place. New successor behavior is implemented in
the separate runner and workflow instead.
