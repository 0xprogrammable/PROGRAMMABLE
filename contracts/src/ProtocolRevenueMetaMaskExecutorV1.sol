// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC1271 } from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import { MessageHashUtils } from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

import {
    IProtocolRevenueEthFeeHookV1,
    IProtocolRevenueMetaMaskAccountV1,
    IProtocolRevenueMetaMaskDelegationManagerV1,
    IProtocolRevenueRouterTargetV1,
    ProtocolRevenueCaveat,
    ProtocolRevenueDelegation,
    ProtocolRevenueExecution
} from "./interfaces/IProtocolRevenueMetaMaskV1.sol";

interface IProtocolRevenueExecutionEnforcerTargetV1 {
    function BATCH_DEFAULT_MODE() external view returns (bytes32);

    function METAMASK_DELEGATION_MANAGER() external view returns (address);

    function REVENUE_AUTHORITY() external view returns (address);

    function router() external view returns (IProtocolRevenueRouterTargetV1);
}

/// @title ProtocolRevenueMetaMaskExecutorV1
/// @notice Executes Programmable's immutable daily 50/50 revenue policy through a restricted keeper and MetaMask
/// delegation. @dev The revenue wallet signs one revocable EIP-712 delegation to this exact runtime. The executor can
/// only build
///      the exact current-claim and process batch enforced by ProtocolRevenueExecutionEnforcerV1.
contract ProtocolRevenueMetaMaskExecutorV1 is ReentrancyGuardTransient {
    using MessageHashUtils for bytes32;

    bytes4 public constant EIP1271_MAGIC_VALUE = 0x1626ba7e;
    bytes32 public constant ROOT_AUTHORITY = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;
    bytes32 public constant BATCH_DEFAULT_MODE = 0x0100000000000000000000000000000000000000000000000000000000000000;

    address public constant REVENUE_AUTHORITY = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    address public constant TREASURY = 0x2Bb333d48DFAF1596D9036671d2E43168994249E;
    address public constant V4_TOKEN = 0x7987f03462200b3D8A072E02C89A8A41dCB124EE;
    bytes32 public constant MAIN_POOL_ID = 0xd9ca22573437a06a12d5c757b151aa1a76265c1dfdde4b76507233d7ad2b6df0;

    address public constant CLASSIC_V1_HOOK = 0x48bB2672c7fd2a12e7fb5D46c441ccD3726520Cc;
    address public constant CLASSIC_V2_HOOK = 0x025a386eAa79f6067d29848FD05ccC71bEAb20CC;
    address public constant CLASSIC_V3_HOOK = 0x35Fe236EA82F7cF525c9719d7df8F49F94D720CC;
    address public constant DEEP_V1_HOOK = 0x48dC3009eC1d3298BBA31f718A9A29d02fC9B0cC;

    address public constant METAMASK_DELEGATOR_IMPLEMENTATION = 0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B;
    address public constant METAMASK_DELEGATION_MANAGER = 0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3;
    address public constant METAMASK_ENTRY_POINT = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;
    uint64 public constant MAX_OBSERVATION_AGE = 30 minutes;

    bytes32 public constant REVENUE_AUTHORITY_CODE_HASH =
        0xb09ef517c48d2bf6eed05457ff56871b2596e3fc904fc6e9795882a870c2e993;
    bytes32 public constant METAMASK_DELEGATOR_CODE_HASH =
        0x0b77e469f5603ed1e9ff0e7ee56238b61a8cf7cb3185b33e53e2eeaad50109ab;
    bytes32 public constant METAMASK_DELEGATION_MANAGER_CODE_HASH =
        0x762a7ccac3fba1fce7751870298c097c0d050451d9b4a1f0935e65dc4078d1d3;
    IProtocolRevenueRouterTargetV1 public immutable router;
    IProtocolRevenueExecutionEnforcerTargetV1 public immutable enforcer;
    address public immutable keeper;
    bytes32 public immutable routerCodeHash;
    bytes32 public immutable enforcerCodeHash;

    bytes private _permissionContext;
    bytes32 public delegationHash;
    uint64 public lastAcceptedObservationAt;

    struct FeeSnapshot {
        uint256 classicV1;
        uint256 classicV2;
        uint256 classicV3;
        uint256 deepV1;
    }

    error AlreadyConfigured();
    error CodeHashMismatch(address target, bytes32 expected, bytes32 actual);
    error DelegationDisabled(bytes32 delegationHash);
    error FutureObservation(uint64 observedAt, uint256 currentTime);
    error InvalidDelegation();
    error InvalidRouterOrEnforcer();
    error InvalidSignature();
    error InvalidKeeper(address keeper);
    error NotReady(uint256 availableRevenue, uint256 nextRunAt);
    error ObservationReplay(uint64 observedAt, uint64 lastAcceptedObservationAt);
    error OnlyKeeper(address caller);
    error OnlyRevenueAuthority(address caller);
    error PermissionNotConfigured();
    error StaleObservation(uint64 observedAt, uint256 oldestAllowed);

    event DelegationConfigured(bytes32 indexed delegationHash, bytes32 indexed permissionContextHash);
    event RevenueCycleExecuted(uint64 indexed scheduledAt, uint256 nativeHookFeesClaimed, uint256 deepRevenueForwarded);

    constructor(
        IProtocolRevenueRouterTargetV1 router_,
        IProtocolRevenueExecutionEnforcerTargetV1 enforcer_,
        address keeper_
    ) {
        address routerAddress = address(router_);
        address enforcerAddress = address(enforcer_);
        if (
            block.chainid != 1 || routerAddress.code.length == 0 || enforcerAddress.code.length == 0
                || router_.REVENUE_AUTHORITY() != REVENUE_AUTHORITY || router_.TREASURY() != TREASURY
                || router_.V4_TOKEN() != V4_TOKEN || router_.MAIN_POOL_ID() != MAIN_POOL_ID
                || router_.keeper() != keeper_ || enforcer_.REVENUE_AUTHORITY() != REVENUE_AUTHORITY
                || enforcer_.METAMASK_DELEGATION_MANAGER() != METAMASK_DELEGATION_MANAGER
                || address(enforcer_.router()) != routerAddress || enforcer_.BATCH_DEFAULT_MODE() != BATCH_DEFAULT_MODE
        ) {
            revert InvalidRouterOrEnforcer();
        }
        if (keeper_ == address(0) || keeper_ == REVENUE_AUTHORITY || keeper_ == TREASURY) {
            revert InvalidKeeper(keeper_);
        }
        router = router_;
        enforcer = enforcer_;
        keeper = keeper_;
        routerCodeHash = routerAddress.codehash;
        enforcerCodeHash = enforcerAddress.codehash;
        _assertBindings();
    }

    function configureDelegation(bytes calldata permissionContext_) external nonReentrant {
        if (msg.sender != REVENUE_AUTHORITY) revert OnlyRevenueAuthority(msg.sender);
        if (_permissionContext.length != 0) revert AlreadyConfigured();
        _assertBindings();
        ProtocolRevenueDelegation[] memory delegations = abi.decode(permissionContext_, (ProtocolRevenueDelegation[]));
        if (
            delegations.length != 1 || keccak256(permissionContext_) != keccak256(abi.encode(delegations))
                || delegations[0].delegate != address(this) || delegations[0].delegator != REVENUE_AUTHORITY
                || delegations[0].authority != ROOT_AUTHORITY || delegations[0].caveats.length != 1
                || delegations[0].signature.length != 65
        ) {
            revert InvalidDelegation();
        }

        ProtocolRevenueCaveat memory caveat = delegations[0].caveats[0];
        if (
            caveat.enforcer != address(enforcer) || caveat.args.length != 0
                || keccak256(caveat.terms) != keccak256(expectedDelegationTerms())
        ) {
            revert InvalidDelegation();
        }

        IProtocolRevenueMetaMaskDelegationManagerV1 manager =
            IProtocolRevenueMetaMaskDelegationManagerV1(METAMASK_DELEGATION_MANAGER);
        if (manager.ROOT_AUTHORITY() != ROOT_AUTHORITY || manager.paused()) revert InvalidDelegation();
        bytes32 hash = manager.getDelegationHash(delegations[0]);
        if (manager.disabledDelegations(hash)) revert DelegationDisabled(hash);
        bytes32 typedDataHash = manager.getDomainHash().toTypedDataHash(hash);
        if (
            IERC1271(REVENUE_AUTHORITY).isValidSignature(typedDataHash, delegations[0].signature) != EIP1271_MAGIC_VALUE
        ) {
            revert InvalidSignature();
        }

        _permissionContext = permissionContext_;
        delegationHash = hash;
        emit DelegationConfigured(hash, keccak256(permissionContext_));
    }

    /// @notice Automated entry point for the fixed Vercel keeper. The reference tick must come from a finalized block.
    function executeKeeperCycle(uint64 observedAt, int24 referenceTick) external nonReentrant {
        if (msg.sender != keeper) revert OnlyKeeper(msg.sender);
        if (observedAt <= lastAcceptedObservationAt) {
            revert ObservationReplay(observedAt, lastAcceptedObservationAt);
        }
        // Timestamp checks only bound observation freshness; the router independently bounds tick deviation and impact.
        // forge-lint: disable-next-line(block-timestamp)
        if (observedAt > block.timestamp) revert FutureObservation(observedAt, block.timestamp);
        // forge-lint: disable-next-line(block-timestamp)
        uint256 oldestAllowed = block.timestamp > MAX_OBSERVATION_AGE ? block.timestamp - MAX_OBSERVATION_AGE : 0;
        if (observedAt < oldestAllowed) revert StaleObservation(observedAt, oldestAllowed);

        lastAcceptedObservationAt = observedAt;
        _executeCycle(observedAt, referenceTick);
    }

    /// @notice Manual fallback. The reference tick must be reviewed offchain and is signed by the revenue wallet.
    function executeCycle(int24 referenceTick) external nonReentrant {
        if (msg.sender != REVENUE_AUTHORITY) revert OnlyRevenueAuthority(msg.sender);
        // Mainnet timestamps fit in uint64 for the lifetime of this immutable deployment.
        // forge-lint: disable-next-line(unsafe-typecast)
        _executeCycle(uint64(block.timestamp), referenceTick);
    }

    function permissionContext() external view returns (bytes memory) {
        return _permissionContext;
    }

    function expectedDelegationTerms() public view returns (bytes memory) {
        return abi.encode(address(this), address(this).codehash);
    }

    function currentMainPoolTick() external view returns (int24) {
        return router.currentMainPoolTick();
    }

    function totalAccruedNativeHookFees() public view returns (uint256 total) {
        total += IProtocolRevenueEthFeeHookV1(CLASSIC_V1_HOOK).launcherFeesAccrued();
        total += IProtocolRevenueEthFeeHookV1(CLASSIC_V2_HOOK).launcherFeesAccrued();
        total += IProtocolRevenueEthFeeHookV1(CLASSIC_V3_HOOK).launcherFeesAccrued();
        total += IProtocolRevenueEthFeeHookV1(DEEP_V1_HOOK).launcherFeesAccrued();
    }

    function availableRevenue() public view returns (uint256) {
        return totalAccruedNativeHookFees();
    }

    function nextRunAt() public view returns (uint256) {
        uint64 processedAt = router.lastProcessedAt();
        if (processedAt == 0) return block.timestamp;
        return uint256(processedAt) + router.CYCLE_INTERVAL();
    }

    function _executeCycle(uint64 scheduledAt, int24 referenceTick) private {
        bytes memory configuredPermission = _permissionContext;
        if (configuredPermission.length == 0) revert PermissionNotConfigured();
        _assertBindings();
        bytes32 configuredHash = delegationHash;
        IProtocolRevenueMetaMaskDelegationManagerV1 manager =
            IProtocolRevenueMetaMaskDelegationManagerV1(METAMASK_DELEGATION_MANAGER);
        if (manager.disabledDelegations(configuredHash)) revert DelegationDisabled(configuredHash);

        uint256 totalAvailable = availableRevenue();
        uint256 eligibleAt = nextRunAt();
        // The 24-hour minimum cadence is insensitive to a validator's seconds of timestamp discretion.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < eligibleAt || totalAvailable < router.MIN_NEW_REVENUE()) {
            revert NotReady(totalAvailable, eligibleAt);
        }

        (ProtocolRevenueExecution[] memory executions, FeeSnapshot memory fees) =
            _buildExecutions(scheduledAt, referenceTick);

        bytes[] memory permissionContexts = new bytes[](1);
        permissionContexts[0] = configuredPermission;
        bytes32[] memory modes = new bytes32[](1);
        modes[0] = BATCH_DEFAULT_MODE;
        bytes[] memory executionCallDatas = new bytes[](1);
        executionCallDatas[0] = abi.encode(executions);
        manager.redeemDelegations(permissionContexts, modes, executionCallDatas);

        // The router records actual execution time, not scheduler time.
        // forge-lint: disable-next-line(unsafe-typecast)
        // Equality proves the router completed inside this transaction; validator discretion cannot redirect funds.
        // forge-lint: disable-next-line(block-timestamp)
        if (router.lastProcessedAt() != uint64(block.timestamp)) revert InvalidRouterOrEnforcer();
        emit RevenueCycleExecuted(scheduledAt, totalAvailable, fees.deepV1);
    }

    function _buildExecutions(uint64 scheduledAt, int24 referenceTick)
        private
        view
        returns (ProtocolRevenueExecution[] memory executions, FeeSnapshot memory fees)
    {
        fees.classicV1 = IProtocolRevenueEthFeeHookV1(CLASSIC_V1_HOOK).launcherFeesAccrued();
        fees.classicV2 = IProtocolRevenueEthFeeHookV1(CLASSIC_V2_HOOK).launcherFeesAccrued();
        fees.classicV3 = IProtocolRevenueEthFeeHookV1(CLASSIC_V3_HOOK).launcherFeesAccrued();
        fees.deepV1 = IProtocolRevenueEthFeeHookV1(DEEP_V1_HOOK).launcherFeesAccrued();
        uint256 claimedRevenue = fees.classicV1 + fees.classicV2 + fees.classicV3 + fees.deepV1;

        uint256 executionCount = 1;
        if (fees.classicV1 != 0) ++executionCount;
        if (fees.classicV2 != 0) ++executionCount;
        if (fees.classicV3 != 0) ++executionCount;
        if (fees.deepV1 != 0) ++executionCount;
        if (fees.deepV1 != 0) ++executionCount;

        executions = new ProtocolRevenueExecution[](executionCount);
        uint256 cursor = 0;
        cursor = _appendRedirectClaim(executions, cursor, CLASSIC_V1_HOOK, fees.classicV1);
        cursor = _appendRedirectClaim(executions, cursor, CLASSIC_V2_HOOK, fees.classicV2);
        cursor = _appendRedirectClaim(executions, cursor, CLASSIC_V3_HOOK, fees.classicV3);
        if (fees.deepV1 != 0) {
            executions[cursor] = ProtocolRevenueExecution({
                target: DEEP_V1_HOOK,
                value: 0,
                callData: abi.encodeCall(IProtocolRevenueEthFeeHookV1.claimLauncherFees, ())
            });
            unchecked {
                ++cursor;
            }
        }
        if (fees.deepV1 != 0) {
            executions[cursor] =
                ProtocolRevenueExecution({ target: address(router), value: fees.deepV1, callData: bytes("") });
            unchecked {
                ++cursor;
            }
        }
        executions[cursor] = ProtocolRevenueExecution({
            target: address(router),
            value: 0,
            callData: abi.encodeCall(
                IProtocolRevenueRouterTargetV1.process, (scheduledAt, referenceTick, claimedRevenue)
            )
        });
    }

    function _appendRedirectClaim(
        ProtocolRevenueExecution[] memory executions,
        uint256 cursor,
        address hook,
        uint256 accrued
    ) private view returns (uint256 nextCursor) {
        if (accrued == 0) return cursor;
        executions[cursor] = ProtocolRevenueExecution({
            target: hook,
            value: 0,
            callData: abi.encodeCall(IProtocolRevenueEthFeeHookV1.claimLauncherFeesTo, (address(router)))
        });
        unchecked {
            nextCursor = cursor + 1;
        }
    }

    function _assertBindings() private view {
        _assertCodeHash(REVENUE_AUTHORITY, REVENUE_AUTHORITY_CODE_HASH);
        _assertCodeHash(METAMASK_DELEGATOR_IMPLEMENTATION, METAMASK_DELEGATOR_CODE_HASH);
        _assertCodeHash(METAMASK_DELEGATION_MANAGER, METAMASK_DELEGATION_MANAGER_CODE_HASH);
        _assertCodeHash(address(router), routerCodeHash);
        _assertCodeHash(address(enforcer), enforcerCodeHash);
        IProtocolRevenueMetaMaskAccountV1 account = IProtocolRevenueMetaMaskAccountV1(REVENUE_AUTHORITY);
        if (account.delegationManager() != METAMASK_DELEGATION_MANAGER || account.entryPoint() != METAMASK_ENTRY_POINT)
        {
            revert InvalidDelegation();
        }
    }

    function _assertCodeHash(address target, bytes32 expected) private view {
        bytes32 actual = target.codehash;
        if (actual != expected) revert CodeHashMismatch(target, expected, actual);
    }
}
