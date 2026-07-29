# State and authorization

| State | Writer | Mutability |
| --- | --- | --- |
| Pool reward vault and buy/sell fees | Recorded token creator during registration | Write once |
| Creator-fee accrual | PoolManager-authenticated swap callbacks | Accrual only |
| Programmable-fee accrual | PoolManager-authenticated swap callbacks | Accrual only |
| Creator-fee claim balance | Bound reward vault | Decrease only when redeemed |
| Programmable-fee claim balance | Immutable revenue wallet | Decrease only when redeemed |
| Active payout wallet for one allocation | Current allocation owner | Future rewards only |
| Complete active reward split | Shared CTO authority | Future rewards only |
| Historic claimable rewards | Reward checkpoint logic | Never reassigned |
| CTO authority | Current and pending authorities | Two-step transfer |
| Token supply | Atomic launcher through UERC20 factory | Fixed after launch |
| Position custody | Atomic launcher | Permanent |
| Initial Buy custody schedule | Atomic launcher | Immutable |

No contract in the release exposes an owner fee setter, arbitrary reward sweep, token
mint, blacklist, pause, proxy upgrade or liquidity-withdrawal authority.
