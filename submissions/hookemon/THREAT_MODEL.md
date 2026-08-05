# Threat model

Hookemon is classified high risk by the local rubric because it combines return-delta accounting, autonomous jobs, multiple custody boundaries, policy signers and third-party services. “High risk” is a review requirement, not a prediction that the prototype is unsafe.

## Assets and custody

| Asset/state | Custody or source of truth | Exit/recovery |
| --- | --- | --- |
| HOOKEMON supply | Fixed-supply ERC-20 and deployment Safe before final allocation | Ordinary transfer; no pause, blacklist or owner mint. |
| Canonical LP position | Final owner/lock unresolved | Must be fixed before mainnet; ordinary hook cannot block liquidity removal. |
| Programmable/project fees | Hook-owned PoolManager ERC-6909 USDC claims and owner liabilities | Each immutable owner claims only its own liability. |
| Cycle funds | CycleVault, CCTP transit, Solana policy wallet, Collector assets, inbound transit | Pause and reconcile the last confirmed `cycleId`; no arbitrary destination. |
| Reward funds | AutomaticRewardsDistributor USDC balance | Historic roots remain valid; proof-valid settlement pays only unpaid cumulative delta. |
| Index state | Canonical logs plus confirmed reads | Roll back orphaned blocks and replay from the common ancestor. |
| Secrets | Provider secret stores and policy-wallet systems | Rotate/revoke under incident policy; never place keys or signed transactions in public artifacts. |

## Hook boundary

The 14 permission bits are:

```text
beforeInitialize=true
beforeSwap=true
afterSwap=true
beforeSwapReturnDelta=true
afterSwapReturnDelta=true
all other permissions=false
derived mask=0x20cc
```

BaseHook authenticates PoolManager. Every enabled callback also verifies the exact registered PoolKey. `hookData` is ignored. Same-pool swaps, liquidity changes and donations initiated by the hook are forbidden; the only direct PoolManager operations are bounded claim mint/redemption actions.

Critical scenarios:

- direct callback from a non-PoolManager must revert;
- wrong PoolId, currency order, hook, quote asset, LP fee or tick spacing must revert before mutation;
- the mined hook address must match the permission mask;
- specified-USDC final delta mismatch must revert rather than charge an unexecuted amount;
- a returned positive hook delta must have an equal ERC-6909 claim and matching owner liabilities;
- exact-output gross-up must preserve requested net semantics or revert;
- claim order must clear only the authenticated owner liability and atomically redeem equal backing;
- claim calls must not reset fee remainders or permit cross-pool netting.

## Cross-network and provider boundary

The hook never calls CCTP or Collector. The operator is a separate failure domain.

- Each cycle has one idempotency key and only one in-flight bridge direction.
- Ethereum-to-Solana mint recipient must be the configured USDC associated token account, not the wallet owner address.
- Standard/Forwarding Service is default. Fast is allowed only by explicit configuration and fee cap.
- Collector machine data older than 120 seconds, missing odds/floor/price, insufficient stock or malformed API data stops purchases.
- Every pack has a unique memo. Generate, submit, open, buyback and status calls are reconciled before retry.
- A timeout is never proof of failure or success. The operator queries the provider and chain before resubmitting.
- A crash after provider acceptance but before local save is handled by provider-side `cycleId`/memo reconciliation; the JSON checkpoint alone is insufficient.
- Collector key, wallet material, serialized signed transactions and email codes must never enter logs, Sentry, the API or Git.

## Reward/indexer boundary

- Same-block transfers are ordered by transaction/log index.
- Mint and burn do not create zero-address eligibility.
- Reorgs replace the orphan branch and recompute time-weighted balances.
- The exact exclusion list is versioned and public; a hidden exclusion or treasury reclassification is prohibited.
- Cumulative leaves bind `chainId`, distributor, epoch, account and amount using OpenZeppelin StandardMerkleTree double hashing.
- All earlier unpaid accounts remain in later cumulative roots.
- `paid[account]` prevents duplicate value release across epochs; a changed amount invalidates its proof.
- Empty roots are not published. Funding must cover newly committed cumulative entitlement.
- Gas policy can delay, but not expire or confiscate, a holder balance.

## Service/API/UI boundary

- The public API is GET-only and returns explicit projections; internal errors become a generic 503 without provider headers or credentials.
- Privy is optional login and cannot change rank, entitlement or payment recipient.
- Website figures must come from the read API or be labeled prototype/static. It must not call a simulation “live”.
- Collector/CCTP/RPC status is third-party evidence, never a substitute for confirmed chain custody.
- Pokémon-related names are descriptive only; no official Pokémon art, logo, affiliation or guaranteed card value is claimed.

## Authority abuse and failure

| Threat | Control and remaining risk |
| --- | --- |
| Registrar registers hostile pool | Immutable one-time registrar and strict PoolKey checks; exact registrar address remains a predeployment gate. |
| Safe redirects cycle funds | Typed destinations, amount bounds, cycle replay protection and 48-hour config delay; Safe compromise remains material. |
| Guardian steals funds | Guardian is pause-only; it cannot sweep or redirect, but can delay automation. |
| Root publisher overstates rewards | Cumulative artifacts are public/reproducible, but a valid publisher can still commit a bad root; independent reconstruction, policy signer and funding checks are required. |
| Operator repeats bridge/pack | Durable checkpoints plus provider reconciliation and one-direction lock; provider idempotency must be verified live. |
| Collector changes terms | Purchases fail closed on stale/malformed data; written permission and current commercial/API terms are release gates. |
| RPC lies or lags | Confirmed-block reconciliation, block-hash checkpoints and failover; multiple independent RPC classes are still required for production. |
| Gas exhaustion | Sponsor runway alerts, max-40 batches and value-to-gas threshold; small payouts can be delayed. |
| Pack losses | Disclose uncertain outcomes; cap order count and favor floor lane. Loss is borne by the reward pool, never by a promised redemption. |

## Known limitations

- Slither `0.11.6` was run against source commit `61a66e4562fa69afaf2e07be9122700cace9045d`; its three findings and dispositions are recorded in `evidence/STATIC_ANALYSIS.md`. This is not an independent audit.
- A pinned Ethereum fork at block `25684536` and a separate current-head smoke at observed block `25684686` pass against the reviewed PoolManager, USDC and Circle TokenMessengerV2 addresses. No deployment receipt, source verification, runtime match or incident drill exists yet.
- The deterministic builder closes the declared Foundry and JavaScript source graph without diagnostics. Maintainer dependency review is still required because the project uses a model-specific pinned baseline.
- Mainnet token allocation, launch/liquidity policy and LP custody remain the open architecture decision. Exact role addresses and Collector permission/key are separate deployment/candidate gates. Hookemon supplies no swap client in this submission; a future platform or third-party routing surface is a separate review boundary.
- Third-party uptime, future API semantics, pack outcomes, token price, trading volume and payouts cannot be guaranteed.
