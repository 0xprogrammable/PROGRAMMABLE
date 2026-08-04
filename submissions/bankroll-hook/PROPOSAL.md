# Proposal

Submission stage: local prototype

Model id: `bankroll-hook`

## Outcome

Bankroll Hook gives a newly launched token one finite game season. A trader may attach a fixed-odds WETH wager to a successful exact-input swap. A separately funded WETH bankroll reserves the maximum loss before the hook creates the ticket. Ordinary swaps remain ordinary.

The current repository implements and tests the hook, wager router, CREATE2 deployment boundary, fixed-token launch, permanent position custody, bankroll accounting and Chainlink VRF v2.5 adapter. It also includes a React review demo. The launch test uses real Uniswap v4 PoolManager and PositionManager contracts with a local deterministic UERC20 factory. The repository does not claim deployment or product availability.

## Why Uniswap v4

The hook is the non-bypassable boundary for one canonical pool. It observes successful execution, direction, exactness and actual native quote volume. It can therefore charge the Programmable fee and create a wager ticket from the same atomic swap result.

An app or ordinary router cannot prove those facts without trusting an offchain report. A transfer tax cannot identify one PoolId or distinguish swaps from liquidity movement through the shared PoolManager.

## Design card

| Item | Design |
| --- | --- |
| Pool | Native ETH currency0, launched token currency1, zero LP fee, tick spacing 200 and one hook instance |
| Ordinary trades | Both directions and exact-input or exact-output with empty hook data |
| Wagered trades | Exact-input only, both directions, through one immutable router |
| Odds | Equal win or loss probability and 1.96x gross payout |
| Volume cap | Stake is at most 20% of executed gross native quote |
| Solvency cap | Reserved exposure is at most 80% of bankroll assets and never more than all assets |
| Capacity | Up to 64 tickets and up to 16 settlements per batch |
| Randomness | Chainlink VRF v2.5 direct funding; callback stores only |
| Programmable fee | 10 bps of executed gross native quote, no project share |
| Authorities | Fixed fee owner only for its claim; no project admin, upgrade, pause or rescue |
| Exit | Refund on randomness expiry and pro-rata bankroll redemption after finalisation |

## Lifecycle

The launcher predicts the fixed token, deploys a mined hook and its bound router, initializes the canonical PoolKey and creates one-sided liquidity. It sends the position NFT and token dust to a permanent locker. The locker can collect fees for the creator but cannot transfer or reduce the position. `afterInitialize` opens a fixed Funding window.

The creator may include an initial ETH buy in the same transaction. It uses empty hook data, so it pays the mandatory fee but creates no wager. A failure in any launch step reverts the complete transaction.

During Funding, ordinary swaps work and wager mode is disabled. Bankroll providers deposit or withdraw WETH 1:1. After the deadline, anyone can activate a sufficiently funded game or cancel an underfunded game.

During Active, ordinary swaps still work. The wager router deposits WETH, stores the player and stake under one pending identifier, then performs one exact-input swap. Hook data carries only that identifier and does not claim to identify the user. The hook creates the ticket only after successful execution and removes the pending record atomically.

Anyone can close the game at its deadline or capacity. Anyone can pay the exact quoted VRF fee within a caller-selected maximum. The adapter callback stores one word. Anyone can pull the word, settle tickets in bounded batches and finalise.

If nobody requests randomness within the grace period, or an unfulfilled request times out, anyone can expire it. Each open stake becomes a player refund liability. Finalisation never absorbs a player liability into the bankroll.

## Fee collection

The hook charges 10 bps and allocates the complete amount to `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`.

It charges quote-specified paths in `beforeSwap`. This covers ETH-to-token exact input and token-to-ETH exact output. It charges quote-unspecified paths in `afterSwap`. This covers ETH-to-token exact output and token-to-ETH exact input.

The hook holds native ERC-6909 claims and records a liability by PoolId, native currency and owner. Only the immutable owner can claim. It selects the destination for each claim. The builder, token creator and bankroll providers receive no share and cannot redirect it.

## Authorities

The Programmable fee owner is `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`. It can claim only its accrued native fee liability to a destination it selects for that claim. The address is immutable, has no delay and cannot affect swaps, tickets, bankroll funds or LP exits.

The immutable `BankrollLaunchV1` registrar can initialize the one canonical pool after factory router binding. It acts once, has no delay and cannot act after initialization.

There is no mutable model administrator. No party can pause, upgrade, rescue, change odds or limits, replace dependencies or redirect player and bankroll funds. Permissionless lifecycle calls have fixed contract rules and are not administrative authorities.

## Integration plan

The product needs separate quote and trade routes. Ordinary trades can use standard v4 routing. Wagered trades must call the narrow router and include the WETH stake, deadline, price limit and minimum output.

An indexer should start from the hook deployment block. It should key state by chain id, hook and PoolId, wait for finality, roll back on a reorganisation and reconcile ticket, liability and bankroll events with contract views.

The UI must label this as a wager, show the stake, 1.96x gross payout, 2% expected house edge, ticket capacity, game state, randomness state and refund path before signing.

The repository includes a Bun and Vite React review demo. Demo mode lets reviewers change the swap amount and stake, then inspect the ticket without sending a transaction. An experimental wagmi path can call the custom BankrollRouter when an exact router address, minimum output and chain are configured. The proposal does not claim this as a reviewed or routed product client. It has no quote service or integration tests.

No production API, indexer, routing registration, monitoring or deployment exists in this repository.

## Remaining work

- Verify the exact Ethereum UERC20 factory, PoolManager, PositionManager, WETH and VRF wrapper deployment records.
- Add adversarial failed-launch, token-factory and permanent-locker tests.
- Add stateful bankroll and liability invariants.
- Run Slither, mainnet-fork dependency checks and independent review.
- Resolve the current runtime-unverified official Ethereum launchpad profile before deployment evidence.
- Request Programmable maintainer review of the public GitHub source.
