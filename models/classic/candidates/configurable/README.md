# Configurable Classic candidate

This candidate extends Classic without creating a separate launch model. It keeps the fixed supply, native ETH pool,
atomic initial buy and permanently custodied launch position, while adding launch-time controls for fees, reward
allocation and Initial Buy custody.

It is deployed and lifecycle-tested on Sepolia. It is not the current Ethereum release.

## Launch controls

| Setting | Candidate behavior |
| --- | --- |
| Buy fee | `1%` to `10%`, selected independently in one-point steps |
| Sell fee | `1%` to `10%`, selected independently in one-point steps |
| Programmable share | Fixed `0.10` percentage points of each applied fee |
| Creator rewards | One wallet or immutable unequal shares across up to five wallets |
| Claims | Each beneficiary claims only its own native ETH |
| Payout changes | A beneficiary may redirect only its future accrual |
| Community takeover | Programmable may replace the future allocation with a disclosed reference |
| Initial Buy | Unlocked, fixed lock, linear vesting or cliff plus linear vesting |

Fees and reward percentages are fixed at launch. A payout-wallet change checkpoints all prior accrual first, so unpaid
rewards stay with the wallet that earned them. A community takeover changes only future allocation.

## Sepolia evidence

The Sepolia release completed deployment, a launch with separate `2%` buy and `7%` sell fees, a buy, a sell, a creator
claim and a Programmable claim. Two independent RPCs agreed on the receipts, runtime hashes, constructor bindings,
position custody and final accounting.

All seven infrastructure contracts have full Sourcify matches and verified source views on Blockscout and Routescan.
The Etherscan relay reached its daily source-submission limit, so Etherscan is not recorded as a verification provider
for this rehearsal.

[Read the Sepolia record](sepolia.json) ·
[Read the fixed parameters](spec.json) ·
[Read the security properties](../../../../docs/security/CLASSIC_CONFIGURABLE_PROPERTIES.md)

## Source

The public source begins at commit
[`2c2938a`](https://github.com/0xprogrammable/programmable/commit/2c2938a5fc6220f40da584a01271941a6df324dd).
The technical contract names remain versioned so deployed bytecode can be traced exactly. The product model remains
**Classic**.

This candidate has not received an independent smart-contract audit or public security contest.
