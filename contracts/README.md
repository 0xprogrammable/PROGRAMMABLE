# Launcher protocol spike

This directory contains Launcher’s first four protocol-tested Uniswap v4 launch paths. It is a protocol workspace, not a production deployment.

The implementation deliberately reuses Uniswap’s UERC20Factory, LiquidityLauncher, Continuous Clearing Auction, LBPStrategy, PositionManager and v4 core contracts. Launcher’s own surface is limited to two immutable hook families, deterministic factories and two direct atomic launch entry points.

## Protocol-tested variants

- Auction launch: 50% of supply is sold through the official four-hour CCA, 50% is reserved for the v4 position and all auction proceeds fund the locked full-range LP while the pinned factory has no protocol fee controller
- Direct v4 pool: the creator selects the opening price and supplies the initial ETH/token liquidity
- Existing token pool: the configured Uniswap factory proves an existing UERC20’s origin and its recorded creator supplies direct liquidity
- Bounded dynamic fee auction: the official auction path migrates into a pool whose LP fee follows a fixed 0.30–1.00% tick-movement rule
- New tokens use a fixed supply and 18 decimals; existing UERC20s retain their original fixed supply and decimals
- One non-upgradeable hook per pool
- Fixed 0.30% LP fee or the separately tested bounded 0.30–1.00% rule
- Fixed 0.10% Launcher fee on the absolute unspecified swap amount
- Immutable pool, initializer and fee recipient
- Initial LP NFT held by Uniswap's official `PositionFeesForwarder`
- Zero transfer operator and maximum-block timelock
- Permissionless LP-fee collection to the immutable launch creator
- No owner, proxy, pause or admin-set fee

The authoritative machine-readable specifications are in [`spec/launch-variants.v1.json`](spec/launch-variants.v1.json), [`spec/verified-standard-v1.json`](spec/verified-standard-v1.json), [`spec/bounded-dynamic-fee-v1.json`](spec/bounded-dynamic-fee-v1.json), [`spec/direct-standard-v1.json`](spec/direct-standard-v1.json), [`spec/existing-uerc20-standard-v1.json`](spec/existing-uerc20-standard-v1.json) and [`spec/behavior-modules.v1.json`](spec/behavior-modules.v1.json).

## Local setup

```sh
./scripts/bootstrap-deps.sh
forge fmt --check
forge build
forge test
```

Every dependency is checked out at an exact commit. The bootstrap script stops if an existing checkout does not match its pin.

The checked-in Ethereum and Sepolia snapshots can be compared with Uniswap’s current machine-readable deployment registry:

```sh
npm run contracts:official-deployments
npm run contracts:variants
```

The checks fail when a required contract is missing, deprecated, points to a different address, lacks an official source link, comes from a newer dataset than the checked-in snapshot or contradicts the launch catalog. Run them immediately before every rehearsal or broadcast.

## Sepolia preflight

The public treasury, test deployment wallet and LP custody policy are recorded in [`config/deployment-inputs.v1.json`](config/deployment-inputs.v1.json). The read-only Sepolia dependency snapshot can be checked with:

```sh
npm run contracts:sepolia:validate
```

`script/DeploySepoliaInfrastructureV1.s.sol` deploys Launcher’s three permissionless factories and `DirectLiquidityLauncherV1`. The launcher exposes separate atomic methods for a new fixed-supply token and for a provenance-verified existing UERC20. The script refuses the wrong chain, wrong broadcaster or changed official dependency bytecode. It does not read a private key; broadcasting must use a local Foundry account or hardware wallet.

The web auction path calls Uniswap’s official LiquidityLauncher directly. Launcher’s factories deploy the deterministic permanent LP recipient and either the fixed-fee or bounded dynamic-fee hook first. The final wallet transaction then atomically creates the UERC20 and registers the complete CCA/LBP migration composition.

## Evidence boundary

Passing local and fork tests does not make these contracts audited or production-ready. Before mainnet, the contracts still require independent review, a signed and reproducible deployment rehearsal on Sepolia, verified bytecode, production signer controls and a final check against current official Uniswap deployments.

The current security evidence and blockers are recorded in [`security/REVIEW-2026-07-26.md`](security/REVIEW-2026-07-26.md), with testable properties in [`security/SECURITY-PROPERTIES.md`](security/SECURITY-PROPERTIES.md), a monitoring specification in [`security/MONITORING-AND-INCIDENT-RESPONSE.md`](security/MONITORING-AND-INCIDENT-RESPONSE.md) and a nine-category maturity assessment in [`security/MATURITY-2026-07-26.md`](security/MATURITY-2026-07-26.md).
