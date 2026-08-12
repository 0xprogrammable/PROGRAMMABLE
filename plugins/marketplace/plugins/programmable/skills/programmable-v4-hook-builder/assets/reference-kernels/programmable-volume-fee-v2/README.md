# Programmable volume-fee v2: `standard-amm` reference kernel

This directory is an additive, versioned reference accelerator for
`programmable-volume-fee-v2@2.0.0`. It does not replace or mutate v1. It is not an audit, a deployment, a universal
hook or approval to launch.

The kernel implements exactly one collection profile: `standard-amm`. It binds one Uniswap v4 PoolId and one quote
currency, keeps independent lifetime rounding remainders for the fixed Programmable share and project share, takes
fully funded PoolManager claim tokens atomically, and lets only each exact owner claim its own balance.

## Fixed policy identity

- platform owner: `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`
- platform share: 1,000 hundredths of a bip = 0.1% of executed gross quote volume
- policy preimage: `programmable-volume-fee-v2@2.0.0`
- profile preimage: `standard-amm`
- selected total rate: any value below 100%; values below 0.1% resolve to 0.1%

The canonical JavaScript policy can represent a transparent selected total at or above 100% only through its explicit
`custom-reviewed`, externally funded path. This `standard-amm` Solidity kernel remains user-funded and rejects those
rates; it must not be presented as implementation evidence for that custom profile.

`gross` means quote value actually executed. Deposits, canceled orders, unfilled amounts and refunds are not volume.
Every partial fill is measured once when it executes.

## What changed from the v1 reference

- no artificial 10% selected-fee ceiling;
- no global 1,000-unit minimum quote amount;
- exact output uses a caller-supplied gross witness, verified against current onchain remainders;
- micro amounts are math, not application eligibility: if independent rounding makes an atomic standard-AMM leg
  insolvent or empty, the transaction reverts with `AlternativeSettlementRequired` and must use a batch, sponsored,
  segregated-collateral or reviewed custom profile;
- policy and profile hashes are committed in the deployment configuration hash.

## Exact-output integration

For exact-output swaps, set `hookData = abi.encode(grossQuoteWitness)`. Use
`scripts/fee-policy-v2-core.mjs` and `findExactOutputWitnessV2` offchain. The contract verifies the witness against the
current selected rate and both live remainders. Empty, stale or forged data reverts; there is no bounded onchain search
that silently fails at high rates.

The router must also enforce the user's maximum gross quote input. A witness proves fee arithmetic; it does not replace
slippage protection, deadlines or transaction simulation.

The witness is bound to the two live lifetime remainders. Another accepted swap in the same scope can change those
remainders before inclusion and make an otherwise correct witness stale. The stale transaction reverts atomically: it
cannot transfer the victim's tokens, create a fee liability or alter either remainder. This is still a real ordering and
griefing risk because the victim pays for a reverted transaction. Integrations should rebuild and simulate the witness
against current state immediately before submission, use a short deadline and appropriate private or protected routing,
and treat a stale-witness revert as retryable rather than silently widening the user's maximum input.

## Atomic factory and configuration receipts

The reference factory has no deployment-only entrypoint. `deployAndRegister` fixes the factory as registrar, deploys the
mined hook, registers the exact PoolKey and rates, initializes the pool, and records receipts in one transaction. Its
caller-supplied `userSalt` is not used as the raw CREATE2 salt. The factory first hashes every registration input with a
versioned domain, the chain id and factory address, then derives
`effectiveSalt = keccak256(abi.encode(EFFECTIVE_SALT_DOMAIN, userSalt, registrationConfigHash))`. The commitment covers
the PoolManager, both currencies, LP fee, tick spacing, quote currency, project owner, buy/sell rates and initial price.
There is no XOR or packed-encoding cancellation path. Use `predictHookAddress(userSalt, config)` while mining until the
returned address has the exact required hook flags; constructor-only `HookMiner.find` salts are not valid inputs to this
factory. Prediction and deployment share the same internal identity path.

A copied `userSalt` combined with any changed one-shot configuration predicts a different address and cannot squat the
intended deployment. An exact copied configuration is outcome-equivalent because it retains the intended owners, rates,
pool and price. A later identical call reconciles idempotently only when the stored registration hash and effective salt,
the hook's observed runtime hash, and the recomputed factory-domain hash all match. Foreign code, partial receipts or an
unobservable runtime receipt revert with `ExistingDeploymentReceiptMismatch`; code existence alone is never accepted.
If any registration, initialization or receipt check fails, CREATE2 deployment and all four receipts revert together.

