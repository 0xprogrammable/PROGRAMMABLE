# Stock-Paired V1

## Product boundary

Stock-Paired launches a new fixed-supply Programmable token into one Uniswap v4
pool quoted in one supported Ondo stock token. The launched token is not a share,
does not represent ownership in the underlying company and is not redeemable for
the selected stock. The stock token is the pool's quote asset.

The immutable base registry recognizes seven Ethereum Mainnet quote assets:

- NVDAon
- SPYon
- GOOGLon
- SLVon
- QQQon
- TSLAon
- AAPLon

The ETH coordinator exposes six of them: NVDAon, SPYon, GOOGLon, SLVon,
TSLAon and AAPLon. QQQon remains registered in the base contracts but is not a
coordinator route because its current ETH round trip fails the liquidity gate.
Adding another registry asset requires a new reviewed registry and launcher
deployment. Adding a safe ETH route requires a new coordinator deployment.

## User flow

1. Choose Stock-Paired.
2. Enter the token name, ticker, image, description and project links.
3. Choose one of the six ETH-routed quote assets.
4. Enter the Initial Buy in ETH.
5. Launch in one wallet transaction.

The launch coordinator routes ETH through the reviewed
WETH/USDC/stock-token path, creates the token, registers its fee policy,
initializes the pool, places the complete supply in a permanently locked
one-sided position and executes the creator's initial buy atomically. The
creator receives only the tokens returned by that Initial Buy.

## Economics

- Fixed supply: 1,000,000,000 tokens
- Transfer tax: 0%
- Buy fee: 1.00% of the quote-token amount
- Sell fee: 1.00% of the quote-token amount
- Creator rewards: 0.90%
- Programmable share: 0.10%, deducted from the 1.00%
- Base LP fee: 0
- Creator and Programmable rewards accrue in the selected stock token
- Initial spot valuation: approximately five units of the selected quote asset

The pool sorts currencies by address. If the stock token is `currency0`, its
initial tick is `+191200` and the launched token occupies the lower one-sided
range. If the stock token is `currency1`, the initial tick is `-191200` and the
launched token occupies the upper one-sided range. This keeps the same economic
orientation without mining token addresses.

## Reused Uniswap components

- `UERC20Factory` for deterministic fixed-supply ERC-20 creation and metadata
- `PoolManager` for pool state and flash accounting
- `PositionManager` for the initial liquidity position
- `PositionPlanner` behind the stateless `StockPairedPositionPlannerV1` adapter
- `PositionFeesForwarder` behind Programmable's permanent-lock factory
- `CurrencySettler` for ERC-20 settlement and ERC-6909 fee claims
- `BaseHook` for callback authorization and hook permission validation
- `StateView`, `V4Quoter`, Universal Router 2.1.1 and the v4 SDK for reads,
  quotes and atomic ETH-routed trades

The canonical Uniswap Liquidity Launcher auction contracts are not used. They
solve price discovery through a CCA, while this model needs an immediate,
deterministic pool like Classic.

## New contracts

### `StockQuoteRegistryV1`

An ownerless allowlist for exactly seven quote tokens. It records the accepted
token runtime, beacon and implementation hashes. New launches fail closed when
the shared issuer implementation no longer matches the reviewed snapshot.
Existing pools remain subject to the issuer's token controls.

### `QuoteAssetCreatorFeeHookV1`

A shared, non-upgradeable hook. It charges the fixed 1.00% fee in the stock
quote token on exact-input and exact-output buys and sells. It supports either
currency order, uses only PoolManager callbacks and holds fees as PoolManager
ERC-6909 claims until an authorized vault or the Programmable treasury claims.

### `QuoteAssetFeeSplitVaultV1`

An immutable beneficiary vault for one pool and one quote asset. Beneficiaries
and percentages are fixed at launch. Each beneficiary can claim only its own
share and can change only its own payout address.

### `StockPairedLaunchV1`

