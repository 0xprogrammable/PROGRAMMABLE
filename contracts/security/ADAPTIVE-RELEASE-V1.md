# Adaptive V1 release procedure

This procedure is fail-closed. It prepares and verifies a release but does not
claim that Adaptive is live, audited or approved by Uniswap.

## Reviewed deployment unit

Ethereum Mainnet infrastructure consists of three new contracts:

1. `AdaptiveCurvePositionPlannerV1`
2. `AdaptiveCurveFeeHookFactoryV1`
3. `AdaptiveCurveLaunchV1`

The existing verified `LockedPositionFeeForwarderFactoryV1` is reused. A
dedicated `AdaptiveCurveFeeHookV1` is deployed atomically for each token launch
at a mined CREATE2 address. It is not a shared infrastructure deployment.

The planner is deliberately separate to keep the launcher below the internal
23,000-byte ceiling. It is stateless, and the launcher constructor accepts only
its exact compiled runtime codehash.

## Required local checks

From `contracts/`:

```sh
forge fmt --check
forge lint src/AdaptiveCurveFeeHookV1.sol \
  src/AdaptiveCurveFeeHookFactoryV1.sol \
  src/AdaptiveCurvePositionPlannerV1.sol \
  src/AdaptiveCurveLaunchV1.sol \
  script/DeployMainnetAdaptiveInfrastructureV1.s.sol
forge build --sizes
forge test --offline --match-path 'test/Adaptive*'
forge test --offline --match-path test/DeployMainnetAdaptiveInfrastructureV1.t.sol
node scripts/validate-adaptive-indexer-spec.mjs
node scripts/verify-adaptive-release-manifest.mjs
```

The last command verifies current artifacts, the deployment source commitment,
the disabled application manifest and every official Mainnet dependency across
two independent RPCs. It does not treat an undeployed release as live.

## Deterministic simulation

The deployment script requires only public planning inputs:

```text
ADAPTIVE_MAINNET_DEPLOYER
ADAPTIVE_MAINNET_START_NONCE
ADAPTIVE_MAINNET_TREASURY
```

`ADAPTIVE_MAINNET_TREASURY` must equal the reviewed treasury in the script.
`deploymentPlan` predicts the planner, factory and launcher CREATE addresses,
mines a valid counterfactual factory-hook salt and commits to the exact creation code,
dependencies and economics. `deployReviewed` rejects a stale nonce, occupied
address, wrong chain, wrong treasury or changed official dependency.

The release manifest stores a simulation-only candidate plan. Its deployer
nonce must be refreshed immediately before signing. A deployment of another
contract stack from the same account makes the candidate stale; plans for two
models must never be signed from the same nonce.

The script never reads a private key. A Forge run without `--broadcast` is a
simulation. Broadcasting and signing remain separate operator actions.

## Fork rehearsal

`DeployMainnetAdaptiveInfrastructureV1.t.sol` runs against a pinned Ethereum
Mainnet fork. It proves:

- official dependency addresses and runtime hashes;
- deterministic infrastructure addresses and nonce count;
- the planner runtime pin and 23,000-byte launcher ceiling;
- per-launch CREATE2 hook provenance;
- fixed-supply UERC20 creation and immutable curve registration;
- pool initialization and a permanently locked one-sided position;
- an optional atomic creator buy;
- no ETH or token custody left in the launcher or PositionManager;
- complete launch-record consistency.

Fork execution is evidence about the reviewed snapshot, not a substitute for
receipts from a real deployment.

## Post-deployment evidence

After confirmed receipts, update
`deployments/mainnet-adaptive-v1.json` with:

- deployer and reviewed starting nonce;
- planner, factory and launcher addresses;
- transaction hashes, ordered nonces, senders, created addresses, block numbers
  and successful receipts;
- actual runtime codehashes;
- deployment source commitment;
- exact Etherscan and Sourcify source-verification results with the reviewed
  compiler settings;
- signed lifecycle evidence for launch, buy, sell and both fee-claim paths,
  including event-derived creator and Launcher fee accounting.

Update the application deployment manifest with the same Adaptive factory and
launcher addresses and hashes. The planner address and hash remain mandatory in
the Adaptive release manifest because the launcher pins that dependency.

Then run:

```sh
node scripts/verify-adaptive-release-manifest.mjs --require-live
```

This queries Mainnet and rejects any mismatch in deterministic CREATE
addresses, deployment senders and nonces, receipts, creation code, runtime
code, exact immutable dependencies, economics, hook permission bits, Sourcify
and Etherscan source matches, signed lifecycle receipts and accounting, or
official dependencies. The application manifest must independently match every
Adaptive address, runtime hash, transaction and deployment block.

## Remaining production gates

- confirmed deployment receipts;
- exact source verification for all three infrastructure contracts and each
  per-launch hook;
- product preflight and indexer integration using the pinned manifest;
- monitoring for launches, fee accounting, claims and dependency drift;
- security-owner sign-off and any independent review required by the release
  policy.

Passing tests does not make the model Mainnet-ready.
