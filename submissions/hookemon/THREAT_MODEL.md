# Threat model

Hookemon is classified high risk by the local rubric because it combines return-delta accounting, autonomous jobs, multiple custody boundaries, policy signers and third-party services. “High risk” is a review requirement, not a prediction that the prototype is unsafe.

## Assets and custody

| Asset/state | Custody or source of truth | Exit/recovery |
| --- | --- | --- |
| HOOKEMON supply | Fixed-supply ERC-20 and the atomic launcher during its constructor; canonical liquidity and vesting when the transaction completes | No externally observable intermediate custody survives a failure; no pause, blacklist or owner mint. |
| Canonical LP position | Immutable 730-day position timelock, then the bound Ethereum wallet | Only the exact reviewed token ID whose PositionManager PoolKey derives the canonical PoolId is accepted; ordinary hook behavior cannot block release. |
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

The central `1.5.0` checker requires its internal-fee projection whenever `directPoolManagerCalls=true`, even when those calls are claim-only. That projection does not add a hidden swap surface: `hook.nestedActions.allowedActions`, the fee-conformance manifest and executable source remain authoritative about the narrower take/settle boundary.

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
- The Collector signer accepts only legacy transactions whose fee payer, provider signatures, memo, programs, token transfers, mints, decimals, amounts and accounts match the cycle-scoped intent and reviewed allowlists.
- `getGenesisHash` must match the configured Solana cluster and `isBlockhashValid` must return true at `confirmed` commitment immediately before signing; versioned, malformed, oversized or expired transactions fail closed.
- Player and temporary NFT recipient are the same policy wallet. Manual buyback must transfer exactly the opened NFT to an allowlisted Collector account and exact USDC to the configured recipient ATA.
- A durable exclusive intent reservation binds action, `cycleId` and pack identity before the raw signer runs. Restart and provider retry paths reconcile status first and never authorize a second message for that action.
- A timeout is never proof of failure or success. The operator queries the provider and chain before resubmitting.
- A crash after provider acceptance but before the PostgreSQL commit is handled by provider-side `cycleId`/memo reconciliation; a local checkpoint alone is insufficient.
- Collector key, wallet material, serialized signed transactions and email codes must never enter logs, Sentry, the API or Git.
- The intent store contains only public identifiers and message/intent hashes; raw transaction bytes and signatures are not persisted there.

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
- Privy login is optional for holders and cannot change rank, entitlement or payment recipient. One Privy Ethereum wallet and one Privy Solana wallet perform the bound production actions.
- Website figures must come from the read API or be labeled prototype/static. It must not call a simulation “live”.
- Collector/CCTP/RPC status is third-party evidence, never a substitute for confirmed chain custody.
- Pokémon-related names are descriptive only; no official Pokémon art, logo, affiliation or guaranteed card value is claimed.

## Authority abuse and failure

| Threat | Control and remaining risk |
| --- | --- |
| Registrar registers hostile pool | The hash-bound atomic launcher is the one-time registrar; strict PoolKey checks, independently derived PoolId and constructor-only execution prevent a later registrar action. |
| Privy Ethereum authorization is lost | Deployment administration, pause and routine Ethereum actions stop. On-chain trading, existing liabilities, vesting and LP timelock continue; recovery requires reviewed Privy credential rotation. |
| Privy Ethereum authorization or policy is compromised | One wallet occupies every Ethereum authority. Typed destinations, zero arbitrary value, amount bounds, 48-hour configuration delay, treasury vesting and LP lock limit immediate loss, but this concentration remains a material single point of failure. |
| Privy wallet or policy binding drifts | Any address, wallet ID, policy ID/hash or undisclosed third wallet mismatch stops mainnet preflight before signer construction. |
| Guardian action is abused | The guardian capability can pause automation but cannot sweep another liability, forfeit holder entitlement or block the immutable LP release schedule. |
| Root publisher overstates rewards | Cumulative artifacts are public/reproducible, but a valid publisher can still commit a bad root; independent reconstruction, policy signer and funding checks are required. |
| Operator repeats bridge/pack | Durable checkpoints plus provider reconciliation and one-direction lock; provider idempotency must be verified live. |
| Readiness monitor mistaken for production automation | Public status and runbook label the current Render command as signer-free monitoring only; transaction activation requires exact adapter composition and a controlled lifecycle rehearsal. |
| Mainnet configuration drifts | A signer-free preflight binds chain identities, runtime hashes, exactly two Privy wallets/policies, Solana custody, CCTP routes, reserves and the PostgreSQL lock; any mismatch stops before signer construction. |
| Collector changes terms | Purchases fail closed on stale/malformed data; written permission and current commercial/API terms are release gates. |
| RPC lies or lags | Confirmed-block reconciliation, block-hash checkpoints and failover; multiple independent RPC classes are still required for production. |
| Gas exhaustion | Sponsor runway alerts, max-40 batches and value-to-gas threshold; small payouts can be delayed. |
| Pack losses | Disclose uncertain outcomes; cap order count and favor floor lane. Loss is borne by the reward pool, never by a promised redemption. |

## Known limitations

- Slither `0.11.6` was run against source/evidence commit `d1f6e8b4be04523626ecf73a97acfe3e3a103d67`; its four findings and dispositions are recorded in `evidence/STATIC_ANALYSIS.md`. This is not an independent audit.
- A pinned Ethereum fork at block `25684536` and a separate current-head smoke at observed block `25688219` pass against the reviewed PoolManager, USDC and Circle TokenMessengerV2 addresses. No deployment receipt, source verification, runtime match or incident drill exists yet.
- The deterministic builder closes the declared Foundry and JavaScript source graph without diagnostics. Maintainer dependency review is still required because the project uses a model-specific pinned baseline.
- Owner-approved option A fixes the atomic token allocation, 25,000 USDC launch liquidity, 500 USDC CycleVault bootstrap, treasury vesting and exact-position 730-day LP custody. The owner approved exactly one Privy Ethereum wallet for every Ethereum role and one Privy Solana wallet for every Solana role; concentrated application authorization remains a mainnet review item. Exact public bindings and Collector permission remain separate deployment gates. Hookemon supplies no swap client in this submission; a future platform or third-party routing surface is a separate review boundary.
- Third-party uptime, future API semantics, pack outcomes, token price, trading volume and payouts cannot be guaranteed.
