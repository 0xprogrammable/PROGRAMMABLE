# Protocol revenue V2 security properties

## Status

The immutable Coordinator and Vault are deployed on Ethereum Mainnet and match their submitted creation and runtime
bytecode in Sourcify. The bounded ERC-7715 permission has been granted and stored outside the repository. Automation
remains disabled. No revenue has moved through this system yet, so deployment and source verification must not be
described as a successful production lifecycle.

The automated claim scope is intentionally limited to Classic V1 and Classic V2. Classic V3, Deep and quote-asset
hooks still require the revenue wallet as caller and remain manual.

## Fixed policy

Each successful cycle allocates exactly the native ETH deposited by the revenue wallet:

| Destination | Share |
| --- | ---: |
| Treasury `0x2Bb333d48DFAF1596D9036671d2E43168994249E` | 50% |
| `$V4` purchase | 49.5% |
| Keeper gas reserve | 0.5% |

The Vault has no owner, proxy, upgrade, pause, arbitrary-call, recovery, token-approval or liquidity-management
surface. The revenue wallet, treasury, keeper, `$V4`, Uniswap pool, router, shares and price limits are immutable.

## Wallet permission boundary

The browser-compatible ERC-7715 permission must contain all of the following on Ethereum Mainnet:

- native-token-periodic transfer with a maximum of `5 ETH` per `86,400` seconds;
- the fixed disposable keeper as the only redeemer;
- `ProtocolRevenueVaultV2` as the only payee or allowed target;
- empty calldata only;
- a finite expiry and replay protection.

The permission cannot call hook claims, the Vault processor or arbitrary wallet targets. The keeper pays transaction
gas. The revenue wallet private key is never stored by the automation.

## Claim boundary

`ProtocolRevenueClaimCoordinatorV2` only batches the existing permissionless Classic V1 and V2 hook claims. Both
hooks always pay their immutable launcher-fee recipient. The Coordinator cannot receive or redirect the ETH. Classic
V3 and Deep V1 require the revenue wallet as caller and remain outside unattended automation.

Permissionless third parties can trigger Classic V1 or V2 claims before the Coordinator. This cannot redirect funds;
the ETH still reaches the revenue wallet and can be transferred to the Vault on a later keeper run.

## Vault accounting

- Only a normal value transfer whose immediate sender is the immutable revenue wallet increases `pendingRevenue`.
- Pending revenue cannot exceed `5 ETH` before a cycle.
- Forced ETH is excluded from `pendingRevenue` and cannot be processed or recovered.
- A successful cycle clears exactly `pendingRevenue`; any revert restores the complete pre-cycle state.
- `totalRevenueDeposited = totalRevenueProcessed + pendingRevenue` for accounted revenue.
- `totalRevenueProcessed = totalTreasurySent + totalKeeperGasSent + totalNativeSwapped`.
- Purchased `$V4` is sent to the revenue wallet; the Vault retains no purchased token balance after success.

## Price and MEV boundary

The keeper submits through MEV Blocker's private `noreverts` endpoint. This reduces public-mempool exposure but is not
a cryptographic MEV guarantee. The Vault independently enforces a finalized-block reference tick, 30-minute maximum
observation age, 100-tick reference deviation, 100-tick per-chunk movement, 500-tick total movement, fee-aware minimum
output, `0.1 ETH` chunks and 32 chunks maximum. Any failed check reverts the complete cycle.

The runtime also has a server-side transfer ceiling bounded by the signed `5 ETH` daily permission. Releases can use a
smaller ceiling for a first-cycle canary without changing or expanding the wallet grant.

## Required release gates

1. deterministic, fuzz, invariant and Mainnet-fork tests;
2. Slither review and manual access-control, calldata, price, MEV and accounting review;
3. reviewed Mainnet deployment and exact runtime-code binding;
4. Sourcify source verification and Etherscan publication;
5. human-readable ERC-7715 grant inspection before signature;
6. Vercel secrets configured while automation remains disabled;
7. a deliberately small Mainnet claim, permission transfer and process canary;
8. explicit activation only after the canary receipts and balances match the policy.
