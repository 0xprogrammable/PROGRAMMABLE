# Classic V4 release preparation

## Status and scope

Classic V4 is an additive, source-only release candidate. This document and the accompanying deployment script are not
deployment evidence. No V4 address, transaction, deployment block, source-verification result, lifecycle result or
production activation exists until it is independently recorded from the target chain.

Classic V3 remains immutable and supported as a historical release. V4 does not replace, relabel or mutate V3 tokens,
pools, claims or indexer records.

The V4 deployment sequence creates exactly four new contracts:

1. `EthCreatorFeeHookFactoryV4`
2. One CREATE2-mined `EthCreatorFeeHookV4`
3. `ClassicPositionPlannerV1`
4. `MemeLaunchV3`

It reuses the already deployed V3 CTO authority, reward-vault factory, initial-buy custody factory, launch policy and
permanent position-forwarder factory. The script accepts those five addresses as explicit `Inputs` and fails unless
their target-chain addresses, runtime code hashes and immutable relationships match the verified V3 release.

No V4 deployment manifest is included in source preparation because there are no real V4 deployment addresses yet.

## Additive release identity

The integration release identifier is `classic-v4`, with new distinct source names:

- `ClassicV4Hook`
- `ClassicV4Launcher`

The V3 sources and `classic-v3` identity must stay registered. V4 must not be indexed under a V3 address or release
label. The new hook address is part of every V4 PoolKey and therefore every V4 pool has its own canonical PoolId.

## Stable pool and trading shape

Classic V4 deliberately preserves the terminal-facing Uniswap v4 shape:

- Official Ethereum v4 PoolManager
- `currency0 = address(0)` for native ETH
- `currency1 = launched token`
- Static pool fee `fee = 0`
- `tickSpacing = 200`
- `hooks = exact canonical Classic V4 hook`
- Empty swap hook data
- Existing official PositionManager, V4Quoter, Permit2 and Universal Router dependencies
- Exactly one complete-supply position, permanently locked from launch

The hook permission mask is exactly:

- `beforeInitialize`
- `beforeSwap`
- `afterSwap`
- `beforeSwapReturnDelta`
- `afterSwapReturnDelta`

No upgrade proxy, pause role, fee setter, migration role or custody withdrawal is added.

## Canonical Router boundary

Mainnet launches are router-only. `MemeLaunchV3.launchFor` accepts calls solely from the canonical Launch Stamp Router
`0x8622DD5bAb44185f2A458ac90384Ac99248f8d56`, whose pinned runtime hash is
`0x40e27ecf201761d5eb66bc4f2d5c6124831ef078d7baf458ca5f41b1a8108546`. The Router passes the real launch wallet
explicitly; direct wallet calls revert and cannot create an unstamped platform launch.

The canonical Router V1 parameter ABI has no liquidity-mode field, and neither does `MemeLaunchV3`. The complete
`creatorSalt` remains creator entropy. The one reviewed liquidity range is hardwired in the pinned planner, so neither
the UI, Router nor a caller can select a second range or migration lifecycle.

## Fee semantics

Buy and sell fees remain independently immutable per pool. V4 accepts `10` through `1,000` basis points in `10` basis
point steps.

- Programmable share: fixed `10 bps` of gross native value
- Creator share: selected directional total minus the Programmable share
- At the `10 bps` minimum: creator share is exactly zero and all rounded fee wei belongs to Programmable
- ERC-20 transfer tax: zero
- Pool LP fee: zero

The return-delta accounting and claim surfaces remain unchanged. Every nonzero returned fee delta must remain backed by
the hook's native PoolManager claim balance.

## Canonical liquidity range

`ClassicPositionPlannerV1` exposes no preset or arbitrary tick input. Every launch uses the full one-billion-token
supply in one position from tick `174800` to `204200`. Compared with the previous broad Classic range, this produces
about `29.86%` more active liquidity at launch without adding capital, changing the opening tick or creating a second
pool.

The lower tick is a real endpoint:

- The covered token-price increase is approximately `1.0001^(204200 - 174800)`, or about `18.9x`.
- Complete-supply net buy capacity is approximately `5.89564 ETH`, before gross swap fees.
- A buy beyond the remaining range reverts atomically; a sell can return token inventory to the same position.
- There is no reserve vault, graduation, migration or creator-withdrawable LP path.

Product copy may say about `29.86%` more active launch liquidity. It must not claim 30% more deposited capital,
guaranteed 30% lower slippage or deeper liquidity at every future price.

## Stable indexer event surface

The launcher preserves these exact event signatures and indexed layouts:

```text
MemeTokenLaunchedV2(address indexed deployer,address indexed token,bytes32 indexed poolId,address feeHook,address rewardVault,address positionRecipient,uint256 positionTokenId,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,bytes32 rewardConfigurationHash,bytes32 launchHash)
MemeLiquidityConfiguredV2(address indexed token,uint256 totalSupply,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,int24 initialTick,int24 tickLower,int24 tickUpper,uint24 lpFeePips,bytes32 launchHash)
MemeCreatorInitialBuyV2(address indexed deployer,address indexed token,bytes32 indexed poolId,uint256 nativeAmount,uint256 tokenAmount,bytes32 launchHash)
MemeCreatorInitialBuyCustodyV2(address indexed deployer,address indexed token,address indexed custody,uint8 mode,uint16 durationDays,uint16 cliffDays,bytes32 configurationHash,bytes32 launchHash)
```

