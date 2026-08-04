# Protocol revenue V1 security diagrams

## Trust and custody

```mermaid
flowchart LR
    VC["Vercel Cron\nauthenticated trigger"] --> K["Restricted keeper\ngas only"]
    K -->|"private raw transaction"| MB["MEV Blocker\nFlashbots fallback"]
    MB --> EX["Immutable executor\nkeeper only"]
    RW["Revenue wallet\nMetaMask EIP-7702"] -->|"one revocable delegation"| DM["DelegationManager"]
    EX -->|"redeem exact batch"| DM
    DM --> EN["Execution enforcer\ncanonical calls only"]
    EN --> H["Four pinned fee hooks"]
    EN --> R["Immutable revenue router"]
    R --> T["Treasury\n50%"]
    R --> K2["Keeper gas\n0.5%"]
    R --> UR["Uniswap Universal Router\n49.5% buys V4"]
    UR --> RW
```

## Daily execution

```mermaid
sequenceDiagram
    participant V as Vercel Cron
    participant Q as Two RPC vendors
    participant K as Keeper
    participant M as Private MEV relay
    participant E as Executor and delegation
    participant H as Pinned fee hooks
    participant R as Revenue router
    participant T as Treasury
    participant U as Uniswap Universal Router
    participant W as Revenue wallet

    V->>Q: read one agreed finalized block
    Q-->>V: runtime hashes, due state, fees, tick
    V->>V: simulate and enforce gas economics
    V->>K: sign fixed executor call locally
    K->>M: eth_sendRawTransaction
    M->>E: private inclusion
    E->>H: claim exact current fees
    E->>R: process exact aggregate
    R->>T: 50%
    R->>K: 0.5% gas reserve
    R->>U: bounded 49.5% V4 buy
    U-->>R: V4
    R->>W: purchased V4
```

Any failed onchain step reverts the complete cycle. Prior wallet and router balances are excluded.

## Inheritance and state authorization

Slither's inheritance printer confirms that the router and executor inherit only OpenZeppelin's transient reentrancy
guard; the enforcer is a direct implementation of its narrow caveat interface. There is no proxy or upgrade base.

```mermaid
classDiagram
    class ReentrancyGuardTransient
    class ProtocolRevenueRouterV1
    class ProtocolRevenueMetaMaskExecutorV1
    class ProtocolRevenueExecutionEnforcerV1
    ReentrancyGuardTransient <|-- ProtocolRevenueRouterV1
    ReentrancyGuardTransient <|-- ProtocolRevenueMetaMaskExecutorV1
```

Slither's function and authorization printers reduce the state-writing surface to:

| Contract | State writer | Authorization |
| --- | --- | --- |
| Executor | `configureDelegation` | fixed revenue wallet |
| Executor | `executeKeeperCycle` | immutable keeper |
| Executor | `executeCycle` | fixed revenue wallet |
| Router | `process` | fixed revenue wallet through the enforced delegation or manual fallback |
| Enforcer | none | stateless validation only |

The raw inheritance output is stored in `security/diagrams/protocol-revenue-v1-executor-inheritance.dot`.
