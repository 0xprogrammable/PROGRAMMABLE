# Security architecture

```mermaid
flowchart LR
    Creator[Launch creator]
    OfficialLauncher[Uniswap LiquidityLauncher]
    Auction[Continuous Clearing Auction]
    AuctionFeeController[CCA protocol fee controller: zero]
    Strategy[Uniswap LBPStrategy]
    DirectLauncher[DirectLiquidityLauncherV1]
    TokenFactory[Uniswap UERC20Factory]
    HookFactory[PlatformFeeHookFactoryV1]
    DynamicHookFactory[BoundedDynamicFeeHookFactoryV1]
    PositionFactory[LockedPositionFeeForwarderFactoryV1]
    Hook[PlatformFeeHookV1]
    DynamicHook[BoundedDynamicFeeHookV1]
    PoolManager[Uniswap v4 PoolManager]
    PositionManager[Uniswap v4 PositionManager]
    Forwarder[Uniswap PositionFeesForwarder]
    Treasury[Immutable platform treasury]

    Creator -->|auction composition| OfficialLauncher
    OfficialLauncher --> TokenFactory
    OfficialLauncher --> Auction
    AuctionFeeController --> Auction
    Auction --> Strategy
    Strategy -->|authorized pool initialization| PoolManager

    Creator -->|direct atomic launch| DirectLauncher
    DirectLauncher --> TokenFactory
    DirectLauncher --> HookFactory
    DirectLauncher --> PositionFactory
    DirectLauncher -->|authorized pool initialization| PoolManager
    DirectLauncher -->|mint full-range LP NFT| PositionManager
    Creator -->|existing UERC20 launch| DirectLauncher
    TokenFactory -->|CREATE2 provenance| DirectLauncher

    HookFactory -->|CREATE2, exact callback flags| Hook
    DynamicHookFactory -->|CREATE2, exact callback flags| DynamicHook
    PositionFactory -->|CREATE2, fixed lock policy| Forwarder
    PositionManager -->|LP NFT owner| Forwarder
    Hook <-->|beforeInitialize and afterSwap| PoolManager
    DynamicHook <-->|initialize, beforeSwap and afterSwap| PoolManager
    PoolManager -->|ERC-6909 fee claims| Hook
    Hook -->|permissionless trigger, fixed payout| Treasury
    DynamicHook -->|permissionless trigger, fixed payout| Treasury
    Forwarder -->|permissionless trigger, fixed payout| Creator
```

## Authority map

```mermaid
flowchart TD
    PoolCallback[Hook callbacks] -->|only| PoolManager
    AuctionInitialization[Auction pool initialization] -->|only| LBPStrategy
    DirectInitialization[Direct pool initialization] -->|only| DirectLiquidityLauncherV1
    ExistingTokenLaunch[Existing token launch] -->|only| FactoryRecordedCreator[Factory recorded creator]
    FeeRate[Platform fee rate] -->|fixed in bytecode| TenBp[0.10%]
    DynamicRate[Dynamic LP fee] -->|fixed rule and bounds| Bounded[0.30% to 1.00%]
    AuctionProceeds[Auction proceeds] -->|zero CCA protocol fee controller| PoolFunding[100% to pool funding]
    PoolConfig[Pool configuration] -->|fixed in bytecode| PoolId[One PoolId]
    PlatformCollection[Platform fee collection] -->|any address| Treasury[Immutable platform treasury]
    LPCollection[LP fee collection] -->|any address| Creator[Immutable launch creator]
    PositionControl[Position transfer or liquidity removal] --> Locked[No operator and uint256 max timelock]
    Admin[Admin powers] --> None[None]
```

The generated Slither inheritance graph is stored in `inheritance-graph.dot`. Slither’s function and state-authorization views are summarized in `function-surface.md` and `state-authorization.md`.
