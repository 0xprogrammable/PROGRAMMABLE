# Toll

**Status:** Candidate<br>
**Target network:** Robinhood Chain (4663)<br>
**Model id:** `toll`<br>
**Builder:** [palisade-dev](https://github.com/palisade-dev)<br>
**Beneficiary:** `0x02a11a5bE7A64043bC6Cea68137cfab3EBCF07f1`

Time-weighted dynamic sell fees for Uniswap V4. Flat buy fee with four-tier sell fee that decays based on hold duration. Snipers and flippers pay more; patient holders pay less.

## Behavior

### Lifecycle

1. **Launch:** Creator calls `TollLaunchV1.launch()` with token metadata, fee configuration and initial buy amount. In a single atomic transaction the launcher:
   - Creates a UERC20 token via `UERC20Factory`
   - Deploys a `ClassicRewardVaultV1` for fee distribution
   - Registers the pool's fee configuration on the hook
   - Initializes the Uniswap V4 pool
   - Locks LP permanently via `TollPositionForwarder` (timelock = `type(uint256).max`)
   - Executes the creator's initial buy

2. **Trading:** Every swap through the pool is intercepted by `TollHookV1`. The hook resolves the applicable fee tier based on the trader's weighted average hold duration and charges the fee as a portion of the native ETH side of the swap.

3. **Fee accrual:** Fees split into creator fees (99.9%) and platform fees (0.1%). Creator fees are claimable through the reward vault. Platform fees are claimable by the launcher fee recipient.

4. **Claims:** The vault calls `hook.claimCreatorFees(poolId)` to pull accrued creator fees, then distributes to beneficiaries by share. Platform fees are claimed via `hook.claimLauncherFees()`.

### Hold-time tracking

Each wallet's entry time is tracked as a weighted average across all buys through the pool:

```
weightedEntry = (oldEntry × oldTokens + now × newTokens) / totalTokens
```

- First buy sets entry to current block timestamp
- Subsequent buys shift entry forward proportionally
- Selling does not reset the timer (loyalty is preserved)
- Only pool swaps are tracked; ERC-20 transfers are untracked

Uses `tx.origin` for trader identity so tier tracking works through UniversalRouter, aggregators and any swap path. Trade-off: smart contract wallets (e.g. Safe) track the signer EOA, not the wallet address.

## Pool and hook

### Pool shape

- Currency pair: UERC20 / native ETH
- Initial tick: 204200
- Tick spacing: 200
- LP fee: 0 pips (all fees via hook)
- Single-sided: ETH is always currency0

### Hook permissions

- `beforeSwap`: resolves fee tier, applies dynamic fee
- `afterSwap`: records entry time for buys, accrues fees
- `beforeAddLiquidity`: blocked (LP locked at launch)

No `afterInitialize`, no `beforeDonate`, no return deltas beyond fee charging.

### Immutable parameters

All fee percentages are set at launch in `TollFeeConfig` and cannot be changed:
- `buyFeeBps` — flat buy fee
- `sniperSellFeeBps` — sell fee for hold < threshold 1
- `warmSellFeeBps` — sell fee for hold between threshold 1 and 2
- `holderSellFeeBps` — sell fee for hold between threshold 2 and 3
- `diamondSellFeeBps` — sell fee for hold > threshold 3

Time thresholds are hardcoded constants in the hook contract:
- `SNIPER_THRESHOLD`: 30 minutes
- `WARM_THRESHOLD`: 4 hours
- `HOLDER_THRESHOLD`: 24 hours

### External calls

- `UERC20Factory` (Uniswap): token creation
- `PoolManager` (Uniswap V4): pool initialization, swap execution
- `PositionManager` (Uniswap V4): LP minting and locking
- `ClassicRewardVaultV1` (Programmable): fee distribution to beneficiaries
- No oracles, no external price feeds, no governance

### Privileged roles

None post-launch. No owner, no admin, no pause function. The hook is non-upgradeable with no proxy pattern. LP is permanently locked (timelock = max uint256, operator = address(0)).

## Economics

### Fee tiers (production deployment)

| Tier | Hold Duration | Sell Fee |
|---|---|---|
| Sniper | < 30 minutes | 10% |
| Warm | 30min – 4 hours | 5% |
| Holder | 4h – 24 hours | 2% |
| Diamond | > 24 hours | 1% |

Buy fee: 1% flat for all traders.

### Fee split

- 99.9% to token creator (via `ClassicRewardVaultV1`)
- 0.1% to Programmable (via `launcherFeeRecipient`)

Fees are denominated in native ETH and accrued on every swap.

### Worked example

A trader buys 1 ETH worth of tokens:
- Buy fee: 1% = 0.01 ETH
- Creator receives: 0.01 × 99.9% = 0.00999 ETH
- Platform receives: 0.01 × 0.1% = 0.00001 ETH

Same trader sells after 15 minutes (sniper tier):
- Sell fee: 10% of ETH output
- On 0.95 ETH gross output: 0.095 ETH fee
- Creator: 0.09491 ETH, Platform: 0.000095 ETH

### Rounding

Fee calculation uses integer division (Solidity default). Remainders round down, favoring the trader. No fee-on-fee compounding.

### Liquidity custody

LP position is minted to a `TollPositionForwarder` with:
- `timelockBlockNumber = type(uint256).max` (permanent lock)
- `operator = address(0)` (no one can modify)
- Collected LP fees are forwarded to the creator's reward vault

## Production deployment

### Robinhood Chain (4663)

| Contract | Address |
|---|---|
| TollHookV1 | `0x29aA731ef79E1c1c4eE63c67a83B96Cc446820Cc` |
| TollLaunchV1 | `0x53F3A5f85Cd084373f4B5C9d7a633180a6335f86` |
| TollPositionForwarderFactory | `0x4aaFb8e19d0ae7219EabEE4EC5D5f1887C581eDC` |
| ClassicRewardVaultFactoryV1 | `0xFC208a5fFa0AFeB3eA44B28c166e1cFCF00b465c` |
| ClassicCtoAuthorityV1 | `0x02a81969d7AA9fFc90a84D01D8FAd897c0E843E8` |
| ClassicLaunchPolicyV1 | `0x840D60C8f4aC3Fe3aED6C87d4087f2d70595248b` |
| ClassicInitialBuyVestingWalletFactoryV1 | `0x4eF237505F55dC0e7689FF687E8BF7fc57C34714` |

### Proof of token

$TOLL — the first token launched through the Toll hook:

| | Address |
|---|---|
| Token | `0xD095A6239442c8e9dD33dE1eeD41B37E3fF436b4` |
| Reward Vault | `0xB6e98fFD88183a3c4E0C64Bd265361f9eBc29d07` |
| LP Forwarder | `0x36BFFa767E9d27761B70a8C518DF6a6eB15Fafa5` |

- 105 holders
- All fee tiers verified on-chain (sniper 10%, warm 5%, holder 2%)
- Fee ratios confirmed: sniper/warm = 2.0×, warm/holder = 2.5×
- LP permanently locked
- Dev buy burned to `0x...dEaD`

All contracts verified on [Blockscout](https://robinhoodchain.blockscout.com).

## Release gates

- [x] Complete behavior, economics and threat model
- [x] Implement unit and integration tests (29/29 passing)
- [x] Fixed compiler (Solidity 0.8.26) and dependency versions
- [x] Production deployment on Robinhood Chain with verified source
- [x] Live token with real trading volume and fee accrual
- [ ] Independent security audit
- [ ] Fuzz and invariant test coverage
- [ ] Ethereum mainnet deployment

See [`SECURITY.md`](SECURITY.md) and [`TEST_PLAN.md`](TEST_PLAN.md).
