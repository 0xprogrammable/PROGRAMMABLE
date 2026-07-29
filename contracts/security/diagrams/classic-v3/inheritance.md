# Inheritance and dependency surface

```mermaid
classDiagram
    class BaseHook
    class IUnlockCallback
    class ReentrancyGuardTransient
    class VestingWallet
    class EthCreatorFeeHookV3
    class MemeLaunchV2
    class ClassicRewardVaultV1
    class ClassicCtoAuthorityV1
    class ClassicInitialBuyVestingWalletV1

    BaseHook <|-- EthCreatorFeeHookV3
    IUnlockCallback <|.. EthCreatorFeeHookV3
    ReentrancyGuardTransient <|-- EthCreatorFeeHookV3
    IUnlockCallback <|.. MemeLaunchV2
    ReentrancyGuardTransient <|-- MemeLaunchV2
    ReentrancyGuardTransient <|-- ClassicRewardVaultV1
    ReentrancyGuardTransient <|-- ClassicCtoAuthorityV1
    VestingWallet <|-- ClassicInitialBuyVestingWalletV1
```

All release contracts are concrete and non-upgradeable. Factories use deterministic
CREATE2 deployment and bind an immutable configuration hash to every recognized child.
