# Threat model

## Assets and value at risk

- The canonical v4 pool holds standard launch liquidity under PoolManager and position semantics. `ArenaProgrammableFeeHook` owns only native-ETH ERC-6909 claims backing explicitly recorded fee liabilities; it owns no LP position.
- `ArenaPrizeEscrow` holds only exact standard ERC-20 deposits for open or joined rounds. `totalEscrowed` is the aggregate recorded liability.
- Each round stores player A, optional player B, equal stake, rules hash, join deadline, resolution deadline, match digest, status and refund mask.
- The immutable result signer is a capability: it can authorize player A or B as winner before timeout. The private key is never committed, logged or returned by the service API.
- Browser scores and movement are valuable game state but are not payout authority.
- A direct token donation becomes visible surplus. It has no rescuer and cannot cover, reduce or redirect a player liability.

Only the launched token with standard exact-transfer behavior is supported as the prize token. Fee-on-transfer, rebasing, callback-driven balance change, pausing, blacklisting and upgrade controls are outside this proposal.

## Trust boundaries

| Boundary | Can do | Cannot do |
| --- | --- | --- |
| Official launch profile | Create token, pool and launch liquidity through its declared contracts. | Prove current runtime or availability merely because a profile is committed. |
| Registrar/factory | Deploy a permission-valid hook and register exact PoolKeys before initialization. | Replace the fixed Programmable owner, register twice, redirect claims or mutate a registered fee configuration. |
| PoolManager/external Uniswap client | Authenticate callbacks, price/settle v4 actions or prepare a user-confirmed quote/transaction. | Bypass the canonical hook, read game state or accept a match signature in this design. |
| Fee hook | Enforce the canonical native-ETH fee, record liabilities by PoolId and redeem claims to authorized destinations. | Change its fixed owner/share, net liabilities across pools, divert LP fees, accept arbitrary quote assets or call game/service logic. |
| Browser/game | Render, accept input and show an unsigned practice result. | Move assets, sign results or determine an onchain winner. |
| Wallet | Approve and submit user-confirmed transactions. | Make stale or forged service data valid. |
| Result service/operator | Validate one canonical payload and sign A or B. | Hold tokens, submit settlement, name an outsider, alter stake/token/rules, extend deadlines or block refunds. |
| Escrow | Hold exact deposits, authenticate the immutable signer, pay a recorded winner and refund players. | Change signer, token, fee, rules or deadlines after round creation; call arbitrary targets. |
| Indexer/API | Present finalized and reconciled state. | Replace confirmed contract state or turn a browser score into entitlement. |
| Routing/discovery provider | Discover or route the ordinary pool if independently supported. | Prove source identity, escrow solvency, game correctness or Programmable acceptance. |

## Canonical fee-hook boundary

The canonical pool embeds `ArenaProgrammableFeeHook` in its PoolKey. Its mined address enables only initialization and swap callbacks plus the two swap return-delta flags. `BaseHook` rejects callers other than PoolManager. The game result occurs after a match and does not need atomic PoolManager execution, so prize custody and signatures remain a separate boundary. No custom `hookData`, nested swap, liquidity callback or donation callback is supported.

## Value flows and accounting

1. The registrar binds a canonical native-ETH PoolKey and its immutable project fee owner before initialization.
2. Every canonical-pool swap calculates the effective total as `max(selected total, 10 bps)`. Programmable receives `floor(gross quote × 10 / 10,000)`; the project receives the remaining hook fee. LP fees remain separate in core.
3. PoolManager mints native-ETH ERC-6909 claims to the hook. Project and Programmable liabilities are recorded separately by PoolId before claims can be redeemed. Cross-pool netting is impossible through either claim entry point.
4. Player A creates a round and transfers exactly one stake. State and liability revert if observed balance increase differs.
5. Player B joins and transfers exactly the same stake under the same check.
6. Valid settlement sets the round to settled and reduces liability before transferring exactly two stakes to A or B. Any transfer anomaly reverts the whole transaction.
7. An unjoined player A recovers one stake after the join deadline.
8. After resolution timeout, A and B each reduce one liability and recover one stake once. Either claim can occur first.

For every PoolId, `hook ERC-6909 quote claims = project liability + Programmable liability` after each fee accrual or claim. For every joined arena round, `recorded deposits = 2 × stake`; a successful payout or two timeout refunds reduce its liability to zero. These accounting domains never net against one another.

## Attack and failure scenarios