After initialization, the hook exposes `runtimeConfigurationHash()`. It binds the chain, hook, factory registrar,
PoolManager, exact PoolId, both currencies, quote side, LP fee, tick spacing, initial price/tick, project owner, selected
buy/sell rates, effective rates, fixed Programmable owner/rate, policy and profile. The factory stores that exact value as
`runtimeConfigurationHashOf(hook)` and domain-separates it with the chain, factory and hook into
`factoryConfigurationHashOf(hook)`. The factory hash therefore commits to the complete registered runtime
configuration, not merely constructor arguments. It also stores `registrationConfigHashOf(hook)` and
`effectiveSaltOf(hook)`, and emits the user salt plus all four bindings on deployment or exact-copy reconciliation.
Neither receipt is an audit, deployed-bytecode match, current pool-state hash or launch approval. Offchain v2 policy and
evidence JSON records the EVM chain id as an exact canonical positive `uint256` decimal string (`"1"`, not `1`) so
unusual chain ids cannot be rounded by JavaScript.

Fee custody uses PoolManager ERC-6909 claims in the exact quote currency. Accrual mints claims in the same authenticated
callback that creates liabilities; owner claims burn those claims before PoolManager transfers native currency or ERC-20
value to the nonzero per-call destination. Claim state is cleared before the external transfer and the owner claim,
factory, and swap callbacks use the pinned OpenZeppelin transient reentrancy guard where their call topology permits it.

## Build and test

```sh
npm ci
forge fmt --check
npm test
```

`npm test` first regenerates the checked-in routing hashes with the pinned JavaScript `V4Planner` and `RoutePlanner`,
then runs Foundry. The kernel, router-facing tests, v4-core and v4-periphery compile at their exact 0.8.26 pragmas;
the exact Permit2 source compiles as an isolated 0.8.17 graph. The 0.8.26 graph targets Cancun; Foundry selects the
compatible target for the older isolated compiler graph. Dependencies are exact in `package-lock.json`; the routing
vector records package integrity and source revisions.

### Executable standard-router compatibility profile

The checked-in profile executes the package's real `UniversalRouter` creation bytecode, not a local router facsimile.
It also deploys the pinned v4-periphery `V4Quoter` against the same local PoolManager. Each supported single-pool mode
first runs the real revert-based quoter with the exact PoolKey, direction, amount and hookData, proves that quoting
changed no balance, fee liability or remainder, and then uses that quote immediately to construct the Universal Router
execution. ERC-20 settlement calls the real pinned Permit2 `AllowanceTransfer` implementation after both approvals
(`token -> Permit2`, then `Permit2 -> UniversalRouter`); direct token approval to the Universal Router remains zero.
Native input is sent as transaction value and bypasses Permit2. Native exact-output sends the slippage-bounded
`amountInMaximum`; the outer Universal Router plan then executes `SWEEP(ETH, MSG_SENDER, 0)` so the unused maximum is
returned in the same transaction. Twelve successful Foundry transactions cover this matrix:

| Currency surface | Four single-hop direction/exactness modes | Multihop input/output |
| --- | --- | --- |
| ERC-20 / Permit2 | quoted then executed | executed |
| Native ETH / reverse-leg Permit2 | quoted then executed | executed |

All eight quote-to-execution single-hop modes bind a nonzero `amountOutMinimum` or `amountInMaximum` derived from the
observed quote and reconcile the actual user deltas to that quote. They also reconcile executed gross quote value to
the exact project and Programmable fee liabilities. The native-input exact-output case additionally proves
`amountInMaximum > actualAmountIn`, the exact positive refund, and zero residual ETH in the Universal Router. Five
negative executions prove atomic failure for a tighter-than-quoted exact-input minimum, tighter-than-quoted ERC-20 and
native exact-output maxima, an expired deadline and changed
exact-output hookData. The multihop exact-output cases carry distinct bytes on the unhooked hop and the 32-byte gross
witness on the hooked hop, so swapped or dropped per-hop `hookData` fails execution. Exact output uses an exact `TAKE`
amount; exact input takes the open credit. Every route settles the open input debt from the initiating user and leaves
no router dust.

The tested compatibility set is deliberately exact:

