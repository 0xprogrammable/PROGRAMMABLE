# Classic Ethereum release

`classic-v2` is the current immutable Classic contract release used by the Programmable interface on Ethereum.

## Evidence

| Record | Source |
| --- | --- |
| Fixed parameters | [`spec/classic-v2.json`](../../spec/classic-v2.json) |
| Ethereum deployment | [`deployments/ethereum.json`](../../deployments/ethereum.json) |
| Machine-readable release | [`manifest.json`](manifest.json) |
| Security properties | [`SECURITY.md`](../../SECURITY.md) |
| Model behavior | [`models/classic/README.md`](../../models/classic/README.md) |

The deployment record contains the verified addresses, runtime code hashes and available deployment transactions.
Source verification is recorded as an Etherscan exact match and a Sourcify match.

## Review status

The release has unit, integration, fuzz, invariant and regression coverage. It has not received an independent
smart-contract audit or public security contest.

The Git tag is the canonical repository snapshot for this release. GitHub release assets carry checksums so downloaded
evidence can be verified independently.
