// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    IProgrammableFeeAccrualContextV1,
    IProgrammableV4PoolManagerV1,
    ProgrammableCurrency
} from "./ProgrammableAdditiveFeeHookV1.sol";

uint256 constant PROGRAMMABLE_FEE_VAULT_CHAIN_ID_V2 = 1;
uint160 constant PROGRAMMABLE_FEE_VAULT_REQUIRED_HOOK_FLAGS_V2 = (1 << 13) | (1 << 6) | (1 << 2);

address constant PROGRAMMABLE_CANONICAL_POOL_MANAGER_V2 = 0x000000000004444c5dc75cB358380D2e3dE08A90;
bytes32 constant PROGRAMMABLE_CANONICAL_POOL_MANAGER_RUNTIME_CODE_HASH_V2 =
    0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293;
address constant PROGRAMMABLE_CANONICAL_GRAPH_DEPLOYER_V2 = 0xB012e4A8F2c5FC4E8E4faCA9D5Ad6FfF13FBA887;
bytes32 constant PROGRAMMABLE_CANONICAL_GRAPH_DEPLOYER_RUNTIME_CODE_HASH_V2 =
    0xd23692fae59331592048e71a96d4963e170ee56e449683dc9f7fa3f9470018b8;

interface IProgrammableFeeAdapterBindingV2 {
    function poolManager() external view returns (address);
    function platformFeeVault() external view returns (address);
}