The hook preserves:

```text
PoolRegistered(bytes32 indexed poolId,address indexed token,address indexed rewardVault,address registrar,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,bytes32 rewardConfigurationHash)
PoolFeeDisclosure(bytes32 indexed poolId,address indexed token,address indexed rewardVault,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,uint16 buyCreatorFeeBps,uint16 sellCreatorFeeBps,uint16 launcherFeeBps,uint16 transferTaxBps,uint24 lpFeePips)
NativeSwapFeesAccrued(bytes32 indexed poolId,address indexed swapSender,bool indexed isBuy,uint16 appliedTotalSwapFeeBps,uint256 grossNativeAmount,uint256 creatorFee,uint256 launcherFee)
CreatorFeesClaimed(bytes32 indexed poolId,address indexed rewardVault,address indexed caller,uint256 amount)
LauncherFeesClaimed(address indexed treasury,address indexed recipient,address indexed caller,uint256 amount)
```

The launcher also retains `launchHashOf(address)` and `poolKey(address)`. New exact V4 source addresses and deployment
blocks are still required; ABI compatibility alone is not canonical release authorization.

## Deployment-script controls

`DeployClassicV4InfrastructureV1.s.sol` prepares Ethereum Mainnet and a structural Sepolia rehearsal with the same
official dependency and runtime-codehash pins used by the verified V3 release. Mainnet additionally pins the canonical
Launch Stamp Router address and runtime hash. Sepolia has no equivalent canonical Router release and is not a public
launch environment. Before constructing V4 the script verifies:

- Exact five shared V3 input addresses for the selected chain
- Exact runtime code hash of every shared input
- Reward-vault factory to CTO-authority binding
- Current CTO authority and no pending authority transfer
- Position-forwarder factory to official PositionManager binding
- Zero forwarder operator and `uint256.max` timelock
- Existing custody-duration and launch-policy constants

After simulation it verifies:

- Deterministic four-transaction nonce plan
- CREATE2 hook prediction and exact hook-address permission bits
- Factory provenance for the mined hook
- Exact runtime code hashes for the stateless hook factory and position planner
- Nonempty hook and launcher runtime plus the project's `24,000`-byte launcher limit
- Every hook and launcher constructor dependency
- Fee, PoolKey, canonical range, supply and initial-tick constants
- Captured runtime code hashes for all four new contracts

Calling the deployment path requires all of the following even for a Forge simulation:

- `CLASSIC_V4_MAINNET_OWNER_APPROVED=true` or `CLASSIC_V4_SEPOLIA_OWNER_APPROVED=true`
- The matching chain-prefixed `DEPLOYER`
- Exact starting nonce and launcher-fee recipient
- Exact five shared dependency inputs
- The matching chain-prefixed `SOURCE_COMMITMENT` for the final compiled source and selected chain

An actual transaction additionally requires Forge `--broadcast` and an operator-controlled signer. The script never
reads a private key. Source preparation does not authorize broadcasting.

## Required integration packet

After an owner-authorized deployment, the contract workstream must hand the integration owner one immutable packet with:

- Chain ID, `classic-v4` label and exact reviewed source revision
- Deployer, starting nonce and four transaction hashes
- Hook factory, hook, planner and launcher addresses
- Canonical Launch Stamp Router address, runtime hash and router-only launcher binding
- CREATE2 hook salt and permission mask
- Deployment block for every new address
- Runtime byte length and code hash for all four new contracts
- Source commitment and compiler/settings evidence
- Exact official and reused shared dependency addresses and runtime hashes
- All constructor and immutable bindings
- Event signatures and ABI artifact hashes
- PoolKey constants and the canonical tick range
- Explorer/Sourcify source-verification evidence
- Canary token, launch hash and PoolId

The integration owner then adds V4 as a new Envio source/release, action resolver, trade resolver, Explore/Profile release
binding and production manifest entry. V3 remains additive historical data. Envio must start from the exact V4 deployment
block before the website launch UI changes to V4.

## Canary and release gates

Sepolia should be rehearsed first. One low-value Mainnet canary is required before product activation. The canary must
prove, independently:

1. The one canonical Classic launch on the pinned official dependencies
2. Exact canonical `launchAndStampV1` permit, Router stamp, launch kind `2`, component proofs and PoolId recomputation
3. Locked NFT ownership, nonzero liquidity, zero operator and maximum timelock
4. A `10 bps` initial buy with zero creator accrual and Programmable-only fee accrual
5. Buy and sell quoting/routing through the official V4Quoter and Universal Router
6. Exact behavior directly before, at and beyond the finite range endpoint, including atomic rollback
7. Creator-vault and Programmable claims
8. Envio completeness/provenance under `classic-v4` without V3 duplication
9. Exact selected external-terminal API discovery

Canonical PoolManager events and the stable PoolKey make V4 standards-compatible. They cannot guarantee that every
third-party terminal immediately ingests a new custom-hook address. Terminal availability must be reported only for the
providers actually checked after deployment.
