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

## Evidence boundary

Passing local and fork tests does not make these contracts audited or production-ready. Before mainnet, the contracts still require independent review, reproducible deployment rehearsal on Sepolia, verified bytecode, operational key decisions and a final check against current official Uniswap deployments.

The current security evidence and blockers are recorded in [`security/REVIEW-2026-07-26.md`](security/REVIEW-2026-07-26.md), with testable properties in [`security/SECURITY-PROPERTIES.md`](security/SECURITY-PROPERTIES.md).