- **Dishonest signer:** can select the wrong recorded player before timeout. This is disclosed trust, not solved by timeout. It cannot redirect value outside A/B.
- **Signer outage or censorship:** no settlement occurs. Both players recover independently after the fixed deadline.
- **Signature replay:** round state leaves `Joined`; the same signature fails. Domain binds chain, escrow, action and every material round/result field.
- **Cross-chain or cross-contract replay:** EIP-712 domain includes chain ID and verifying escrow address.
- **Parameter substitution:** token, stake, both players, rules hash, match digest, signature deadline and resolution deadline are signed.
- **Outsider payout:** rejected before signature recovery.
- **Malicious browser:** may fake visuals or an unsigned result but cannot create a valid signer authorization.
- **API abuse:** companion input is bounded to 16 KiB, validates exact fields and applies a local request limit; production authentication and distributed rate limiting remain required.
- **Reentrancy or hostile token:** every value-moving entry is guarded, state updates precede outbound transfers, SafeERC20 is used and both sender/recipient balance deltas must be exact.
- **Fee-on-transfer/rebase:** non-exact deposit or payout reverts; these assets are unsupported.
- **Deadline manipulation:** validators can slightly skew timestamps. Time is used only for windows, never for randomness, score, price or payout amount. Product windows must include operational margin.
- **Insolvency:** `totalEscrowed` is reconciled to token balance. Donated surplus is excluded; a deficit stops new paid rounds and requires incident escalation.
- **No rescue:** accidental surplus cannot be withdrawn. This removes rescue authority but permanently strands donations.
- **Round identifier collision:** a nonzero existing `roundId` cannot be recreated.
- **Denial of service:** no unbounded loop exists on deposits, payout or refunds. Service outage cannot block timeout exit.
- **Reorg/indexer drift:** roll back orphaned events, replay from a confirmed ancestor and reconcile round state plus balances before displaying entitlement.
- **Wrong PoolKey/external route:** any later provider quote and transaction must bind the canonical PoolKey and user bounds. Arena code never prepares or changes route data.
- **Router bypass:** any router entering the canonical PoolKey reaches the same PoolManager-authenticated hook. A different pool is explicitly outside canonical fee enforcement and cannot be labeled as the approved market.
- **Cross-pool withdrawal:** both liability ledgers and both claim functions require PoolId. Claiming one pool cannot decrease or redeem another pool's balance.
- **Rounding bypass:** a nonzero quote amount reverts whenever the fixed 10-basis-point share would round to zero. Programmable is calculated directly at 10 basis points; it does not receive creator-fee rounding dust.
- **Partial fills:** quote-specified partial fills revert when actual pool quote differs from the fee-adjusted expectation. Quote-unspecified swaps charge from the final executed quote delta.
- **Unauthorized fee claim:** the fixed Programmable wallet alone initiates a pool-specific platform claim and selects its per-claim destination. The project owner can claim only its own pool remainder. Zero recipients revert.
- **Same-hook callback bypass:** the hook exposes no nested swap or direct PoolManager action that could suppress its own callbacks.

## Dependency identity

- `openzeppelin-contracts-5-6-1`: source revision `5fd1781b1454fd1ef8e722282f86f9293cacf256`, package version 5.6.1, locked in the primary repository.
- `openzeppelin-uniswap-hooks-1-1-1` and `uniswap-v4-core-1-0-2`: exact npm versions locked in the primary repository; they provide `BaseHook`, currency settlement and PoolManager/core accounting used by the fee path.
- `three-js-0-185-1`: source revision `2431a09f46f34c560bc8e44b33be0e567723d5b9`, package version 0.185.1. Renderer failure has no onchain authority.
- `playwright-core-1-62-1` and `vite-8-2-0` are exact version, integrity and source-commit tooling bindings; they do not become runtime authorities.
- `arena-result-service`: companion commit `24875f9325d6c055a04089cf2c1543dfa862fcad`, tree `bde2f6668ccdf9d8777112282cefcec31ea4b60f`, locked v2 manifest and successful closure run `30710249231`. The closed receipt reconstructs its static source and test graph, package manifest, lockfile, optional peer targets and registry integrity records, then binds the exact build and test workflow. This is dependency closure, not a semantic audit. Operator failure falls back to timeout refunds.
- Official Sepolia launch dependencies remain bound by the selected profile, whose source conflict and runtime-verification gates remain open.

## Authorities and recovery

The model-specific authorities are the immutable result signer, registrar, immutable per-pool project fee owner and fixed Programmable fee owner. The registrar can admit a PoolKey only once and cannot change its configuration. The Programmable owner can claim only its recorded pool-specific share and choose a per-claim destination. There is no upgrade administrator, pauser, rescuer, keeper, oracle, transaction submitter or arbitrary executor. Replacing any immutable authority requires a new deployment and does not change rights in old pools or rounds.

Users recover through standard pool/position behavior, unjoined refund, signed payout or joined timeout refund. Historical entitlements cannot be redirected after state transition.

## Known limitations

- A signer can lie between the two players; independent game-result verification is not yet provided.
- ERC-1271 contract signers are not supported by this fixed-EOA proposal; signer provenance, custody, rotation, revocation, recovery and incident response remain a candidate review gate.
- A compatible stateful invariant run, pinned-fork test, deployment receipt, source/runtime verification, product integration, service operations, monitoring drills and independent review are still required before real value.
- The fee canary currently supports native ETH as quote asset only. Fee-on-transfer or rebasing quote assets are not silently accepted.
- The static analyzer reports the intentional timestamp windows; these have a written disposition but are not erased.
- The browser bundle has a 500 kB advisory warning and has not completed a long-duration playtest.
- No official routing, listing, acceptance, deployment or availability statement is made.
