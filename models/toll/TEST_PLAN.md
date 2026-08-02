# Toll — Test Plan

## Unit and integration tests

29/29 tests passing in `test/TollHookV1.t.sol`.

### Coverage

| Area | Tests | Status |
|---|---|---|
| Pool registration | Register, duplicate registration revert, fee validation | ✅ |
| Buy fee | Flat buy fee applied correctly at 1% | ✅ |
| Sell fee — sniper tier | 10% fee for hold < 30 minutes | ✅ |
| Sell fee — warm tier | 5% fee for hold 30min–4h | ✅ |
| Sell fee — holder tier | 2% fee for hold 4h–24h | ✅ |
| Sell fee — diamond tier | 1% fee for hold > 24h | ✅ |
| Weighted entry tracking | First buy, DCA averaging, proportional shift | ✅ |
| Sell does not reset timer | Timer preserved after partial and full sells | ✅ |
| Fee accrual | Creator and platform fees accrue correctly | ✅ |
| Fee claiming | Vault claim, launcher claim, unauthorized revert | ✅ |
| Fee ratio verification | Sniper/warm = 2.0×, warm/holder = 2.5× | ✅ |
| LP lock | Forwarder timelock = max, operator = zero | ✅ |
| Access control | Unauthorized registration, claim, configuration | ✅ |
| tx.origin tracking | Tier resolved via tx.origin through router | ✅ |

### On-chain verification (Robinhood Chain 4663)

All tiers verified on production deployment with real swaps:
- `TestTiersRH.s.sol` — buys token, warps through each tier, sells and checks fee amounts
- Fee ratios confirmed: sniper/warm = 2.0×, warm/holder = 2.5×
- Real trader activity: 105 holders, fees accruing

## Fuzz tests

Not yet implemented. Planned coverage:

- Fee calculation with random buy/sell amounts (0 to max uint128)
- Weighted entry math with random sequences of buys
- Tier resolution at boundary timestamps (exact threshold ± 1 second)
- Fee accrual conservation (total fees = creator + platform, no loss)

## Invariant tests

Not yet implemented. Planned invariants:

- `totalNativeFeesAccrued ≥ creatorFeesAccrued + launcherFeesAccrued` (always)
- `creatorFeesAccrued` only increases between claims
- Weighted entry time never decreases for a wallet between buys
- Fee tier resolution is monotonically decreasing with hold duration
- No ETH can be extracted from hook except via authorized claim paths

## Fork tests

Production deployment verified via Forge scripts against live Robinhood Chain RPC:
- `DeployTollRH.s.sol` — full 7-contract deployment
- `LaunchTestTokenRH.s.sol` — atomic token launch with initial buy
- `TestTiersRH.s.sol` — tier progression test on live pool
- `TestSwapRH.s.sol` — buy/sell through UniversalRouter on live pool

## Compiler and dependencies

- Solidity: 0.8.26 (fixed)
- Forge: latest stable
- Uniswap V4 core: pinned via foundry.toml
- Programmable contracts: MIT fork, source included