The atomic launch coordinator. It accepts only a ready asset from the immutable
registry, rejects fee-on-transfer behavior by exact balance checks, creates the
UERC-20, registers the pool, mints the complete one-sided position to the
permanent lock and executes the initial stock-token buy.

### `StockPairedEthLaunchCoordinatorV1`

An ownerless, non-upgradeable wrapper around the reviewed launcher. It accepts
ETH, routes it through fixed Uniswap v3 pools into the selected stock token and
passes the exact output into `StockPairedLaunchV1`. It forwards every token from
the Initial Buy to the creator and rejects residual balances, expired
transactions, unsupported routes and unprotected output.

### `StockPairedPositionPlannerV1`

A stateless adapter around Uniswap's official `PositionPlanner`. It builds the
correct one-sided range for either currency ordering. The launcher pins its
runtime hash so another planner implementation cannot be substituted.

## Trading

The canonical pool remains stock-token/new-token. Programmable presents ETH as
the user-facing asset and executes both legs atomically through Universal Router
2.1.1:

- buy: ETH to stock token through reviewed v3 pools, then stock token to the
  launched token through its exact v4 pool;
- sell: launched token to stock token through the exact v4 pool, then stock
  token to ETH through the reviewed v3 pools.

Before preparing a transaction, the server quotes the external route in both
directions. It fails closed when the round trip returns less than 90% of the
input. This gate is amount-specific and runs against current Mainnet state.
At the reviewed snapshot and in the latest pre-release quote check, six assets
pass the one-transaction ETH launch test. QQQon is not included in the
coordinator and remains unavailable through the ETH interface until a later
reviewed route passes the same gate.

Third-party terminals do not automatically inherit this mixed v3/v4 route.
GMGN, Fomo and other external interfaces must be tested separately and cannot
be represented as supported before they execute the route themselves.

## Runtime and issuer assumptions

Ondo controls the supported quote-token beacon and implementation. A future
upgrade, pause, block or transfer restriction can affect launches and trading.
The launch registry therefore gates new launches on the reviewed runtime, while
the interface checks transfer and route readiness before presenting a launch as
ready.

Programmable does not mint, redeem, custody or promise delivery of the
underlying shares. Primary Ondo mint and redemption APIs are outside V1.
Access to, transfers of and trading in the quote assets can depend on issuer
controls, jurisdiction, market hours and third-party eligibility. The product
must never describe Stock-Paired as universally available or the launched token
as a share.

The reviewed Mainnet router is Universal Router 2.1.1 at
`0x4C82D1fBFe28C977cBB58D8C7FF8FCF9F70a2cCA`, with runtime code hash
`0x70c9ea2b275087aea3d57ae48e2d30e272a07ff5b6c7974bd47c21478b37face`.
The older router used by the existing ETH-quoted models is not accepted for
this ERC-20/ERC-20 path.

## Release gates

The model is not production-ready until all of the following hold:

- unit tests cover both currency orders and all fee modes;
- stateful invariants bind hook claim balances to accrued liabilities;
- every one of the seven quote assets completes a Mainnet-fork launch;
- every exposed ETH-first asset completes a Mainnet-fork launch through the
  exact v3 and v4 route;
- currently thin assets fail closed without deploying a token or retaining
  user funds;
- stock-token buy, sell, creator claim and treasury claim complete on a fork;
- fee-on-transfer, issuer-runtime drift, unsupported asset, partial fill,
  reentrancy and unauthorized claim paths fail closed;
- Slither and Forge lint are reviewed;
- deployment bytecode, salts, addresses and runtime hashes are captured;
- application launch, Explore, token, Profile and rewards paths pass tests;
- desktop and mobile browser QA pass without console or network errors;
- the exact Mainnet deployment transactions simulate successfully.

External Hooklist, routing, explorer and scanner acceptance are separate
post-deployment decisions and cannot be represented as complete before those
providers confirm them.
