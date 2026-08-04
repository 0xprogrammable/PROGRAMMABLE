# Protocol revenue V2 flow

```mermaid
flowchart LR
    H1["Classic V1 hook"] -->|"permissionless claim"| W["Protocol revenue wallet"]
    H2["Classic V2 hook"] -->|"permissionless claim"| W
    K["Restricted keeper"] -->|"claim"| C["Claim coordinator"]
    C --> H1
    C --> H2
    K -->|"redeem bounded permission"| M["MetaMask DelegationManager"]
    W -->|"max 5 ETH per day, empty calldata"| M
    M --> V["Immutable revenue vault"]
    K -->|"process finalized reference"| V
    V -->|"50%"| T["Treasury"]
    V -->|"0.5%"| K
    V -->|"49.5% private swap"| U["Uniswap Universal Router"]
    U -->|"bought V4"| W
```

The ERC-7715 permission can only transfer bounded native ETH from the revenue wallet to the Vault. It cannot execute
claims, swaps or arbitrary calls. The Vault can only apply the fixed split and buy through the pinned `$V4` pool.
