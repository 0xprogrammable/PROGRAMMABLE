// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Script } from "forge-std/Script.sol";

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";

import { ProgrammableCreate2GraphDeployerV1 } from "../../src/ProgrammableCreate2GraphDeployerV1.sol";
import { ProgrammableLaunchStampRouterV1 } from "../../src/robinhood-custom-launch/ProgrammableLaunchStampRouterV1.sol";
import {
    IProgrammableCreate2GraphDeployerV1
} from "../../src/robinhood-custom-launch/interfaces/IProgrammableCreate2GraphDeployerV1.sol";

interface ISafeProxyFactoryV141 {
    function createProxyWithNonce(address singleton, bytes memory initializer, uint256 saltNonce)
        external
        returns (address payable proxy);
}

interface IMulticall3 {
    struct Call3 {
        address target;
        bool allowFailure;
        bytes callData;
    }

    struct Result {
        bool success;
        bytes returnData;
    }

    function aggregate3(Call3[] calldata calls) external payable returns (Result[] memory returnData);
}

interface ISafeV141 {
    function setup(
        address[] calldata owners,
        uint256 threshold,
        address to,
        bytes calldata data,
        address fallbackHandler,
        address paymentToken,
        uint256 payment,
        address payable paymentReceiver
    ) external;

    function getOwners() external view returns (address[] memory);
    function getThreshold() external view returns (uint256);
    function VERSION() external view returns (string memory);
    function masterCopy() external view returns (address);
    function nonce() external view returns (uint256);
    function getModulesPaginated(address start, uint256 pageSize)
        external
        view
        returns (address[] memory modules, address next);
    function getStorageAt(uint256 offset, uint256 length) external view returns (bytes memory);
}

