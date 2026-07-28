# Deep FullRange Mainnet release

Status: deployed on Ethereum Mainnet, disabled pending final lifecycle and keeper verification.

The checked-in release is deliberately disabled. Its deployment receipts,
runtime hashes, immutable configuration and source matches have been recorded.
The canary launch and oracle-growth transaction are also recorded. The release
must remain unavailable in the app until real fee processing, full-range
compounding and the production keeper path are independently verified.

## Release identity

- Product model: `deep`
- Contract release: `liquidity-growth-full-range-v1`
- Release version: `deep-full-range-v1`
- Chain: Ethereum Mainnet, chain ID `1`
- Treasury: `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`
- Source commitment:
  `0x82f6e2745dfbf54f40eae80df645bc75a7952e0505dd0621437dd233a619acfd`
- Manifest:
  `contracts/deployments/mainnet-deep-full-range-v1.json`
- Schema:
  `contracts/deployments/schema/deep-full-range-release-v1.schema.json`

The source commitment binds the eleven reviewed creation bytecodes, official
Uniswap dependencies, treasury, fixed market policy, growth policy and the
zero-admin custody assumptions.

## Six-transaction deployment

`DeployMainnetDeepFullRangeInfrastructureV1.s.sol` accepts an explicit
deployer, treasury and starting nonce. A normal Forge script run only simulates.
Broadcasting remains a separate operator action and is not performed by any
release check.

| Nonce offset | Action | Result |
| ---: | --- | --- |
| 0 | CREATE `FeeSplitVaultFactoryV1` | reward-vault factory |
| 1 | CREATE `LiquidityGrowthFeeOracleHookFactoryV1` | hook factory |
| 2 | call the hook factory with a mined salt | shared CREATE2 fee hook |
| 3 | CREATE `LiquidityGrowthRangeSourceFactoryV1` | TWAP range-source factory |
| 4 | CREATE `LiquidityGrowthFullRangeVaultFactoryV1` | vault factory and its internal implementation |
| 5 | CREATE `LiquidityGrowthFullRangeLaunchV1` | launcher and its internal automation and planner |

The script predicts every CREATE and CREATE2 address before the first
transaction. It rejects a stale nonce, wrong treasury, occupied target,
dependency runtime drift, incorrect hook permission bits, unexpected immutable
configuration, oversized runtime or a final nonce other than start plus six.

Do not reuse a candidate plan after another transaction changes the deployer
nonce. Refresh and review the complete plan immediately before signing.

## Dependency provenance

The manifest pins exact Mainnet addresses and runtime hashes for PoolManager,
PositionManager, StateView, V4Quoter, UERC20Factory, Permit2, Universal Router
and the existing locked-position forwarder factory. It also records the exact
git commits for v4-core, v4-periphery, OpenZeppelin Contracts, OpenZeppelin
Uniswap Hooks, Uniswap Liquidity Launcher and UERC20Factory.

The deployment rehearsal uses Mainnet block `25,622,180`, the first pinned block
in this repository that contains the existing forwarder factory. Behavioral
fork tests remain pinned to block `25,612,664`.

## Local preflight

Run the complete local package:

```sh
npm run contracts:deep-full-range:fork-preflight
```

The script checks:

1. artifact hashes, source commitment, dependency commits and the disabled app
   manifest;
2. the deterministic six-transaction deployment on a pinned Mainnet fork;
3. the exact official dependency behavior fork;
4. all FullRange contract and security tests;
5. the CI invariant profile at 1,000 runs and depth 128.

The frozen local pass contains 4 deterministic deployment tests, 50 FullRange
tests, 6 official Mainnet-fork tests and 9 CI invariant tests. The preflight
rejects a changed test count instead of silently carrying an old result
forward.

These results are local evidence. The current manifest remains
`releaseEligible: false`.

## Mainnet completion gates

Before activation, the manifest must contain:

- the exact pushed release commit and refreshed deterministic plan;
- all nine infrastructure addresses, six transaction hashes and successful
  receipts;
- the first deployment block as `startBlock`;
- runtime hashes confirmed through two independent RPC providers;
- decoded and ABI-encoded constructor arguments for every infrastructure
  contract, including internal CREATE deployments;
- exact-match Etherscan and Sourcify source records;
- a real canary launch, oracle-growth transaction, fee-processing transaction
  and full-range compounding evidence;
- an evidence hash binding that lifecycle to this release.

Then run:

```sh
npm run contracts:deep-full-range:manifest:live
```

The live verifier also reads immutable dependencies and policy values from the
deployed contracts. It refuses an app manifest that differs by one address,
hash, block, transaction or release field.

## App and keeper activation

The production app manifest contains the deployed Deep addresses and runtime
hashes, but keeps `releaseEligible: false`. Deep cannot pass the API preflight
until every release field, source record and lifecycle artifact matches the
reviewed release.

The keeper reads the same release manifest before it starts. Both execution
switches may be true and it will still reject transaction submission unless the
manifest binds the verified automation address and runtime hash to the keeper
configuration.

The reviewed default keeper envelope is:

- four vaults per batch;
- `3,000,000` maximum gas;
- 20 percent padding on the higher of two independent estimates;
- `0.03 ETH` hard subsidy cap per vault;
- 12 confirmations and two independent read RPCs.

Measured first-processing work for four vaults is `2,344,075` gas and pads to
`2,812,890`. A configured batch above four requires an explicit reviewed gas
ceiling of at least `6,000,000`; eight is the absolute operational maximum.

## Known limits

- Slither 0.11.5 reported no high finding in the analyzable paths, but it could
  not generate IR for some packed Uniswap v4 delta paths. The retained
  compiler-AST surface, authorization diagrams and sanitized IR-warning excerpt
  under `contracts/security/diagrams/full-range-v1/` document that limitation.
- A same-pool TWAP cannot distinguish a market that remains manipulated for the
  full 30-minute window. Fixed depth, reserve, chunk and total-growth caps bound
  this risk; they do not turn the pool into an independent price oracle.
- There is no independent external audit in this release package.
- Source verification, monitoring and provider-backed product E2E remain
  separate from local Forge success.
