# Robinhood native20 buyer-funded example

This example builds a real ETH/token Uniswap v4 market on Robinhood Chain 4663 with **zero ETH supplied as starting liquidity**. It supplies fixed token inventory to a concentrated-liquidity position. Buyers then put real ETH into that position through swaps. Deployment and later transactions still require ETH for gas.

It is a bounded reference implementation for the new native20 fee profile. It is not an arbitrary custom-accounting bonding curve, an audit, a promise of liquidity value, or evidence that this example is deployed. Remote submission requires an activated successor API/profile and its exact released CLI. Building this example never signs or broadcasts a transaction.

## Exact launch shape

- Fixed token: **Robinhood Native20 Example (`RHN20`)**, 1,000,000,000 tokens with 18 decimals. The constructor issues the entire supply to the initializer. There is no owner, mint-after-deployment, burn, transfer-tax or upgrade method.
- Pool: native ETH as currency0 and the token as currency1, LP fee 0, tick spacing 60.
- Initial position: ticks **160020–200040**, starting exactly at the upper price. The initial square-root price is **1747735933952748037356115466503453** in Q96 units.
- The initializer supplies token inventory only. It owns the exact initial position permanently and exposes no withdrawal, fee collection, approval, operator, recovery or arbitrary execution method. Token rounding dust left there is also permanently inaccessible.
- At the upper price the position is initially out of the active range; its stored position liquidity and token inventory are positive. The first ETH-input buy crosses into the range. Reading only current active liquidity at the initial boundary would incorrectly classify the market as an empty pool.
- Subsequent sells draw from ETH actually put into the position through trading. There are no invented or borrowed ETH reserves. This is a finite concentrated-liquidity price range, not a separate fundraising contract or an automatic pool migration.

The initial position's principal cannot be pulled by the creator. This statement concerns that position; it does not redefine withdrawal rights for unrelated positions other users later create in the same pool. It does not guarantee a price, depth, return or continuous market demand.

## Platform fee

The exact canonical `RobinhoodNativeFeeHookV1` and `RobinhoodNativeFeeVaultV1` sources are included under `project/src/robinhood-fee-v1/`. They are copied verbatim from the reviewed source candidate, not rewritten for this example.

Every completed supported swap through this exact PoolKey funds a separate **20 BPS / 0.2% native-ETH platform obligation** to Treasury **`0xD88539d3c4C460136a733A3Fd60cf6BF269079da`**. This example selects 0% creator fees and no optional module. Alternative routers entering the same pool execute the same fee hook.

The new profile defines its own gross-native volume: on buys it includes the hook fee; on sells it is the gross ETH proceeds before that fee. Platform fees round up per trade by less than one wei. The `NativeFeesAccrued` event supplies this exact volume base; the core Swap event's post-hook input is different on buys. A complete fee-only dust execution is rejected.

Fees accrue as native ERC-6909 claims in PoolManager, backed by each swap's settlement. Anyone may pay the gas for `feeVault.claimPlatform()`, but the ETH transfer always goes to Treasury. Accrual and actual claimed wallet proceeds are distinct. The vault cannot withdraw the initial liquidity position or transfer funds to a caller-selected address.

ETH-specified partial fills revert atomically. Custom return deltas, NoOp settlement and stateful modules are outside this example's supported profile. More general mechanisms require a separately verified accounting adapter; editing the fee source or merely retaining a fee getter does not preserve the canonical guarantee.

## Acyclic graph and initialization

The graph is deliberately ordered as follows:

1. Deploy `RobinhoodNative20Initializer(manager, graphFactory)` with no target references.
2. Deploy `RobinhoodNative20Token(initializer)` and issue the fixed inventory to that address.
3. Deploy the exact fee hook with the token and initializer references; the hook constructs its deterministic fee vault as its first CREATE child.
4. After every target exists, the graph factory calls `initializer.initialize(token, hook)` in the initialization phase.

The current graph factory deploys all targets before running deferred initializer calls. This avoids a CREATE2 cycle between the hook's immutable initializer and an initializer constructor containing the hook address.

Initialization is nonpayable, authenticated to the exact Robinhood graph factory and usable once. Its PoolManager unlock callback is also authenticated, hash-bound and usable once. The callback adds positive liquidity, rejects any ETH debt, transfers only the exact canonical token debt, and verifies settlement. It cannot be reused to remove liquidity.

The kernel's vault is a deterministic child at the kernel's CREATE nonce 1, not an additional graph root. Successor admission and post-launch evidence must bind its address, source, runtime and immutables explicitly.

## Build and funding declarations

The successor builder resolves live chain capabilities and prepares a deterministic pack using exact Solidity 0.8.26 compiler settings and dependency sources. Keep the canonical fee compilation unit unchanged. Compile the example token and initializer together so the initializer's embedded exact-token runtime check matches the deployed token.

The config declares:

- Funding model: buyer-funded token inventory, no ETH principal or initial buy.
- Native transaction value: `0`.
- Liquidity model: `project-provided-liquidity` / `liquidity-provided-by-launch`, target `initializer`.
- A separately disclosed, positive gas budget supplied by the launch wallet or an explicitly supported sponsor.

Before building a real launch, the agent must obtain the selected chain, funding model, gas budget, project image, description, name, ticker and social links. The fixed token name/symbol above must match this reference project's metadata. A changed token or initializer requires new source-bound admission; do not substitute an unreviewed token while claiming this exact example's evidence.

## Local verification and limits

The dedicated tests execute the pinned real v4-core PoolManager locally, including its constructor at the canonical address. They verify a token-only initial position, zero ETH seeding, buy/sell execution and Treasury claims, plus unauthorized/repeated initialization, forged callbacks and unavailable withdrawal/approval routes.

The tests impersonate the canonical graph factory locally. They are not a live fork, a signed production launch, finalized deployment evidence, source-verification evidence or proof that a third-party terminal can route this pool. Those release stages remain separate.