/// @title PrepareRobinhoodCustomLaunchFoundationV1
/// @notice Produces one atomic unsigned transaction for the Robinhood Custom Launch trust-root foundation.
/// @dev `run` is deliberately read-only: it never calls `startBroadcast`, never reads a private key and cannot submit
///      a transaction even if Forge receives `--broadcast`. The selected sender must be one of the two owners observed
///      from Ethereum PermitAuthority at the recorded block. All three addresses are CREATE2-bound and sender/nonce
///      independent. Multicall3 executes the three zero-value component calls in order with `allowFailure = false`, so
///      partial foundation state cannot survive. A wallet owner must still separately review and submit the returned
///      transaction on chain 4663.
contract PrepareRobinhoodCustomLaunchFoundationV1 is Script {
    uint256 public constant ROBINHOOD_CHAIN_ID = 4663;
    string public constant CAIP2 = "eip155:4663";
    uint256 public constant PINNED_ROBINHOOD_BLOCK = 49_220_000;
    bytes32 public constant PINNED_ROBINHOOD_BLOCK_HASH =
        0xabc4e2a609516012bb7af14128a26a51a67012552f3e68b585a9c1814d120025;

    address public constant OWNER_0 = 0x032b1c7b96793717F0BD2f11eb86cd10CdefC4a3;
    address public constant OWNER_1 = 0x2Bb333d48DFAF1596D9036671d2E43168994249E;
    uint256 public constant SAFE_THRESHOLD = 1;

    address public constant SAFE_SINGLETON = 0x41675C099F32341bf84BFc5382aF534df5C7461a;
    address public constant SAFE_PROXY_FACTORY = 0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67;
    address public constant SAFE_FALLBACK_HANDLER = 0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99;
    address public constant MULTICALL3 = 0xcA11bde05977b3631167028862bE2a173976CA11;
    address public constant DETERMINISTIC_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address public constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;

    bytes32 public constant SAFE_SINGLETON_RUNTIME_CODE_HASH =
        0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4;
    bytes32 public constant SAFE_PROXY_FACTORY_RUNTIME_CODE_HASH =
        0x50c3cdc4074750a7a974204a716c999edd37482f907608d960b2b025ee0b3317;
    bytes32 public constant SAFE_FALLBACK_HANDLER_RUNTIME_CODE_HASH =
        0x7c6007a5d711cea8dfd5d91f5940ec29c7f200fe511eb1fc1397b367af3c42f9;
    bytes32 public constant SAFE_PROXY_RUNTIME_CODE_HASH =
        0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c;
    bytes32 public constant MULTICALL3_RUNTIME_CODE_HASH =
        0xd5c15df687b16f2ff992fc8d767b4216323184a2bbc6ee2f9c398c318e770891;
    bytes32 public constant DETERMINISTIC_DEPLOYER_RUNTIME_CODE_HASH =
        0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989;
    bytes32 public constant POOL_MANAGER_RUNTIME_CODE_HASH =
        0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626;
    bytes32 public constant ROUTER_RUNTIME_CODE_HASH =
        0x1dbbdaaad901ea3c6134dca0d4872a4789b3c071bf8ccfb44edd65d26d817388;

    uint256 public constant SAFE_SALT_NONCE = 0x64379301d86858c9c72eda110164ebe008411237ae7ec8c4b2391720fdedae45;
    bytes32 public constant GRAPH_FACTORY_SALT = 0x7d365f1aa1c69761337bf63b896eefcb81a5faedafad1b0b93e2ed7e132bc147;
    bytes32 public constant ROUTER_SALT = 0x7060d5971187bebbb37323b740bfbc8f494833e6ac5f31a27fc6b3bf289f2c0d;

    // Computed by the official SafeProxyFactory 1.4.1 from `safeInitializer()` and SAFE_SALT_NONCE.
    address public constant PERMIT_AUTHORITY = 0xeD617CE7f82e2AB589aDeFFD319D1D872Bc8De06;

    bytes20 public constant ROUTER_SOURCE_COMMIT = hex"0a7134bbb912222639627fb9078df2f8dd3a6c38";
    bytes32 public constant ROUTER_SOURCE_SHA256 = 0xef87aa9338c364634bffda64423bd3fb096c1630a45cc58ecf854d24959ff163;
    bytes20 public constant GRAPH_FACTORY_SOURCE_COMMIT = hex"518fd05066edeb6017db995af520819151173a3b";
    bytes32 public constant GRAPH_FACTORY_SOURCE_SHA256 =
        0x06a3acaf9beeb68647af231f5524c5a34dc013d99611a1b2d0a6c80895f595e9;

    bytes32 private constant PURPOSE_PERMIT_AUTHORITY = keccak256("permit-authority-safe-1.4.1");
    bytes32 private constant PURPOSE_GRAPH_FACTORY = keccak256("graph-factory-v1");
    bytes32 private constant PURPOSE_ROUTER = keccak256("launch-stamp-router-v1");
    bytes32 private constant FALLBACK_HANDLER_STORAGE_SLOT =
        0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5;
    bytes32 private constant GUARD_STORAGE_SLOT = 0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8;
    address private constant SENTINEL_MODULES = address(0x1);

    struct PreparedTransaction {
        address to;
        uint256 value;
        bytes data;
        bytes32 dataHash;
        bytes32 purpose;
    }

    struct DeploymentPlan {
        uint256 chainId;
        address sender;
        address permitAuthority;
        address graphFactory;
        address router;
        bytes32 graphFactoryCreationCodeHash;
        bytes32 graphFactoryRuntimeCodeHash;
        bytes32 routerCreationCodeHash;
        bytes32 sourceCommitment;
        PreparedTransaction ownerTransaction;
    }

    error AddressAlreadyOccupied(address account);
    error InvalidChain(uint256 actual, uint256 expected);
    error InvalidSender(address sender);
    error UnexpectedAddress(bytes32 field, address actual, address expected);
    error UnexpectedCodeHash(address account, bytes32 actual, bytes32 expected);
    error UnexpectedSafeConfiguration(bytes32 field);

    /// @notice Read-only Foundry entrypoint. `ROBINHOOD_CUSTOM_LAUNCH_DEPLOYER` is the sole unresolved owner choice.
    function run() external view returns (DeploymentPlan memory plan) {
        address sender = vm.envAddress("ROBINHOOD_CUSTOM_LAUNCH_DEPLOYER");
        plan = deploymentPlan(sender);
        validatePinnedDependencies();
        validateVacancy(plan);
    }

    /// @notice Post-deployment readback entrypoint; it never signs or broadcasts.
    function validate() external view returns (DeploymentPlan memory plan) {
        address sender = vm.envAddress("ROBINHOOD_CUSTOM_LAUNCH_DEPLOYER");
        plan = deploymentPlan(sender);
        validateDeployedFoundation(plan);
    }

    /// @notice Computes exact sender-independent transaction bytes and CREATE2 addresses.
    function deploymentPlan(address sender) public pure returns (DeploymentPlan memory plan) {
        if (sender != OWNER_0 && sender != OWNER_1) revert InvalidSender(sender);

        bytes memory graphCreationCode = type(ProgrammableCreate2GraphDeployerV1).creationCode;
        address graphFactory = _computeCreate2(DETERMINISTIC_DEPLOYER, GRAPH_FACTORY_SALT, keccak256(graphCreationCode));
        bytes memory routerCreationCode = bytes.concat(
            type(ProgrammableLaunchStampRouterV1).creationCode,
            abi.encode(PERMIT_AUTHORITY, IProgrammableCreate2GraphDeployerV1(graphFactory), IPoolManager(POOL_MANAGER))
        );
        address router = _computeCreate2(DETERMINISTIC_DEPLOYER, ROUTER_SALT, keccak256(routerCreationCode));

        PreparedTransaction memory ownerTransaction =
            _ownerTransaction(_componentCalls(graphCreationCode, routerCreationCode));

        plan = DeploymentPlan({
            chainId: ROBINHOOD_CHAIN_ID,
            sender: sender,
            permitAuthority: PERMIT_AUTHORITY,
            graphFactory: graphFactory,
            router: router,
            graphFactoryCreationCodeHash: keccak256(graphCreationCode),
            graphFactoryRuntimeCodeHash: keccak256(type(ProgrammableCreate2GraphDeployerV1).runtimeCode),
            routerCreationCodeHash: keccak256(routerCreationCode),
            sourceCommitment: deploymentSourceCommitment(graphFactory, router),
            ownerTransaction: ownerTransaction
        });
    }

    /// @notice Decodes the atomic owner transaction into its three ordered, non-wallet component calls.
    function componentCalls() public pure returns (PreparedTransaction[] memory) {
        bytes memory graphCreationCode = type(ProgrammableCreate2GraphDeployerV1).creationCode;
        address graphFactory = _computeCreate2(DETERMINISTIC_DEPLOYER, GRAPH_FACTORY_SALT, keccak256(graphCreationCode));
        bytes memory routerCreationCode = bytes.concat(
            type(ProgrammableLaunchStampRouterV1).creationCode,
            abi.encode(PERMIT_AUTHORITY, IProgrammableCreate2GraphDeployerV1(graphFactory), IPoolManager(POOL_MANAGER))
        );
        return _componentCalls(graphCreationCode, routerCreationCode);
    }

    function safeOwners() public pure returns (address[] memory owners) {
        owners = new address[](2);
        owners[0] = OWNER_0;
        owners[1] = OWNER_1;
    }

    function safeInitializer() public pure returns (bytes memory) {
        return abi.encodeCall(
            ISafeV141.setup,
            (
                safeOwners(),
                SAFE_THRESHOLD,
                address(0),
                bytes(""),
                SAFE_FALLBACK_HANDLER,
                address(0),
                0,
                payable(address(0))
            )
        );
    }

    function deploymentSourceCommitment(address graphFactory, address router) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("programmable.robinhood.custom-launch.foundation.v1"),
                ROBINHOOD_CHAIN_ID,
                keccak256(bytes(CAIP2)),
                PERMIT_AUTHORITY,
                graphFactory,
                router,
                keccak256(abi.encode(POOL_MANAGER, MULTICALL3)),
                ROUTER_SOURCE_COMMIT,
                ROUTER_SOURCE_SHA256,
                GRAPH_FACTORY_SOURCE_COMMIT,
                GRAPH_FACTORY_SOURCE_SHA256,
                SAFE_SALT_NONCE,
                GRAPH_FACTORY_SALT,
                ROUTER_SALT
            )
        );
    }

    function validatePinnedDependencies() public view {
        if (block.chainid != ROBINHOOD_CHAIN_ID) revert InvalidChain(block.chainid, ROBINHOOD_CHAIN_ID);
        _assertCodeHash(SAFE_SINGLETON, SAFE_SINGLETON_RUNTIME_CODE_HASH);
        _assertCodeHash(SAFE_PROXY_FACTORY, SAFE_PROXY_FACTORY_RUNTIME_CODE_HASH);
        _assertCodeHash(SAFE_FALLBACK_HANDLER, SAFE_FALLBACK_HANDLER_RUNTIME_CODE_HASH);
        _assertCodeHash(MULTICALL3, MULTICALL3_RUNTIME_CODE_HASH);
        _assertCodeHash(DETERMINISTIC_DEPLOYER, DETERMINISTIC_DEPLOYER_RUNTIME_CODE_HASH);
        _assertCodeHash(POOL_MANAGER, POOL_MANAGER_RUNTIME_CODE_HASH);
    }

    function validateVacancy(DeploymentPlan memory plan) public view {
        _assertVacant(plan.permitAuthority);
        _assertVacant(plan.graphFactory);
        _assertVacant(plan.router);
    }

    /// @notice Exact post-deployment constructor/getter/runtime validation; use at one finalized explicit block.
    function validateDeployedFoundation(DeploymentPlan memory plan) public view {
        validatePinnedDependencies();
        _assertCodeHash(plan.permitAuthority, SAFE_PROXY_RUNTIME_CODE_HASH);
        _assertCodeHash(plan.graphFactory, plan.graphFactoryRuntimeCodeHash);
        _assertCodeHash(plan.router, ROUTER_RUNTIME_CODE_HASH);

        ISafeV141 authority = ISafeV141(plan.permitAuthority);
        if (keccak256(bytes(authority.VERSION())) != keccak256(bytes("1.4.1"))) {
            revert UnexpectedSafeConfiguration(keccak256("version"));
        }
        if (authority.masterCopy() != SAFE_SINGLETON) {
            revert UnexpectedSafeConfiguration(keccak256("singleton"));
        }
        if (authority.getThreshold() != SAFE_THRESHOLD) {
            revert UnexpectedSafeConfiguration(keccak256("threshold"));
        }
        address[] memory owners = authority.getOwners();
        if (owners.length != 2 || owners[0] != OWNER_0 || owners[1] != OWNER_1) {
            revert UnexpectedSafeConfiguration(keccak256("owners"));
        }
        if (authority.nonce() != 0) revert UnexpectedSafeConfiguration(keccak256("nonce"));
        (address[] memory modules, address nextModule) = authority.getModulesPaginated(SENTINEL_MODULES, 16);
        if (modules.length != 0 || nextModule != SENTINEL_MODULES) {
            revert UnexpectedSafeConfiguration(keccak256("modules"));
        }
        address fallbackHandler = _storageAddress(authority, FALLBACK_HANDLER_STORAGE_SLOT);
        if (fallbackHandler != SAFE_FALLBACK_HANDLER) {
            revert UnexpectedSafeConfiguration(keccak256("fallback-handler"));
        }
        if (_storageAddress(authority, GUARD_STORAGE_SLOT) != address(0)) {
            revert UnexpectedSafeConfiguration(keccak256("guard"));
        }

        ProgrammableLaunchStampRouterV1 router = ProgrammableLaunchStampRouterV1(payable(plan.router));
        _assertAddress(keccak256("permit-authority"), router.PERMIT_AUTHORITY(), plan.permitAuthority);
        _assertAddress(keccak256("graph-factory"), address(router.GRAPH_FACTORY()), plan.graphFactory);
        _assertAddress(keccak256("pool-manager"), address(router.POOL_MANAGER()), POOL_MANAGER);
        if (router.CHAIN_ID() != ROBINHOOD_CHAIN_ID) revert UnexpectedSafeConfiguration(keccak256("router-chain"));
        if (router.PERMIT_AUTHORITY_RUNTIME_CODE_HASH() != SAFE_PROXY_RUNTIME_CODE_HASH) {
            revert UnexpectedSafeConfiguration(keccak256("authority-runtime"));
        }
        if (router.GRAPH_FACTORY_RUNTIME_CODE_HASH() != plan.graphFactoryRuntimeCodeHash) {
            revert UnexpectedSafeConfiguration(keccak256("factory-runtime"));
        }
        if (router.POOL_MANAGER_RUNTIME_CODE_HASH() != POOL_MANAGER_RUNTIME_CODE_HASH) {
            revert UnexpectedSafeConfiguration(keccak256("pool-manager-runtime"));
        }
    }

    function _prepared(address to, bytes memory data, bytes32 purpose)
        private
        pure
        returns (PreparedTransaction memory)
    {
        return PreparedTransaction({ to: to, value: 0, data: data, dataHash: keccak256(data), purpose: purpose });
    }

    function _componentCalls(bytes memory graphCreationCode, bytes memory routerCreationCode)
        private
        pure
        returns (PreparedTransaction[] memory preparedCalls)
    {
        preparedCalls = new PreparedTransaction[](3);
        preparedCalls[0] = _prepared(
            SAFE_PROXY_FACTORY,
            abi.encodeCall(
                ISafeProxyFactoryV141.createProxyWithNonce, (SAFE_SINGLETON, safeInitializer(), SAFE_SALT_NONCE)
            ),
            PURPOSE_PERMIT_AUTHORITY
        );
        preparedCalls[1] = _prepared(
            DETERMINISTIC_DEPLOYER, abi.encodePacked(GRAPH_FACTORY_SALT, graphCreationCode), PURPOSE_GRAPH_FACTORY
        );
        preparedCalls[2] =
            _prepared(DETERMINISTIC_DEPLOYER, abi.encodePacked(ROUTER_SALT, routerCreationCode), PURPOSE_ROUTER);
    }

    function _ownerTransaction(PreparedTransaction[] memory preparedCalls)
        private
        pure
        returns (PreparedTransaction memory)
    {
        IMulticall3.Call3[] memory calls = new IMulticall3.Call3[](preparedCalls.length);
        for (uint256 index = 0; index < preparedCalls.length; ++index) {
            calls[index] = IMulticall3.Call3({
                target: preparedCalls[index].to, allowFailure: false, callData: preparedCalls[index].data
            });
        }
        return _prepared(
            MULTICALL3,
            abi.encodeCall(IMulticall3.aggregate3, (calls)),
            keccak256("deploy-robinhood-custom-launch-foundation-v1-atomically")
        );
    }

    function _computeCreate2(address deployer, bytes32 salt, bytes32 initCodeHash) private pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, initCodeHash)))));
    }

    function _storageAddress(ISafeV141 authority, bytes32 slot) private view returns (address value) {
        bytes memory raw = authority.getStorageAt(uint256(slot), 1);
        if (raw.length != 32) revert UnexpectedSafeConfiguration(keccak256("storage-read"));
        bytes32 word = abi.decode(raw, (bytes32));
        // Safe stores both slots as ordinary right-aligned addresses.
        // forge-lint: disable-next-line(unsafe-typecast)
        value = address(uint160(uint256(word)));
    }

    function _assertVacant(address account) private view {
        if (account.code.length != 0) revert AddressAlreadyOccupied(account);
    }

    function _assertCodeHash(address account, bytes32 expected) private view {
        bytes32 actual = account.codehash;
        if (actual != expected) revert UnexpectedCodeHash(account, actual, expected);
    }

    function _assertAddress(bytes32 field, address actual, address expected) private pure {
        if (actual != expected) revert UnexpectedAddress(field, actual, expected);
    }
}
