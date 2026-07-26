# Launcher protocol spike

This directory contains the contract work for Launcher’s first verified Uniswap v4 launch path. It is a protocol spike, not a production deployment.

The implementation deliberately reuses Uniswap’s UERC20Factory, LiquidityLauncher, Continuous Clearing Auction, LBPStrategy and v4 core contracts. Launcher’s own contract surface is limited to a fixed platform-fee hook and its deterministic deployer.

## Fixed V1 boundary

- Fixed-supply UERC20 token
- Official auction and liquidity-launch path
- One non-upgradeable hook per pool
- Static 0.30% LP fee
- Fixed 0.10% Launcher fee on the absolute unspecified swap amount
- Immutable pool, initializer and fee recipient
- Initial LP NFT held by Uniswap's official `PositionFeesForwarder`
- Zero transfer operator and maximum-block timelock
- Permissionless LP-fee collection to the immutable launch creator
- No owner, proxy, pause or mutable fee

The authoritative machine-readable specifications are in [`spec/verified-standard-v1.json`](spec/verified-standard-v1.json) and [`spec/behavior-modules.v1.json`](spec/behavior-modules.v1.json).

## Local setup

```sh
./scripts/bootstrap-deps.sh
forge fmt --check
forge build
forge test
```

Every dependency is checked out at an exact commit. The bootstrap script stops if an existing checkout does not match its pin.

## Sepolia preflight

The public treasury, test deployment wallet and LP custody policy are recorded in [`config/deployment-inputs.v1.json`](config/deployment-inputs.v1.json). The read-only Sepolia dependency snapshot can be checked with:

```sh
npm run contracts:sepolia:validate
```

`script/DeploySepoliaInfrastructureV1.s.sol` deploys only Launcher’s two permissionless factories. It refuses the wrong chain, wrong broadcaster or changed official dependency bytecode. It does not read a private key; broadcasting must use a local Foundry account or hardware wallet.

## Evidence boundary

Passing local and fork tests does not make these contracts audited or production-ready. Before mainnet, the contracts still require independent review, a signed and reproducible deployment rehearsal on Sepolia, verified bytecode, production signer controls and a final check against current official Uniswap deployments.

The current security evidence and blockers are recorded in [`security/REVIEW-2026-07-26.md`](security/REVIEW-2026-07-26.md), with testable properties in [`security/SECURITY-PROPERTIES.md`](security/SECURITY-PROPERTIES.md).
