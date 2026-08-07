# Proposal

**Submission stage:** Proposal (flagship reference of an already-deployed system)
**Model id:** `relics-v4`

RELICS is a live, fully on-chain generative art collection on Ethereum mainnet whose Uniswap v4
hook turns real market history on one canonical $RELICS/WETH pool into permanent visual
condition; this application publishes the exact deployed hook source as an authorized public
flagship reference and asks for architecture review of that live artifact, not for a new launch.

## Design card

| Item | Confirmed design |
| --- | --- |
| Outcome | Collectors buy $RELICS on the canonical pool and awaken up to 10,000 Relic NFTs whose fully on-chain art is permanently forged by the market history the hook records. |
| Pool | $RELICS (currency0, `0x8F294a99a0609822C233b24867F331c292cE2DA9`) / WETH (currency1), fee 3000 (0.30% static LP fee), tick spacing 60, pool id `0x33d9b4089069272e5aeaeccf24bc710a7ee8cf65f4ecde682187a2fc355531ed`, hook `0xA6f73cc88723f04b85E2c2aF3e35F759Dc1A9440`. |
| During a trade | Completely standard v4 execution in all four quadrants. The hook observes in `afterSwap` (amounts, tick, optional bytes32 entropy salt) and writes `GlobalMarketState`; it has no before-hooks and no return-delta permissions, so it structurally cannot alter, tax or refuse any trade. |
| Value | The only fee anywhere is the 0.30% LP fee to pool liquidity providers via core v4 accounting. The hook collects nothing, holds nothing, and has no recipient. No project fee, no transfer tax, no hook-owned charge. |
| Creator choices | None remain. Everything was fixed at the 2026-08-03 launch; token and hook owners are `address(0)`. |
| Fixed platform rules | One canonical pool forever (one-shot binding, spent); every callback revalidates the full PoolKey and reverts `UnauthorizedPool` otherwise, so a second pool cannot even initialize against this hook. |
| Authorities | None live. Historical: the deployer's one-shot `bindCanonicalPool`, spent at launch, ownership then renounced. The NFT and renderer never had owners. |
| Dependencies | Uniswap v4 PoolManager singleton (`v4-poolmanager-ethereum`) and WETH9. Build closure pins v4-core 1.0.2, OpenZeppelin uniswap-hooks 1.2.2, OpenZeppelin contracts 5.6.1, all vendored byte-exact in the repository. |
| Failure | Any callback revert reverts the pool action atomically. On the canonical pool the hook's only revert paths are uint128 cumulative-volume overflow guards, unreachable in practice for a 10,000-unit fixed supply. The hook holds no funds, so no dependency failure can trap value in it. |
| Project surfaces | `relics-v4-hook` (the deployed flagship; exact source in `flagship/`) and `relics-token-contract` (the live ERC-20 + NFT dormancy layer, declared for honest review of its transfer coupling; source verified on Etherscan, outside this repo's declared closure). |
| Product surfaces | relics.wtf reads live chain state through a server-side RPC proxy; trading happens on app.uniswap.org (external client, no custom hookData). No Programmable product integration is requested. |
| Not used | Before-hooks, donate hooks, return deltas, dynamic fees, ERC-6909 claims, custom accounting, nested actions, oracles, keepers, signatures, cross-chain, external liquidity, async swaps, custom curves. Retirement: none exists by design — the system is immutable. |

## Why Uniswap v4 and architecture choice

`hook.used` is **true**. Only v4's hook callbacks let the pool itself write permanent market
state in the same transaction as the trade while remaining provably unable to influence
execution: the deployed permission set is exactly `afterInitialize | afterAddLiquidity |
afterSwap` (`0x1440`), with every before-hook and every return-delta bit zero at the address
level. The NFT renderer computes `tokenURI` from this state at read time — no image files, no
IPFS, no API — so the market is literally the medium.

The mandatory Programmable fee profile is **not integrated**: the deployed hook predates this
program, is immutable, and has no owner, so `programmableFee.collection.status` is honestly
`pending-hook-integration` and can never change for this instance. A Programmable-launch-ready
variant would be a new deployment integrating the fee into its single custom hook; whether that
is in scope for this application id is one of the two named maintainer decisions in
`submission.json.unresolved`.

## Lifecycle

All lifecycle phases are recorded retrospectively in `submission.json.launchLifecycle` — they
already executed on mainnet on 2026-08-03: fixed 10,000-unit mint at construction (no sale, no
presale, no allocation), one-shot pool binding + initialization at tick -82980, single-sided
genesis liquidity (all 10,000 $RELICS, zero seeded WETH), no project-funded first transaction
(`projectFundedBootstrapBuy = false` is release-gated), then permissionless public trading.
There is no fees-and-claims surface beyond the standard LP fee and no retirement path: the
system is immutable and market state accrues monotonically.

## Assets, pool behavior, callbacks, and integration

Assets, the exact PoolKey, all 14 permission booleans, the derived mask `0x1440`, PoolManager
authentication, hookData policy (optional bytes32 entropy salt, no identity, no financial
effect), zero-delta return shapes, and integration facts are declared in `submission.json`.
One deliberate, fully-disclosed token behavior deserves emphasis rather than burial:

**$RELICS transfer coupling.** Outflows retire just enough of the sender's awakened Relic NFTs
(LIFO, real ERC-721 burn events) to keep active NFTs ≤ whole-unit balance. Retirement work is
bounded at 16 per transfer; a transfer needing more reverts `PreparationRequired` until the
holder — and only the holder, `msg.sender`-gated — calls `prepareSell` to choose which Relics
go dormant. Amounts are never modified, buys and receipt are never blocked, and no operator,
allowlist, cooldown, cap or tax exists. This is declared with the strongest available label
(`transferImpact: can-restrict`) in `tokenBehaviorExtensions` so reviewers see it immediately.

## Deployed-source proof (why this repository is trustworthy)

The `flagship/` directory contains the exact 30-file standard-JSON closure that Etherscan
verified for the live hook, byte for byte, at the deployed compiler settings (solc 0.8.26,
optimizer runs 1, via-IR, cancun, no metadata hash, no CBOR). `flagship/test/DeploymentProof.t.sol`
proves offline that this tree reproduces `keccak256(creationCode ++ constructorArgs) =
0x8a34afeab7eb2fc0646a49fa6917a159c1ef5f2e959445ecfb53b42fde808535` — the pre-launch mined
init-code hash — and that its CREATE2 derivation (deployer `0x4e59b44847b379578588920cA78FbF26c0B4956C`,
salt `0x…1302`) lands exactly on the live address with flag bits `0x1440`. Machine-readable
provenance including the live runtime code hash is in `flagship/PROVENANCE.json`.

## Product integration plan

None requested. `integration.platformHandoff.intended` is false; routing uses the external
Uniswap interface (`uniswap-interface-api` mode) and the pool quotes there today with no custom
hookData. `uniswapRoutingStatus` is declared `required-not-submitted` because the WETH pairing
meets the published major-pair trigger and no allowlist submission has ever been made. The
repository root is a clean-room starter template so other builders can fork the architecture;
the template and the flagship share no code.
