# Operations

Programmable's live contracts are immutable. Operations can detect, communicate and stop offering new launches through
the interface, but cannot rewrite deployed behavior or remove locked liquidity.

## Automated evidence

| Check | Frequency | Meaning |
| --- | --- | --- |
| Repository verification | Every pull request and push to `main` | Formatting, build, tests, registry and gas snapshot |
| Security workflow | Every pull request and push to `main` | Slither, coverage floor and workflow lint |
| Code scanning | Every push to `main` | Publishes Slither SARIF results in GitHub Security |
| Ethereum evidence | Every release pull request, daily and on demand | Runtime hashes match Ethereum and candidate lifecycle tests pass on a Mainnet fork |

A failed public RPC request can also fail the Ethereum evidence workflow. Investigate provider availability before
interpreting a failure as a contract change.

## Signals to monitor

The current public automation checks immutable bytecode. Operational monitoring should also observe:

- launch events from the published launcher;
- pool registration and fee disclosure events;
- creator and platform claim accounting;
- unexpected callback reverts;
- interface, RPC and indexer availability; and
- source-verification status on supported explorers.

Event alerting and a public uptime commitment are not currently represented as active services in this repository.

## Incident response

1. Preserve the transaction, block, logs, affected release and reporter details.
2. Decide whether the report concerns contracts, an external dependency, the interface, indexing or metadata.
3. Move contract vulnerabilities to a private GitHub security advisory.
4. Disable new interface launches for an affected release when continued use would increase risk.
5. Publish a factual notice describing scope, affected addresses and safe user actions.
6. Prepare a new immutable release when code changes are required.
7. Publish a post-incident record after disclosure is safe.

Do not promise fund recovery, contract upgrades or an emergency pause that the release does not implement.

## Severity guide

| Severity | Example |
| --- | --- |
| Critical | Unauthorized fund movement, broken liquidity custody or systemic accounting loss |
| High | Reliable launch failure, claim denial or exploitable release-wide integration fault |
| Medium | Limited accounting edge case or major third-party indexing incompatibility |
| Low | Documentation, metadata or display problem without contract impact |

Severity is based on demonstrated impact and reach, not the visibility of the report.