/// @notice V2 keeps the reviewed V1 accounting state machine byte-frozen in
/// its canonical source and carries the stronger address mask and Mainnet
/// dependency checks in a version-owned implementation.
abstract contract ProgrammableFeeVaultV2Core {
    uint24 public constant PLATFORM_FEE_PPM = 1000;
    uint24 public constant FEE_DENOMINATOR_PPM = 1_000_000;
    address public constant PLATFORM_FEE_RECIPIENT = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    uint160 public constant REQUIRED_ADAPTER_FLAGS = (1 << 6) | (1 << 2);
    uint160 public constant REQUIRED_ADAPTER_FLAGS_V2 = PROGRAMMABLE_FEE_VAULT_REQUIRED_HOOK_FLAGS_V2;
    uint160 public constant ALL_HOOK_MASK = (1 << 14) - 1;

    bytes32 private constant PLATFORM_FEE_ACCRUAL_CONTEXT_DOMAIN =
        keccak256("programmable.platform-fee-accrual-context.v1");

    address public immutable poolManager;
    address public immutable graphDeployer;
    address public bindingAuthority;
    address public authorizedAdapter;
    bytes32 public authorizedAdapterCodeHash;

    mapping(address currency => uint256 amount) public platformFeesAccrued;
    mapping(address currency => uint256 amount) public pendingPlatformFeeFunding;
    mapping(address currency => bytes32 contextHash) public pendingPlatformFeeContextHash;
    mapping(bytes32 poolId => mapping(address currency => uint256 scaledRemainder)) public platformFeeRemainderPpm;

    bool private bindingInProgress;
    bool private claimInProgress;
    bool private claimCallbackConsumed;
    bytes32 private activeClaimHash;

    error AdapterAlreadyBound(address adapter);
    error AdapterBindingStateChanged();
    error AdapterCodeHashChanged(bytes32 expected, bytes32 observed);
    error AdapterFeeAccrualContextPending(address currency, bytes32 contextHash);
    error AdapterFeeFundingPending(address currency, uint256 amount);
    error AdapterFeeFundingMismatch(address currency, uint256 expected, uint256 observed);
    error HookAddressPermissionMismatch(uint160 actual, uint160 required);
    error InvalidAdapterBinding(address adapter);
    error InvalidAddress();
    error InvalidPlatformFeeAccrualContext(bytes32 expected, bytes32 observed);
    error NoFeesToClaim(address currency);
    error ReentrantClaim();
    error ReentrantAdapterBinding();
    error RuntimeCodeHashMismatch(address target, bytes32 expected, bytes32 actual);
    error UnauthorizedAdapter(address caller);
    error UnauthorizedBinding(address caller);
    error UnauthorizedClaim(address caller);
    error UnauthorizedPoolManager(address caller);
    error UnexpectedClaimCallback();
    error UnlockResponseNotEmpty();
    error UnsupportedFeePolicyChain(uint256 actual, uint256 required);

    event AdapterBound(address indexed adapter);
    event PlatformFeeFundingRecorded(
        bytes32 indexed poolId,
        address indexed currency,
        bool exactInput,
        uint256 feeBasisAmount,
        uint256 platformFee,
        uint256 nextRemainderPpm
    );
    event PlatformFeeFundingConfirmed(address indexed currency, uint256 amount);
    event PlatformFeesClaimed(address indexed currency, address indexed treasury, uint256 amount);

    constructor(address poolManager_, address graphDeployer_) {
        if (poolManager_ == address(0) || graphDeployer_ == address(0)) revert InvalidAddress();
        poolManager = poolManager_;
        graphDeployer = graphDeployer_;
        bindingAuthority = graphDeployer_;
    }

    /// @notice One-time, self-sealing adapter binding performed by the exact
    /// atomic launch route after both vault and hook have been deployed.
    function bindAdapter(address adapter) external {
        if (msg.sender != bindingAuthority) revert UnauthorizedBinding(msg.sender);
        _requireCanonicalBindingEnvironment();
        if (bindingInProgress) revert ReentrantAdapterBinding();
        if (authorizedAdapter != address(0)) revert AdapterAlreadyBound(authorizedAdapter);

        bindingInProgress = true;
        bytes32 adapterCodeHash = adapter.codehash;
        uint160 flags = uint160(adapter) & ALL_HOOK_MASK;
        if (adapter == address(0) || adapter.code.length == 0 || flags != REQUIRED_ADAPTER_FLAGS_V2) {
            revert HookAddressPermissionMismatch(flags, REQUIRED_ADAPTER_FLAGS_V2);
        }
        try IProgrammableFeeAdapterBindingV2(adapter).poolManager() returns (address manager) {
            if (manager != poolManager) revert InvalidAdapterBinding(adapter);
        } catch {
            revert InvalidAdapterBinding(adapter);
        }
        try IProgrammableFeeAdapterBindingV2(adapter).platformFeeVault() returns (address vault) {
            if (vault != address(this)) revert InvalidAdapterBinding(adapter);
        } catch {
            revert InvalidAdapterBinding(adapter);
        }
        try IProgrammableFeeAccrualContextV1(adapter).platformFeeAccrualContextHash() returns (bytes32 contextHash) {
            if (contextHash != bytes32(0)) revert InvalidAdapterBinding(adapter);
        } catch {
            revert InvalidAdapterBinding(adapter);
        }
        if (!bindingInProgress || authorizedAdapter != address(0) || bindingAuthority != msg.sender) {
            revert AdapterBindingStateChanged();
        }
        if (adapter.codehash != adapterCodeHash) {
            revert AdapterCodeHashChanged(adapterCodeHash, adapter.codehash);
        }
        authorizedAdapter = adapter;
        authorizedAdapterCodeHash = adapterCodeHash;
        bindingAuthority = address(0);
        bindingInProgress = false;
        emit AdapterBound(adapter);
    }

    function requiredAdapterFlags() public pure returns (uint160) {
        return REQUIRED_ADAPTER_FLAGS_V2;
    }

    function canonicalPoolManagerRuntimeCodeHash() external view returns (bytes32) {
        return _canonicalPoolManagerRuntimeCodeHash();
    }

    function canonicalGraphDeployerRuntimeCodeHash() external view returns (bytes32) {
        return _canonicalGraphDeployerRuntimeCodeHash();
    }

    /// @notice Returns the exact context that the bound adapter must expose
    /// during the private mandatory fee phase for these immutable inputs.
    function platformFeeAccrualContextHash(
        bytes32 poolId,
        ProgrammableCurrency currency,
        uint256 feeBasisAmount,
        bool exactInput
    ) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                PLATFORM_FEE_ACCRUAL_CONTEXT_DOMAIN,
                block.chainid,
                address(this),
                poolManager,
                authorizedAdapter,
                poolId,
                ProgrammableCurrency.unwrap(currency),
                feeBasisAmount,
                exactInput
            )
        );
    }

    /// @dev Starts one exact fee obligation only while the bound base module's
    /// private mandatory phase exposes the matching context. The context lock
    /// remains nonzero even when rounding produces a zero fee, so custom code
    /// cannot advance dust or create a second zero-value obligation.
    function recordPlatformFee(
        bytes32 poolId,
        ProgrammableCurrency currency,
        uint256 feeBasisAmount,
        bool exactInput,
        bytes32 accrualContextHash
    ) external returns (uint256 platformFee) {
        _onlyAdapter();
        address currencyAddress = ProgrammableCurrency.unwrap(currency);
        bytes32 pendingContext = pendingPlatformFeeContextHash[currencyAddress];
        if (pendingContext != bytes32(0)) {
            revert AdapterFeeAccrualContextPending(currencyAddress, pendingContext);
        }
        uint256 pending = pendingPlatformFeeFunding[currencyAddress];
        if (pending != 0) revert AdapterFeeFundingPending(currencyAddress, pending);

        bytes32 expectedContext = platformFeeAccrualContextHash(poolId, currency, feeBasisAmount, exactInput);
        if (accrualContextHash == bytes32(0) || accrualContextHash != expectedContext) {
            revert InvalidPlatformFeeAccrualContext(expectedContext, accrualContextHash);
        }
        _requireActiveAdapterAccrualContext(expectedContext);

        uint256 accounted = platformFeesAccrued[currencyAddress];
        uint256 observed = IProgrammableV4PoolManagerV1(poolManager).balanceOf(address(this), uint160(currencyAddress));
        if (observed < accounted) {
            revert AdapterFeeFundingMismatch(currencyAddress, accounted, observed);
        }

        uint256 nextRemainder;
        (platformFee, nextRemainder) = _computePlatformFee(poolId, currencyAddress, feeBasisAmount, exactInput);
        platformFeeRemainderPpm[poolId][currencyAddress] = nextRemainder;
        pendingPlatformFeeContextHash[currencyAddress] = expectedContext;
        pendingPlatformFeeFunding[currencyAddress] = platformFee;
        emit PlatformFeeFundingRecorded(poolId, currencyAddress, exactInput, feeBasisAmount, platformFee, nextRemainder);
    }

    function confirmPlatformFeeFunding(ProgrammableCurrency currency, uint256 amount, bytes32 accrualContextHash)
        external
    {
        _onlyAdapter();
        address currencyAddress = ProgrammableCurrency.unwrap(currency);
        bytes32 pendingContext = pendingPlatformFeeContextHash[currencyAddress];
        if (accrualContextHash == bytes32(0) || pendingContext == bytes32(0) || pendingContext != accrualContextHash) {
            revert InvalidPlatformFeeAccrualContext(pendingContext, accrualContextHash);
        }
        _requireActiveAdapterAccrualContext(pendingContext);
        uint256 pending = pendingPlatformFeeFunding[currencyAddress];
        if (pending != amount) {
            revert AdapterFeeFundingMismatch(currencyAddress, pending, amount);
        }
        uint256 nextAccounted = platformFeesAccrued[currencyAddress] + amount;
        uint256 observed = IProgrammableV4PoolManagerV1(poolManager).balanceOf(address(this), uint160(currencyAddress));
        if (observed < nextAccounted) {
            revert AdapterFeeFundingMismatch(currencyAddress, nextAccounted, observed);
        }
        pendingPlatformFeeContextHash[currencyAddress] = bytes32(0);
        pendingPlatformFeeFunding[currencyAddress] = 0;
        platformFeesAccrued[currencyAddress] = nextAccounted;
        emit PlatformFeeFundingConfirmed(currencyAddress, amount);
    }

    function claimPlatformFees(ProgrammableCurrency currency) external returns (uint256 amount) {
        if (msg.sender != PLATFORM_FEE_RECIPIENT) revert UnauthorizedClaim(msg.sender);
        if (claimInProgress) revert ReentrantClaim();

        address currencyAddress = ProgrammableCurrency.unwrap(currency);
        bytes32 pendingContext = pendingPlatformFeeContextHash[currencyAddress];
        if (pendingContext != bytes32(0)) {
            revert AdapterFeeAccrualContextPending(currencyAddress, pendingContext);
        }
        if (pendingPlatformFeeFunding[currencyAddress] != 0) {
            revert AdapterFeeFundingPending(currencyAddress, pendingPlatformFeeFunding[currencyAddress]);
        }
        amount = platformFeesAccrued[currencyAddress];
        if (amount == 0) revert NoFeesToClaim(currencyAddress);
        uint256 observed = IProgrammableV4PoolManagerV1(poolManager).balanceOf(address(this), uint160(currencyAddress));
        if (observed < amount) {
            revert AdapterFeeFundingMismatch(currencyAddress, amount, observed);
        }

        platformFeesAccrued[currencyAddress] = 0;
        claimInProgress = true;
        claimCallbackConsumed = false;
        bytes memory callbackData = abi.encode(currency, amount);
        activeClaimHash = keccak256(callbackData);
        bytes memory result = IProgrammableV4PoolManagerV1(poolManager).unlock(callbackData);
        if (!claimCallbackConsumed || activeClaimHash != bytes32(0)) revert UnexpectedClaimCallback();
        if (result.length != 0) revert UnlockResponseNotEmpty();
        claimInProgress = false;
        claimCallbackConsumed = false;

        emit PlatformFeesClaimed(currencyAddress, PLATFORM_FEE_RECIPIENT, amount);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != poolManager) revert UnauthorizedPoolManager(msg.sender);
        if (!claimInProgress || claimCallbackConsumed) revert ReentrantClaim();
        if (keccak256(data) != activeClaimHash) revert UnexpectedClaimCallback();
        claimCallbackConsumed = true;
        activeClaimHash = bytes32(0);
        (ProgrammableCurrency currency, uint256 amount) = abi.decode(data, (ProgrammableCurrency, uint256));
        uint256 currencyId = uint160(ProgrammableCurrency.unwrap(currency));
        IProgrammableV4PoolManagerV1(poolManager).burn(address(this), currencyId, amount);
        IProgrammableV4PoolManagerV1(poolManager).take(currency, PLATFORM_FEE_RECIPIENT, amount);
        return "";
    }

    function _onlyAdapter() private view {
        if (msg.sender != authorizedAdapter) revert UnauthorizedAdapter(msg.sender);
        bytes32 expectedCodeHash = authorizedAdapterCodeHash;
        bytes32 observedCodeHash = msg.sender.codehash;
        if (observedCodeHash != expectedCodeHash) {
            revert AdapterCodeHashChanged(expectedCodeHash, observedCodeHash);
        }
    }

    function _requireActiveAdapterAccrualContext(bytes32 expectedContext) private view {
        bytes32 observedContext = bytes32(0);
        try IProgrammableFeeAccrualContextV1(authorizedAdapter).platformFeeAccrualContextHash() returns (
            bytes32 contextHash
        ) {
            observedContext = contextHash;
        } catch {
            revert InvalidPlatformFeeAccrualContext(expectedContext, bytes32(0));
        }
        if (observedContext != expectedContext) {
            revert InvalidPlatformFeeAccrualContext(expectedContext, observedContext);
        }
    }

    function _computePlatformFee(bytes32 poolId, address currencyAddress, uint256 feeBasisAmount, bool exactInput)
        private
        view
        returns (uint256 platformFee, uint256 nextRemainder)
    {
        uint256 remainder = platformFeeRemainderPpm[poolId][currencyAddress];
        uint256 scaledPoolAmount = feeBasisAmount * PLATFORM_FEE_PPM;
        if (exactInput) {
            uint256 scaledFee = scaledPoolAmount + remainder;
            return (scaledFee / FEE_DENOMINATOR_PPM, scaledFee % FEE_DENOMINATOR_PPM);
        }

        uint256 scaledNetAmount = scaledPoolAmount + remainder;
        uint256 feeDivisor = FEE_DENOMINATOR_PPM - PLATFORM_FEE_PPM;
        platformFee =
            scaledNetAmount < FEE_DENOMINATOR_PPM ? 0 : (scaledNetAmount - FEE_DENOMINATOR_PPM) / feeDivisor + 1;
        uint256 grossAmount = feeBasisAmount + platformFee;
        nextRemainder = (remainder + grossAmount * PLATFORM_FEE_PPM) % FEE_DENOMINATOR_PPM;
    }

    function _requireCanonicalBindingEnvironment() private view {
        if (block.chainid != PROGRAMMABLE_FEE_VAULT_CHAIN_ID_V2) {
            revert UnsupportedFeePolicyChain(block.chainid, PROGRAMMABLE_FEE_VAULT_CHAIN_ID_V2);
        }
        _requireRuntimeCodeHash(poolManager, _canonicalPoolManagerRuntimeCodeHash());
        _requireRuntimeCodeHash(graphDeployer, _canonicalGraphDeployerRuntimeCodeHash());
    }

    function _requireRuntimeCodeHash(address target, bytes32 expected) private view {
        bytes32 actual = target.codehash;
        if (actual != expected) revert RuntimeCodeHashMismatch(target, expected, actual);
    }

    function _canonicalPoolManagerRuntimeCodeHash() internal view virtual returns (bytes32);
    function _canonicalGraphDeployerRuntimeCodeHash() internal view virtual returns (bytes32);
}

contract ProgrammableFeeVaultV2 is ProgrammableFeeVaultV2Core {
    constructor()
        ProgrammableFeeVaultV2Core(PROGRAMMABLE_CANONICAL_POOL_MANAGER_V2, PROGRAMMABLE_CANONICAL_GRAPH_DEPLOYER_V2)
    { }

    function _canonicalPoolManagerRuntimeCodeHash() internal pure override returns (bytes32) {
        return PROGRAMMABLE_CANONICAL_POOL_MANAGER_RUNTIME_CODE_HASH_V2;
    }

    function _canonicalGraphDeployerRuntimeCodeHash() internal pure override returns (bytes32) {
        return PROGRAMMABLE_CANONICAL_GRAPH_DEPLOYER_RUNTIME_CODE_HASH_V2;
    }
}
