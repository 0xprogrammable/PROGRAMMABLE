# Classic security diagrams

These diagrams describe the configurable Classic candidate. The Sepolia deployment is
verified and lifecycle tested. Ethereum deployment remains a separate release gate.

```mermaid
flowchart LR
    wallet["Launch wallet"] --> launcher["MemeLaunchV2"]
    launcher --> token["UERC20 fixed supply"]
    launcher --> manager["Uniswap v4 PoolManager"]
    launcher --> position["Permanent position recipient"]
    launcher --> vault["ClassicRewardVaultV1"]
    launcher --> custody["Optional Initial Buy custody"]
    manager --> hook["EthCreatorFeeHookV3"]
    hook --> vault
    hook --> revenue["Programmable revenue wallet"]
    vault --> beneficiaries["One to five payout wallets"]
    cto["ClassicCtoAuthorityV1"] -->|"Future rewards only"| vault
```

Critical boundaries:

- Only the canonical PoolManager may call hook callbacks and the launch unlock callback.
- The reward vault alone may redeem its pool's creator-fee claim.
- The immutable Programmable wallet alone may redeem or redirect the 0.10 percentage-point share.
- Every payout-wallet or CTO update checkpoints the previous reward configuration first.
- The position recipient exposes no practical transfer or liquidity-removal path.
