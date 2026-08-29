# DEX EVM revision-bound foundations evidence

Classification: `NON_PRODUCTION_REVISION_BOUND_FOUNDATIONS_EVIDENCE`

Terminal state: `BLOCKED_BY_SPEC`

This evidence set binds the local DEX EVM foundations checks to implementation
commit `783abb45ff94d9f7920b29ec573483a763cebbd9` and tree `24db9698e98329a0564955e8456de0d76a5e3f5d`.
The containing commit is data-only evidence and is not the implementation
revision.

The evidence covers the locked Draft Protocol check, binding-local Foundry and
SDK foundations, deterministic Echidna properties, reproducible build artifacts,
coverage and size gates, Slither triage, and an offline simulation using the
recorded Robinhood Chain testnet context.

It does not establish a Binding Release, Conformance Report, portable profile
conformance, protected execution, canonical-network deployment or behavior,
source verification, production eligibility, an independent audit, or a
Core-controlled vault release path. No transaction was signed or broadcast.

- [release record](release-record.json)
- [evidence catalog](evidence-catalog.json)
- [checksum manifest](SHA256SUMS)
- [revision-bound foundations test report](../../../packages/dex-evm/binding/reports/native-foundations-test-report.json)