| Component | Exact revision | Locked integrity / source |
| --- | --- | --- |
| Universal Router contract | `@uniswap/universal-router@2.1.0`, npm git head `67553d8b067249dd7841d9d1b0eb2997b19d4bf9` | `sha512-rt18...Ace0hg==`; creation-code keccak `0x6b797c56c9355176d9d15f9c70b159621bbd0db485822d2d02167b5aa1061173` |
| Universal Router SDK | `@uniswap/universal-router-sdk@5.11.2`, npm git head `fcfaace6e56b2339c61bb080d73b7308d5329a94` | `sha512-MeBj...9fXmBg==` |
| V4 SDK / V4Planner | `@uniswap/v4-sdk@2.3.1`, npm git head `57f126ee4ae5d435938569ad22c489e4a0262ca2` | `sha512-RByo...04uBJA==` |
| Permit2 source | commit `cc56ad0f3439c502c246fc5cfcc3db92bb8b7219` | codeload `sha512-DIvD...+BLa1w==` |
| Permit2 Solmate source | commit `8d910d876f51c3b2585c9109409d601f600e68e1` | codeload `sha512-4qey...P6PfQ==` |
| v4-core | `@uniswap/v4-core@1.0.2`, npm git head `59d3ecf53afa9264a16bba0e38f4c5d2231f80bc` | `sha512-X15T...c/e7lg==` |
| v4-periphery | `@uniswap/v4-periphery@1.0.3`, npm git head `60cd93803ac2b7fa65fd6cd351fd5fd4cc8c9db5` | `sha512-JxLL...NValsg==` |

The Router 2.1.0 artifact embeds v4-periphery commit `3779387e5d296f39df543d23524b050f89a62917`.
That artifact retains the V2.0 single-hop tuple but adds the V2.1.1 empty `minHopPriceX36` array to multihop tuples.
The parity encoder therefore selects those layouts per action, and both JavaScript and Solidity are hash-bound to the
same five vectors. The fifth vector binds the native exact-output outer command sequence (`V4_SWAP`, `SWEEP`) and both
outer inputs, including the exact SDK-encoded ETH refund parameters. This is an observed compatibility fact, not a
claim that arbitrary Router/SDK versions compose.

### Pinned SDK advisory triage

On 2026-08-07, `npm audit --json` reported 36 advisories in the exact install: 17 low, 9 moderate, 10 high and
0 critical. All 10 high package nodes descend from the offline Universal Router SDK compatibility dependency tree:
old nested OpenZeppelin packages; `@uniswap/swap-router-contracts`; the aggregate
`@uniswap/universal-router-sdk` node; Hardhat/Hardhat Watcher; `adm-zip`; `serialize-javascript`; `tmp`; `undici`; and
`ws`. The parity test gives these packages only fixed checked-in values and performs no network, WebSocket, archive,
temporary-file, signature or governance operation. The kernel compiles against root OpenZeppelin 5.6.1, and the
executed Universal Router bytecode is separately hash-bound. This is a scope triage, not a claim that the advisories are
fixed: do not expose the pinned SDK tree to untrusted input or use it as production application runtime without a
separate dependency review. No advisory-driven upgrade was applied because that would change the compatibility set.

Before adapting this kernel, read `SECURITY_PROPERTIES.md`, the canonical v2 fee policy, and the skill's security
workflow. Run static analysis, fuzz/invariant tests, integration tests against the exact intended router deployment,
independent review and deployment verification.

A launch package may call fee conformance complete only through the canonical typed receipt and vector-set contracts in
`references/fee-conformance-receipt-v1.schema.json` and
`references/fee-conformance-vector-set-v1.schema.json`. The receipt must bind this exact implementation digest, scope,
profile, execution-surface document and all four modes. The vector validator recomputes policy math and binds the exact
test evidence. The example JSON under `evidence/` remains a placeholder checklist, not a complete receipt.

## Deliberate boundaries

This starter does not implement `sync-custom-zero-amm`, `async-fill-batch`, or `custom-reviewed` (including externally
funded rates at or above 100%); dynamic LP fees;
multi-pool accounting; fee-on-transfer/rebasing quote assets; same-pool self-swaps; upgradeability; an indexer; or a
production deployment. The local quoter/router matrix is not RPC-backed `eth_call` evidence, fork evidence,
deployed-address verification, signature-based Permit2 coverage, a quoter/router audit or proof for a different package
revision. A quote is a reverted simulation, not an execution receipt or approval. Those are not forbidden product ideas
or surfaces. They need profile-specific evidence rather than being mislabeled as `standard-amm`.
