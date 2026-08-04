# Protocol revenue V1 security diagrams

## Trust and custody

```mermaid
flowchart LR
    CRE["Chainlink CRE Forwarder\nfixed code hash"] --> EX["MetaMask Executor\nfixed workflow identity"]
    RW["Revenue wallet\nMetaMask EIP-7702"] -->|"one revocable delegation"| DM["MetaMask DelegationManager"]
    EX -->|"redeem exact batch"| DM
    DM --> EN["Execution Enforcer\ncanonical calls only"]
    EN --> H["Four pinned shared fee hooks"]
    EN --> R["Revenue Router\nimmutable 50 / 50"]
    R --> T["Treasury\n50%"]
    R --> UR["Uniswap Universal Router\n50% buys V4"]
    UR --> RW
```

## Atomic daily sequence

```mermaid
sequenceDiagram
    participant C as CRE Forwarder
    participant E as Executor
    participant D as MetaMask DelegationManager
    participant H as Pinned fee hooks
    participant W as Revenue wallet
    participant R as Revenue router
    participant T as Treasury
    participant U as Uniswap Universal Router

    C->>E: signed report(chain, time, finalized tick)
    E->>E: verify workflow, freshness, replay and readiness
    E->>D: redeem signed permission context
    D->>H: claim Classic fees directly to router
    D->>H: claim Deep fees to revenue wallet
    D->>W: send exactly the Deep claim to router
    W->>R: exact Deep amount only
    D->>R: process(time, tick, aggregate claim)
    R->>T: send 50%
    R->>U: swap 50% for V4 in bounded chunks
    U-->>R: bought V4
    R->>W: deliver bought V4
    R-->>D: record current block timestamp
```

Any failed step reverts the complete sequence. Prior wallet and router balances are not part of the aggregate claim.

## State writers

```mermaid
flowchart TD
    A["Revenue wallet only"] --> P["Router.process"]
    A --> F["Executor.executeCycle"]
    A --> G["Executor.configureDelegation once"]
    C["CRE Forwarder only"] --> O["Executor.onReport"]
    O --> X["Executor.lastAcceptedScheduledAt"]
    F --> D["DelegationManager exact batch"]
    O --> D
    D --> P
    P --> S["Router totals and cooldown"]
    N["No external caller"] -.->|"no owner, recovery or withdrawal function"| S
```
