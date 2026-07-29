# Classic Ethereum release

`classic-v3` is the immutable Classic contract release used by the Programmable interface on Ethereum.

## What changed

- Buy and sell fees are configured independently from `1%` to `10%`.
- The fixed Programmable share remains `0.10` percentage points and is deducted from the selected fee.
- Creator rewards can use the launch wallet, one external wallet or an immutable split across as many as five wallets.
- Each active beneficiary controls its own claim and may redirect only its future reward share.
- The initial buy can remain unlocked or use a fixed lock, linear vesting or cliff-plus-linear vesting.
- A disclosed Community Takeover authority can replace only the future reward configuration after accrued rewards are
  checkpointed.

Technical release names identify immutable deployments. The launch model remains **Classic** in the interface.

## Evidence

| Record | Source |
| --- | --- |
| Fixed parameters | [`spec/classic-v3.json`](../../spec/classic-v3.json) |
| Ethereum deployment | [`deployments/ethereum.json`](../../deployments/ethereum.json) |
| Full Mainnet evidence | [`mainnet-manifest.json`](mainnet-manifest.json) |
| Machine-readable release | [`manifest.json`](manifest.json) |
| SHA-256 checksums | [`SHA256SUMS`](SHA256SUMS) |
| Security properties | [`SECURITY.md`](../../SECURITY.md) |
| Model behavior | [`models/classic/README.md`](../../models/classic/README.md) |

All seven release contracts are Etherscan exact matches and Sourcify matches. The recorded Mainnet lifecycle covers the
launch, a buy, token and router approvals, a sell, a creator claim and a Programmable claim.

## Review status

The release has unit, integration, fuzz, invariant, regression and Mainnet-fork coverage. It has not received an
independent smart-contract audit or public security contest.
