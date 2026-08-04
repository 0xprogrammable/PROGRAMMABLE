// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    IProtocolRevenueEthFeeHookV1,
    IProtocolRevenueMetaMaskAccountV1,
    IProtocolRevenueMetaMaskCaveatEnforcerV1,
    ProtocolRevenueExecution,
    IProtocolRevenueRouterTargetV1
} from "./interfaces/IProtocolRevenueMetaMaskV1.sol";

/// @title ProtocolRevenueExecutionEnforcerV1
/// @notice Restricts a MetaMask delegation to one exact Programmable protocol-revenue cycle.
/// @dev The enforcer accepts only the current native-fee hooks, the exact Deep claim transfer to the immutable router,
///      and one final process call for the exact aggregate claim. Existing wallet and router balances are excluded.
contract ProtocolRevenueExecutionEnforcerV1 is IProtocolRevenueMetaMaskCaveatEnforcerV1 {
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

    bytes32 public constant REVENUE_AUTHORITY_CODE_HASH =
        0xb09ef517c48d2bf6eed05457ff56871b2596e3fc904fc6e9795882a870c2e993;
    bytes32 public constant METAMASK_DELEGATOR_CODE_HASH =
        0x0b77e469f5603ed1e9ff0e7ee56238b61a8cf7cb3185b33e53e2eeaad50109ab;
    bytes32 public constant METAMASK_DELEGATION_MANAGER_CODE_HASH =
        0x762a7ccac3fba1fce7751870298c097c0d050451d9b4a1f0935e65dc4078d1d3;
    bytes32 public constant METAMASK_ENTRY_POINT_CODE_HASH =
        0x8db5ff695839d655407cc8490bb7a5d82337a86a6b39c3f0258aa6c3b582fc58;
    bytes32 public constant CLASSIC_V1_HOOK_CODE_HASH =
        0x60fd96af952730792036d43d806046675817a5a2de609d87c06203a8d6037650;
    bytes32 public constant CLASSIC_V2_HOOK_CODE_HASH =
        0x274e29fb8d19f0607533ac7582827db0236ab546bb393d52049229b2ffe74381;
    bytes32 public constant CLASSIC_V3_HOOK_CODE_HASH =
        0x3eba781023d3146ed9b502ac5b402d39cea4c34a14f64c878cb9ea62149590f1;
    bytes32 public constant DEEP_V1_HOOK_CODE_HASH = 0xda536944ead25d438a8a957ec1c7997115fb36d7e1af963d162b1ce99229b002;

    IProtocolRevenueRouterTargetV1 public immutable router;
    bytes32 public immutable routerCodeHash;

    error CodeHashMismatch(address target, bytes32 expected, bytes32 actual);
    error InvalidContext(address caller, address delegator, address redeemer);
    error InvalidDelegationHash();
    error InvalidExecution(uint256 index);
    error InvalidMetaMaskBinding();
    error InvalidMode(bytes32 actual);
    error InvalidPostcondition(uint64 actual, uint64 expected);
    error InvalidRouter(address router);
    error InvalidTerms();
    error NonCanonicalExecutionCalldata();
    error UnsignedArgumentsForbidden();

    constructor(IProtocolRevenueRouterTargetV1 router_) {
        address routerAddress = address(router_);
        if (
            block.chainid != 1 || routerAddress.code.length == 0 || router_.REVENUE_AUTHORITY() != REVENUE_AUTHORITY
                || router_.TREASURY() != TREASURY || router_.V4_TOKEN() != V4_TOKEN
                || router_.MAIN_POOL_ID() != MAIN_POOL_ID || router_.keeper() == address(0)
                || router_.keeper() == REVENUE_AUTHORITY || router_.keeper() == TREASURY
        ) {
            revert InvalidRouter(routerAddress);
        }
        router = router_;
        routerCodeHash = routerAddress.codehash;
        _assertBindings();
    }

    function beforeAllHook(
        bytes calldata terms,
        bytes calldata args,
        bytes32 mode,
        bytes calldata executionCalldata,
        bytes32 delegationHash,
        address delegator,
        address redeemer
    ) external view override {
        _validateContext(terms, args, mode, delegationHash, delegator, redeemer);
        ProtocolRevenueExecution[] memory executions = abi.decode(executionCalldata, (ProtocolRevenueExecution[]));
        if (keccak256(executionCalldata) != keccak256(abi.encode(executions))) {
            revert NonCanonicalExecutionCalldata();
        }
        _validateExecutionBatch(executions);
    }

    function beforeHook(
        bytes calldata terms,
        bytes calldata args,
        bytes32 mode,
        bytes calldata,
        bytes32 delegationHash,
        address delegator,
        address redeemer
    ) external view override {
        _validateContext(terms, args, mode, delegationHash, delegator, redeemer);
    }

    function afterHook(
        bytes calldata terms,
        bytes calldata args,
        bytes32 mode,
        bytes calldata,
        bytes32 delegationHash,
        address delegator,
        address redeemer
    ) external view override {
        _validateContext(terms, args, mode, delegationHash, delegator, redeemer);
    }

    function afterAllHook(
        bytes calldata terms,
        bytes calldata args,
        bytes32 mode,
        bytes calldata executionCalldata,
        bytes32 delegationHash,
        address delegator,
        address redeemer
    ) external view override {
        _validateContext(terms, args, mode, delegationHash, delegator, redeemer);
        ProtocolRevenueExecution[] memory executions = abi.decode(executionCalldata, (ProtocolRevenueExecution[]));
        if (keccak256(executionCalldata) != keccak256(abi.encode(executions)) || executions.length == 0) {
            revert NonCanonicalExecutionCalldata();
        }
        (uint64 scheduledAt,,) = _decodeProcessCall(executions[executions.length - 1].callData);
        uint64 actual = router.lastProcessedAt();
        // The router records the actual block timestamp, independently from a delayed scheduler timestamp.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 expected = uint64(block.timestamp);
        if (actual != expected || scheduledAt == 0) revert InvalidPostcondition(actual, expected);
    }

    function delegationTerms(address executor) external view returns (bytes memory) {
        return abi.encode(executor, executor.codehash);
    }

    function _validateExecutionBatch(ProtocolRevenueExecution[] memory executions) private view {
        uint256 cursor = 0;
        uint256 classicV1Accrued = IProtocolRevenueEthFeeHookV1(CLASSIC_V1_HOOK).launcherFeesAccrued();
        uint256 classicV2Accrued = IProtocolRevenueEthFeeHookV1(CLASSIC_V2_HOOK).launcherFeesAccrued();
        uint256 classicV3Accrued = IProtocolRevenueEthFeeHookV1(CLASSIC_V3_HOOK).launcherFeesAccrued();
        uint256 deepAccrued = IProtocolRevenueEthFeeHookV1(DEEP_V1_HOOK).launcherFeesAccrued();
        uint256 claimedRevenue = classicV1Accrued + classicV2Accrued + classicV3Accrued + deepAccrued;

        cursor = _requireRedirectClaimIfAccrued(executions, cursor, CLASSIC_V1_HOOK, classicV1Accrued);
        cursor = _requireRedirectClaimIfAccrued(executions, cursor, CLASSIC_V2_HOOK, classicV2Accrued);
        cursor = _requireRedirectClaimIfAccrued(executions, cursor, CLASSIC_V3_HOOK, classicV3Accrued);
        if (deepAccrued != 0) {
            _requireExecution(
                executions, cursor, DEEP_V1_HOOK, 0, abi.encodeCall(IProtocolRevenueEthFeeHookV1.claimLauncherFees, ())
            );
            unchecked {
                ++cursor;
            }
        }

        if (deepAccrued != 0) {
            _requireExecution(executions, cursor, address(router), deepAccrued, bytes(""));
            unchecked {
                ++cursor;
            }
        }

        if (executions.length != cursor + 1) revert InvalidExecution(cursor);
        ProtocolRevenueExecution memory processExecution = executions[cursor];
        if (processExecution.target != address(router) || processExecution.value != 0) revert InvalidExecution(cursor);
        (uint64 scheduledAt, int24 referenceTick, uint256 processRevenue) =
            _decodeProcessCall(processExecution.callData);
        if (
            processRevenue != claimedRevenue
                || keccak256(processExecution.callData)
                    != keccak256(
                        abi.encodeCall(
                            IProtocolRevenueRouterTargetV1.process, (scheduledAt, referenceTick, claimedRevenue)
                        )
                    )
        ) {
            revert InvalidExecution(cursor);
        }
    }

    function _requireRedirectClaimIfAccrued(
        ProtocolRevenueExecution[] memory executions,
        uint256 cursor,
        address hook,
        uint256 accrued
    ) private view returns (uint256 nextCursor) {
        if (accrued == 0) return cursor;
        _requireExecution(
            executions,
            cursor,
            hook,
            0,
            abi.encodeCall(IProtocolRevenueEthFeeHookV1.claimLauncherFeesTo, (address(router)))
        );
        unchecked {
            nextCursor = cursor + 1;
        }
    }

    function _requireExecution(
        ProtocolRevenueExecution[] memory executions,
        uint256 index,
        address target,
        uint256 value,
        bytes memory callData
    ) private pure {
        if (index >= executions.length) revert InvalidExecution(index);
        ProtocolRevenueExecution memory execution = executions[index];
        if (
            execution.target != target || execution.value != value
                || keccak256(execution.callData) != keccak256(callData)
        ) {
            revert InvalidExecution(index);
        }
    }

    function _decodeProcessCall(bytes memory callData)
        private
        pure
        returns (uint64 scheduledAt, int24 referenceTick, uint256 claimedRevenue)
    {
        if (callData.length != 100) revert InvalidExecution(type(uint256).max);
        bytes4 selector;
        uint256 scheduledWord;
        int256 tickWord;
        assembly ("memory-safe") {
            selector := mload(add(callData, 32))
            scheduledWord := mload(add(callData, 36))
            tickWord := mload(add(callData, 68))
            claimedRevenue := mload(add(callData, 100))
        }
        if (selector != IProtocolRevenueRouterTargetV1.process.selector || scheduledWord > type(uint64).max) {
            revert InvalidExecution(type(uint256).max);
        }
        // forge-lint: disable-next-line(unsafe-typecast)
        scheduledAt = uint64(scheduledWord);
        // forge-lint: disable-next-line(unsafe-typecast)
        referenceTick = int24(tickWord);
        if (int256(referenceTick) != tickWord) revert InvalidExecution(type(uint256).max);
    }

    function _validateContext(
        bytes calldata terms,
        bytes calldata args,
        bytes32 mode,
        bytes32 delegationHash,
        address delegator,
        address redeemer
    ) private view {
        if (msg.sender != METAMASK_DELEGATION_MANAGER || delegator != REVENUE_AUTHORITY) {
            revert InvalidContext(msg.sender, delegator, redeemer);
        }
        if (delegationHash == bytes32(0)) revert InvalidDelegationHash();
        if (args.length != 0) revert UnsignedArgumentsForbidden();
        if (mode != BATCH_DEFAULT_MODE) revert InvalidMode(mode);
        if (terms.length != 64) revert InvalidTerms();
        (address executor, bytes32 expectedCodeHash) = abi.decode(terms, (address, bytes32));
        if (executor != redeemer || executor.codehash != expectedCodeHash) revert InvalidTerms();
        _assertBindings();
    }

    function _assertBindings() private view {
        _assertCodeHash(REVENUE_AUTHORITY, REVENUE_AUTHORITY_CODE_HASH);
        _assertCodeHash(METAMASK_DELEGATOR_IMPLEMENTATION, METAMASK_DELEGATOR_CODE_HASH);
        _assertCodeHash(METAMASK_DELEGATION_MANAGER, METAMASK_DELEGATION_MANAGER_CODE_HASH);
        _assertCodeHash(METAMASK_ENTRY_POINT, METAMASK_ENTRY_POINT_CODE_HASH);
        _assertCodeHash(CLASSIC_V1_HOOK, CLASSIC_V1_HOOK_CODE_HASH);
        _assertCodeHash(CLASSIC_V2_HOOK, CLASSIC_V2_HOOK_CODE_HASH);
        _assertCodeHash(CLASSIC_V3_HOOK, CLASSIC_V3_HOOK_CODE_HASH);
        _assertCodeHash(DEEP_V1_HOOK, DEEP_V1_HOOK_CODE_HASH);
        _assertCodeHash(address(router), routerCodeHash);
        IProtocolRevenueMetaMaskAccountV1 account = IProtocolRevenueMetaMaskAccountV1(REVENUE_AUTHORITY);
        if (account.delegationManager() != METAMASK_DELEGATION_MANAGER || account.entryPoint() != METAMASK_ENTRY_POINT)
        {
            revert InvalidMetaMaskBinding();
        }
    }

    function _assertCodeHash(address target, bytes32 expected) private view {
        bytes32 actual = target.codehash;
        if (actual != expected) revert CodeHashMismatch(target, expected, actual);
    }
}
