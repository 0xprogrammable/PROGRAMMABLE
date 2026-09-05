# CI throughput and unchanged release boundaries

## Interface verification

The stable required `Interface` check aggregates two independent checkouts of the
same source revision:

- `Interface quality and tests`: locked dependency installation, the existing
  conditional dependency audit, workflow/scope regression tests, lint, and the
  complete interface test suite.
- `Interface browser and build`: locked dependencies and Chromium, wallet browser
  tests, late-migration browser tests, production build, complete-history checks,
  V4 clean-room tests, V4 and V4.1 activation audits, and the conditional read-model
  operations gate.

Browser tests and the build remain sequential inside one checkout because they
use local servers and `.next`. Independent jobs provide filesystem and process
isolation. The local `npm run verify:interface:ci` command still runs both complete
lanes sequentially. No test inventory, fuzz budget, compiler setting, or production
bundle validation is reduced.

The aggregate rejects failed, cancelled, missing, inconsistent, or unexpectedly
skipped worker results. Unaffected Interface work skips both worker jobs; the
stable aggregate still runs and validates classification. `read_model=true` must
imply `interface=true`.

The production proof resolver expects the exact eleven-job inventory, including
the two named workers. All protected contexts and final gates must succeed. Only
the two workers may both be skipped, with GitHub's unassigned-runner metadata and
no executed steps. Source SHA, workflow hash, tree, run attempt, hosted-runner
identity, artifact digest, attestation and freshness checks remain in force.
The new workflow cannot substitute a previous nine-job run at a different source
revision. Existing proof document parsing is unchanged; an old deployed revision
continues to use its own workflow and verifier.

## Exact CLI-coordinate classification

Only
`docs/operations/releases/custom-launch-v4.1/clean-room-release-coordinate.json`
is routed directly to Interface instead of the general release-document fallback.
Its consumers are public CLI discovery and the existing V4.1 activation audit.
That audit binds the complete coordinate bytes to the signed activation record,
producer source, immutable release assets and tag.

Coordinate schemas, verification code, dependency changes, unknown successors and
other release documents retain their existing gates. Mixing the coordinate with
Solidity adds Contracts; mixing it with the short-lived backend-evidence pair
still fails the exact-pair guard. The classifier is loaded from the trusted base,
so this routing change pays the existing full CI once before it can select later
changes.

## Fork RPC order

Mainnet fork tests try the existing Tenderly public endpoint first. In both
observed release runs it completed the entire mainnet suite after five preceding
public endpoints had failed or timed out. All endpoints, test groups, configured
endpoint precedence, retry conditions and timeouts are retained. This reordering
does not create a new trust source or replace any contract test.

Public RPC availability can change. Use the actual per-provider outcomes from a
new run to assess the improvement; do not equate a current connectivity probe with
completed fork-test coverage.

## Baseline and measuring the result

| Observed run | Baseline |
|---|---|
| [Guide-link PR Verify](https://github.com/programmablehq/PROGRAMMABLE/actions/runs/33980193153) | Interface job 391 seconds: unchanged main command 297 seconds, dependency installation 37 seconds, Chromium installation 28 seconds. |
| [CLI-coordinate PR Verify](https://github.com/programmablehq/PROGRAMMABLE/actions/runs/33975689855) | Contracts job 1,121 seconds; the single changed coordinate file selected every major lane. |
| [Production Verify](https://github.com/programmablehq/PROGRAMMABLE/actions/runs/33976644966) | Contracts job 1,084 seconds; unsuccessful mainnet provider attempts consumed about 263 seconds before the eventual successful provider. |
| [Stage Production Candidate](https://github.com/programmablehq/PROGRAMMABLE/actions/runs/33980910501) | About 277 seconds end to end; the source-build step took 167 seconds. Vercel restored its existing build cache. |

These are measurements before the change, not measured new runtimes. Compare a
complete new affected Interface run, an unaffected Interface run, and the next
legitimate Contracts run. Preserve the complete step and job outcomes as well as
duration and queue time; a shorter cancelled run is not an improvement.

Vercel continues to build exact reviewed source without assigning production
domains during staging. The existing production proof and stage/live evidence
are separate checks. A manual `custom-v2-release` Verify has a different full-tree
verification intent from a path-scoped push, so do not remove it merely because
both runs use the name `Verify`. Branch protection, activation records, environment
configuration, credentials, database access, deployments and wallet actions are
outside this source-only optimization.
