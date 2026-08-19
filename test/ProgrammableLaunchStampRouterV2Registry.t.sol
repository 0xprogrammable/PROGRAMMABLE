// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC1271 } from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Test, Vm } from "forge-std/Test.sol";

import { ProgrammableLaunchStampRouterV2 } from "../src/ProgrammableLaunchStampRouterV2.sol";
import { IProgrammableLaunchStampRouterV2 } from "../src/interfaces/IProgrammableLaunchStampRouterV2.sol";
import { IProgrammableNestedFactoryModuleV1 } from "../src/interfaces/IProgrammableNestedFactoryModuleV1.sol";

contract RegistryAuthorityV2Mock is IERC1271 {
    mapping(bytes32 digest => bool approved) private _approved;

    function setApproved(bytes32 digest, bool approved) external {
        _approved[digest] = approved;
    }

    function isValidSignature(bytes32 digest, bytes memory) external view returns (bytes4) {
        return _approved[digest] ? IERC1271.isValidSignature.selector : bytes4(0xffffffff);
    }
}

contract RegistryCapabilityAdminV2Mock {
    function register(
        ProgrammableLaunchStampRouterV2 router,
        bytes32 profileIdHash,
        bytes32 profileVersionHash,
        address module,
        bytes32 moduleRuntimeCodeHash,
        bytes32 schemaHash
    ) external returns (bytes32 profileKey) {
        return router.registerProfileV2(profileIdHash, profileVersionHash, module, moduleRuntimeCodeHash, schemaHash);
    }
}

/// @dev One runtime is sufficient for token/NFT mocks and returns the invoked selector for any v4 hook callback.
contract RegistryComponentV2Mock {
    fallback() external payable {
        assembly ("memory-safe") {
            mstore(0, calldataload(0))
            return(0, 32)
        }
    }
}

contract RegistryNestedFactoryModuleV1Mock is IProgrammableNestedFactoryModuleV1 {
    address public immutable override routerV1;

    PlanV1 private _plan;
    bytes32 private _tokenSalt;
    bytes32 private _hookSalt;
    bytes32 private _nftSalt;
    bool public driftOnExecute;
    bool public attemptReentry;
    bool public reentrySucceeded;
    bytes4 public reentryRevertSelector;
    uint256 public executionCount;

    error UnauthorizedRouter(address caller);
    error InvalidLaunchWallet(address supplied, address expected);
    error InvalidChild(address supplied, address expected);

    constructor(address router_) {
        routerV1 = router_;
    }

    function configure(PlanV1 calldata plan_, bytes32 tokenSalt_, bytes32 hookSalt_, bytes32 nftSalt_) external {
        _plan = plan_;
        _tokenSalt = tokenSalt_;
        _hookSalt = hookSalt_;
        _nftSalt = nftSalt_;
    }

    function planV1() external view override returns (PlanV1 memory) {
        return _plan;
    }

    function setManifestHash(bytes32 manifestHash) external {
        _plan.manifestHash = manifestHash;
    }

    function setProfileIdHash(bytes32 profileIdHash) external {
        _plan.profileIdHash = profileIdHash;
    }

    function setProfileVersionHash(bytes32 profileVersionHash) external {
        _plan.profileVersionHash = profileVersionHash;
    }

    function setRevenuePolicyHash(bytes32 revenuePolicyHash) external {
        _plan.revenuePolicyHash = revenuePolicyHash;
    }

    function setFactory(address factory, bytes32 runtimeCodeHash) external {
        _plan.factory = factory;
        _plan.factoryRuntimeCodeHash = runtimeCodeHash;
    }

    function setToken(address token, bytes32 runtimeCodeHash) external {
        _plan.token = token;
        _plan.tokenRuntimeCodeHash = runtimeCodeHash;
        _plan.poolKey.currency1 = Currency.wrap(token);
    }

    function setDriftOnExecute(bool enabled) external {
        driftOnExecute = enabled;
    }

    function setAttemptReentry(bool enabled) external {
        attemptReentry = enabled;
    }

    function executeNestedFactoryV1(address launchWallet)
        external
        override
        returns (bytes32 observedConfigurationHash)
    {
        if (msg.sender != routerV1) revert UnauthorizedRouter(msg.sender);
        if (launchWallet != _plan.launchWallet) revert InvalidLaunchWallet(launchWallet, _plan.launchWallet);
        ++executionCount;

        RegistryComponentV2Mock token = new RegistryComponentV2Mock{ salt: _tokenSalt }();
        RegistryComponentV2Mock hook = new RegistryComponentV2Mock{ salt: _hookSalt }();
        RegistryComponentV2Mock nft = new RegistryComponentV2Mock{ salt: _nftSalt }();
        if (address(token) != _plan.token) revert InvalidChild(address(token), _plan.token);
        if (address(hook) != _plan.hook) revert InvalidChild(address(hook), _plan.hook);
        if (address(nft) != _plan.nft) revert InvalidChild(address(nft), _plan.nft);

        IPoolManager(_plan.poolManager).initialize(_plan.poolKey, _plan.startSqrtPriceX96);

        if (attemptReentry) {
            IProgrammableLaunchStampRouterV2.LaunchPermitV2 memory blankPermit;
            bytes memory reentry = abi.encodeCall(
                IProgrammableLaunchStampRouterV2.launchRegisteredProfileAndStampV2, (blankPermit, bytes(""))
            );
            bytes memory returndata;
            (reentrySucceeded, returndata) = routerV1.call(reentry);
            if (returndata.length >= 4) {
                bytes4 selector;
                assembly ("memory-safe") {
                    selector := mload(add(returndata, 32))
                }
                reentryRevertSelector = selector;
            }
        }

        observedConfigurationHash = _plan.configurationHash;
        if (driftOnExecute) _plan.manifestHash = keccak256(abi.encode(_plan.manifestHash, "post-drift"));
    }

    function validatePostV1() external view override returns (bytes4 magic, bytes32 observedConfigurationHash) {
        return (IProgrammableNestedFactoryModuleV1.validatePostV1.selector, _plan.configurationHash);
    }
}

    /// @notice Independent coverage for the add-only fixed-ABI nested-factory registry path.
    /// @dev The Router hard-pins the canonical Mainnet PoolManager runtime, so the suite uses the same immutable
    ///      Mainnet snapshot but no Shards route artifacts or helpers from the exact-profile integration test.
    contract ProgrammableLaunchStampRouterV2RegistryTest is Test {
        using PoolIdLibrary for PoolKey;
        using StateLibrary for IPoolManager;

        uint256 internal constant SNAPSHOT_BLOCK = 25_724_010;
        address internal constant POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
        bytes32 internal constant POOL_MANAGER_RUNTIME =
            0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293;
        address internal constant SHARDS_TOKEN = 0x50d17EAaeB52c66E64b918385AbF6523fDAE57CF;
        uint24 internal constant DYNAMIC_FEE = 0x800000;
        uint160 internal constant START_SQRT_PRICE_X96 = 1 << 96;

        bytes32 internal constant POOL_KEY_TYPEHASH = keccak256(
            "ProgrammablePoolKeyV1(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)"
        );
        bytes32 internal constant STAMP_REQUEST_TYPEHASH = keccak256(
            "ProgrammableStampRequestV2(bytes32 launchId,address token,bytes32 tokenRuntimeCodeHash,address hook,bytes32 hookRuntimeCodeHash,address nft,bytes32 nftRuntimeCodeHash,bytes32 poolKeyHash)"
        );
        bytes32 internal constant EXPECTED_RESULT_TYPEHASH = keccak256(
            "ProgrammableNestedFactoryResultV1(address factory,bytes32 factoryRuntimeCodeHash,address renderer,bytes32 rendererRuntimeCodeHash,address token,bytes32 tokenRuntimeCodeHash,address hook,bytes32 hookRuntimeCodeHash,address nft,bytes32 nftRuntimeCodeHash,bytes32 configurationHash,bytes32 poolKeyHash,uint160 sqrtPriceX96)"
        );

        RegistryAuthorityV2Mock internal authority;
        RegistryCapabilityAdminV2Mock internal admin;
        ProgrammableLaunchStampRouterV2 internal router;
        bytes32 internal moduleSchemaHash;

        function setUp() public {
            string memory rpc = vm.envOr("ETHEREUM_RPC_URL", string(""));
            if (bytes(rpc).length == 0) {
                vm.skip(true);
                return;
            }
            vm.createSelectFork(rpc, SNAPSHOT_BLOCK);
            assertEq(block.chainid, 1);
            assertEq(POOL_MANAGER.codehash, POOL_MANAGER_RUNTIME);
            authority = new RegistryAuthorityV2Mock();
            admin = new RegistryCapabilityAdminV2Mock();
            router = new ProgrammableLaunchStampRouterV2(address(authority), address(admin));
            moduleSchemaHash = router.NESTED_FACTORY_MODULE_SCHEMA_HASH();
            assertEq(router.PERMIT_AUTHORITY(), address(authority));
            assertEq(router.CAPABILITY_ADMIN(), address(admin));
            assertTrue(router.PERMIT_AUTHORITY() != router.CAPABILITY_ADMIN());
        }

        function test_fixedModuleABIRegistrationStoresPlanHashAndIsAddOnly() public {
            (RegistryNestedFactoryModuleV1Mock module, IProgrammableNestedFactoryModuleV1.PlanV1 memory plan) =
                _newModule("fixed-abi", "1.0.0", address(router));

            bytes32 profileKey = _register(module, plan);
            IProgrammableLaunchStampRouterV2.ProfileCapabilityV2 memory capability = router.profileCapability(
                profileKey
            );
            bytes32 expectedPlanHash = _planHash(plan);

            assertEq(IProgrammableNestedFactoryModuleV1.routerV1.selector, bytes4(keccak256("routerV1()")));
            assertEq(module.routerV1(), address(router));
            assertEq(profileKey, router.computeProfileKey(plan.profileIdHash, plan.profileVersionHash));
            assertEq(capability.module, address(module));
            assertEq(capability.moduleRuntimeCodeHash, address(module).codehash);
            assertEq(capability.schemaHash, moduleSchemaHash);
            assertEq(capability.planHash, expectedPlanHash);
            assertTrue(capability.enabled);
            assertFalse(capability.builtin);

            vm.expectRevert(
                abi.encodeWithSelector(ProgrammableLaunchStampRouterV2.ProfileAlreadyRegistered.selector, profileKey)
            );
            admin.register(
                router,
                plan.profileIdHash,
                plan.profileVersionHash,
                address(module),
                address(module).codehash,
                moduleSchemaHash
            );
        }

        function test_registrationRejectsWrongRouterV1Binding() public {
            (RegistryNestedFactoryModuleV1Mock module, IProgrammableNestedFactoryModuleV1.PlanV1 memory plan) =
                _newModule("wrong-router", "1.0.0", address(0xBEEF));

            vm.expectRevert(abi.encodeWithSelector(ProgrammableLaunchStampRouterV2.InvalidBinding.selector, uint8(16)));
            admin.register(
                router,
                plan.profileIdHash,
                plan.profileVersionHash,
                address(module),
                address(module).codehash,
                moduleSchemaHash
            );
        }

        function test_moduleExecutionRejectsEveryNonRouterCaller() public {
            (RegistryNestedFactoryModuleV1Mock module, IProgrammableNestedFactoryModuleV1.PlanV1 memory plan) =
                _newModule("caller-binding", "1.0.0", address(router));

            vm.expectRevert(
                abi.encodeWithSelector(RegistryNestedFactoryModuleV1Mock.UnauthorizedRouter.selector, address(this))
            );
            module.executeNestedFactoryV1(plan.launchWallet);
            assertEq(module.executionCount(), 0);
        }

        function test_registrationRejectsSchemaMismatch() public {
            (RegistryNestedFactoryModuleV1Mock module, IProgrammableNestedFactoryModuleV1.PlanV1 memory plan) =
                _newModule("schema-mismatch", "1.0.0", address(router));

            vm.expectRevert(abi.encodeWithSelector(ProgrammableLaunchStampRouterV2.InvalidBinding.selector, uint8(12)));
            admin.register(
                router,
                plan.profileIdHash,
                plan.profileVersionHash,
                address(module),
                address(module).codehash,
                keccak256("wrong-schema")
            );
        }

        function test_registrationRejectsProfileIdVersionAndZeroRevenuePolicy() public {
            (RegistryNestedFactoryModuleV1Mock wrongId, IProgrammableNestedFactoryModuleV1.PlanV1 memory idPlan) =
                _newModule("wrong-id", "1.0.0", address(router));
            wrongId.setProfileIdHash(keccak256("different-profile-id"));
            vm.expectRevert(abi.encodeWithSelector(ProgrammableLaunchStampRouterV2.InvalidBinding.selector, uint8(16)));
            admin.register(
                router,
                idPlan.profileIdHash,
                idPlan.profileVersionHash,
                address(wrongId),
                address(wrongId).codehash,
                moduleSchemaHash
            );

            (
                RegistryNestedFactoryModuleV1Mock wrongVersion,
                IProgrammableNestedFactoryModuleV1.PlanV1 memory versionPlan
            ) = _newModule("wrong-version", "1.0.0", address(router));
            wrongVersion.setProfileVersionHash(keccak256("2.0.0"));
            vm.expectRevert(abi.encodeWithSelector(ProgrammableLaunchStampRouterV2.InvalidBinding.selector, uint8(16)));
            admin.register(
                router,
                versionPlan.profileIdHash,
                versionPlan.profileVersionHash,
                address(wrongVersion),
                address(wrongVersion).codehash,
                moduleSchemaHash
            );

            (
                RegistryNestedFactoryModuleV1Mock zeroRevenue,
                IProgrammableNestedFactoryModuleV1.PlanV1 memory revenuePlan
            ) = _newModule("zero-revenue", "1.0.0", address(router));
            zeroRevenue.setRevenuePolicyHash(bytes32(0));
            vm.expectRevert(abi.encodeWithSelector(ProgrammableLaunchStampRouterV2.InvalidBinding.selector, uint8(16)));
            admin.register(
                router,
                revenuePlan.profileIdHash,
                revenuePlan.profileVersionHash,
                address(zeroRevenue),
                address(zeroRevenue).codehash,
                moduleSchemaHash
            );
        }

        function test_planMutationAfterRegistrationRejectedBeforePermitConsumption() public {
            (RegistryNestedFactoryModuleV1Mock module, IProgrammableNestedFactoryModuleV1.PlanV1 memory plan) =
                _newModule("pre-drift", "1.0.0", address(router));
            bytes32 profileKey = _register(module, plan);
            module.setManifestHash(keccak256("mutated-manifest"));

            IProgrammableLaunchStampRouterV2.LaunchPermitV2 memory permit;
            permit.profileKey = profileKey;
            vm.expectRevert(abi.encodeWithSelector(ProgrammableLaunchStampRouterV2.InvalidBinding.selector, uint8(16)));
            router.launchRegisteredProfileAndStampV2(permit, hex"");
        }

        function test_planMutationDuringExecutionRollsBackChildrenPoolAndPermitThenRetries() public {
            (RegistryNestedFactoryModuleV1Mock module, IProgrammableNestedFactoryModuleV1.PlanV1 memory plan) =
                _newModule("post-drift", "1.0.0", address(router));
            bytes32 profileKey = _register(module, plan);
            IProgrammableLaunchStampRouterV2.LaunchPermitV2 memory permit = _permit(profileKey, plan);
            bytes32 digest = _approve(permit);
            module.setDriftOnExecute(true);

            vm.expectRevert(abi.encodeWithSelector(ProgrammableLaunchStampRouterV2.InvalidBinding.selector, uint8(9)));
            vm.prank(plan.launchWallet);
            router.launchRegisteredProfileAndStampV2(permit, hex"01");

            assertEq(module.planV1().manifestHash, plan.manifestHash);
            assertEq(plan.token.code.length, 0);
            assertEq(plan.hook.code.length, 0);
            assertEq(plan.nft.code.length, 0);
            assertEq(_poolSqrtPrice(plan.poolKey), 0);
            assertFalse(router.nonceUsed(plan.launchWallet, permit.nonce));
            assertFalse(router.permitDigestUsed(digest));

            module.setDriftOnExecute(false);
            vm.prank(plan.launchWallet);
            router.launchRegisteredProfileAndStampV2(permit, hex"01");
            assertEq(plan.token.codehash, plan.tokenRuntimeCodeHash);
            assertEq(_poolSqrtPrice(plan.poolKey), plan.startSqrtPriceX96);
            assertTrue(router.nonceUsed(plan.launchWallet, permit.nonce));
            assertTrue(router.permitDigestUsed(digest));
        }

        function test_moduleAndFactoryRuntimeDriftAreRejected() public {
            (RegistryNestedFactoryModuleV1Mock module, IProgrammableNestedFactoryModuleV1.PlanV1 memory plan) =
                _newModule("module-drift", "1.0.0", address(router));
            bytes32 profileKey = _register(module, plan);
            bytes32 expectedModuleRuntime = address(module).codehash;
            vm.etch(address(module), hex"00");

            IProgrammableLaunchStampRouterV2.LaunchPermitV2 memory blankPermit;
            blankPermit.profileKey = profileKey;
            vm.expectRevert(
                abi.encodeWithSelector(
                    ProgrammableLaunchStampRouterV2.InvalidComponent.selector,
                    address(module),
                    expectedModuleRuntime,
                    address(module).codehash
                )
            );
            router.launchRegisteredProfileAndStampV2(blankPermit, hex"");

            (RegistryNestedFactoryModuleV1Mock second, IProgrammableNestedFactoryModuleV1.PlanV1 memory secondPlan) =
                _newModule("factory-drift", "1.0.0", address(router));
            bytes32 secondKey = _register(second, secondPlan);
            vm.etch(secondPlan.factory, hex"00");
            blankPermit.profileKey = secondKey;
            vm.expectRevert(
                abi.encodeWithSelector(
                    ProgrammableLaunchStampRouterV2.InvalidComponent.selector,
                    secondPlan.factory,
                    secondPlan.factoryRuntimeCodeHash,
                    secondPlan.factory.codehash
                )
            );
            router.launchRegisteredProfileAndStampV2(blankPermit, hex"");
        }

        function test_reservedAndCrossProfileComponentCollisionsAreRejected() public {
            (
                RegistryNestedFactoryModuleV1Mock reserved,
                IProgrammableNestedFactoryModuleV1.PlanV1 memory reservedPlan
            ) = _newModule("reserved-infra", "1.0.0", address(router));
            reserved.setFactory(address(router), address(router).codehash);
            vm.expectRevert(abi.encodeWithSelector(ProgrammableLaunchStampRouterV2.InvalidBinding.selector, uint8(16)));
            admin.register(
                router,
                reservedPlan.profileIdHash,
                reservedPlan.profileVersionHash,
                address(reserved),
                address(reserved).codehash,
                moduleSchemaHash
            );

            (RegistryNestedFactoryModuleV1Mock builtin, IProgrammableNestedFactoryModuleV1.PlanV1 memory builtinPlan) =
                _newModule("builtin-collision", "1.0.0", address(router));
            builtin.setToken(SHARDS_TOKEN, builtinPlan.tokenRuntimeCodeHash);
            vm.expectRevert(
                abi.encodeWithSelector(
                    ProgrammableLaunchStampRouterV2.ProfileAlreadyRegistered.selector, router.SHARDS_PROFILE_KEY()
                )
            );
            admin.register(
                router,
                builtinPlan.profileIdHash,
                builtinPlan.profileVersionHash,
                address(builtin),
                address(builtin).codehash,
                moduleSchemaHash
            );

            (RegistryNestedFactoryModuleV1Mock first, IProgrammableNestedFactoryModuleV1.PlanV1 memory firstPlan) =
                _newModule("first-profile", "1.0.0", address(router));
            bytes32 firstKey = _register(first, firstPlan);
            (RegistryNestedFactoryModuleV1Mock second, IProgrammableNestedFactoryModuleV1.PlanV1 memory secondPlan) =
                _newModule("second-profile", "1.0.0", address(router));
            second.setFactory(firstPlan.factory, firstPlan.factoryRuntimeCodeHash);
            vm.expectRevert(
                abi.encodeWithSelector(ProgrammableLaunchStampRouterV2.ProfileAlreadyRegistered.selector, firstKey)
            );
            admin.register(
                router,
                secondPlan.profileIdHash,
                secondPlan.profileVersionHash,
                address(second),
                address(second).codehash,
                moduleSchemaHash
            );
        }

        function test_capabilityAdminAuthorizationAndBothRoleRuntimePins() public {
            (RegistryNestedFactoryModuleV1Mock module, IProgrammableNestedFactoryModuleV1.PlanV1 memory plan) =
                _newModule("roles", "1.0.0", address(router));
            vm.expectRevert(
                abi.encodeWithSelector(
                    ProgrammableLaunchStampRouterV2.UnauthorizedCapabilityAdmin.selector, address(this)
                )
            );
            router.registerProfileV2(
                plan.profileIdHash, plan.profileVersionHash, address(module), address(module).codehash, moduleSchemaHash
            );

            bytes32 expectedAdminRuntime = address(admin).codehash;
            vm.etch(address(admin), hex"00");
            vm.expectRevert(
                abi.encodeWithSelector(
                    ProgrammableLaunchStampRouterV2.InvalidComponent.selector,
                    address(admin),
                    expectedAdminRuntime,
                    address(admin).codehash
                )
            );
            vm.prank(address(admin));
            router.registerProfileV2(
                plan.profileIdHash, plan.profileVersionHash, address(module), address(module).codehash, moduleSchemaHash
            );

            (
                RegistryNestedFactoryModuleV1Mock authorityModule,
                IProgrammableNestedFactoryModuleV1.PlanV1 memory authorityPlan
            ) = _newModule("authority-runtime", "1.0.0", address(router));
            // Restore only the pinned admin runtime so this independent phase can register.
            vm.etch(address(admin), type(RegistryCapabilityAdminV2Mock).runtimeCode);
            bytes32 profileKey = _register(authorityModule, authorityPlan);
            bytes32 expectedAuthorityRuntime = address(authority).codehash;
            vm.etch(address(authority), hex"00");

            IProgrammableLaunchStampRouterV2.LaunchPermitV2 memory permit;
            permit.profileKey = profileKey;
            vm.expectRevert(
                abi.encodeWithSelector(
                    ProgrammableLaunchStampRouterV2.InvalidComponent.selector,
                    address(authority),
                    expectedAuthorityRuntime,
                    address(authority).codehash
                )
            );
            vm.prank(authorityPlan.launchWallet);
            router.launchRegisteredProfileAndStampV2(permit, hex"");
        }

        function test_registeredLaunchRejectsReentryAndCompletesAtomicStamp() public {
            (RegistryNestedFactoryModuleV1Mock module, IProgrammableNestedFactoryModuleV1.PlanV1 memory plan) =
                _newModule("reentry", "1.0.0", address(router));
            bytes32 profileKey = _register(module, plan);
            IProgrammableLaunchStampRouterV2.LaunchPermitV2 memory permit = _permit(profileKey, plan);
            _approve(permit);
            module.setAttemptReentry(true);

            vm.recordLogs();
            vm.prank(plan.launchWallet);
            router.launchRegisteredProfileAndStampV2(permit, hex"01");

            assertFalse(module.reentrySucceeded());
            assertEq(module.reentryRevertSelector(), bytes4(keccak256("ReentrancyGuardReentrantCall()")));
            assertEq(router.launchIdByToken(plan.token), permit.nonce);
            assertEq(router.launchIdByComponent(plan.hook), permit.nonce);
            assertEq(_poolSqrtPrice(plan.poolKey), plan.startSqrtPriceX96);
            assertEq(
                uint8(router.launchStamp(permit.nonce).executionMode),
                uint8(IProgrammableLaunchStampRouterV2.ExecutionModeV2.REGISTERED_PROFILE_EXECUTED)
            );
            _assertPrimaryLaunchMode(
                vm.getRecordedLogs(), IProgrammableLaunchStampRouterV2.ExecutionModeV2.REGISTERED_PROFILE_EXECUTED
            );
        }

        function test_registeredExecutionUsesCallAndCannotMutateRouterRoleOrProfileStorage() public {
            (RegistryNestedFactoryModuleV1Mock module, IProgrammableNestedFactoryModuleV1.PlanV1 memory plan) =
                _newModule("call-only", "1.0.0", address(router));
            bytes32 profileKey = _register(module, plan);
            IProgrammableLaunchStampRouterV2.ProfileCapabilityV2 memory beforeCapability =
                router.profileCapability(profileKey);
            address permitAuthority = router.PERMIT_AUTHORITY();
            address capabilityAdmin = router.CAPABILITY_ADMIN();
            IProgrammableLaunchStampRouterV2.LaunchPermitV2 memory permit = _permit(profileKey, plan);
            _approve(permit);

            assertEq(module.executionCount(), 0);
            vm.prank(plan.launchWallet);
            router.launchRegisteredProfileAndStampV2(permit, hex"01");

            // A CALL persists the counter in module storage. A DELEGATECALL would instead write at the Router's slot.
            assertEq(module.executionCount(), 1);
            assertEq(router.PERMIT_AUTHORITY(), permitAuthority);
            assertEq(router.CAPABILITY_ADMIN(), capabilityAdmin);
            IProgrammableLaunchStampRouterV2.ProfileCapabilityV2 memory afterCapability =
                router.profileCapability(profileKey);
            assertEq(afterCapability.module, beforeCapability.module);
            assertEq(afterCapability.moduleRuntimeCodeHash, beforeCapability.moduleRuntimeCodeHash);
            assertEq(afterCapability.schemaHash, beforeCapability.schemaHash);
            assertEq(afterCapability.planHash, beforeCapability.planHash);
            assertTrue(afterCapability.enabled);
            assertFalse(afterCapability.builtin);
        }

        function _newModule(string memory profileId, string memory profileVersion, address routerBinding)
            private
            returns (RegistryNestedFactoryModuleV1Mock module, IProgrammableNestedFactoryModuleV1.PlanV1 memory plan)
        {
            RegistryComponentV2Mock factory = new RegistryComponentV2Mock();
            RegistryComponentV2Mock renderer = new RegistryComponentV2Mock();
            module = new RegistryNestedFactoryModuleV1Mock(routerBinding);

            bytes32 tokenSalt = keccak256(abi.encode(profileId, profileVersion, "token"));
            bytes32 hookSalt = _validHookSalt(address(module), keccak256(abi.encode(profileId, profileVersion, "hook")));
            bytes32 nftSalt = keccak256(abi.encode(profileId, profileVersion, "nft"));
            address token = _create2Address(address(module), tokenSalt);
            address hook = _create2Address(address(module), hookSalt);
            address nft = _create2Address(address(module), nftSalt);
            bytes32 componentRuntime = keccak256(type(RegistryComponentV2Mock).runtimeCode);

            plan.profileIdHash = keccak256(bytes(profileId));
            plan.profileVersionHash = keccak256(bytes(profileVersion));
            plan.sourceRevisionHash = keccak256(abi.encode(profileId, "source"));
            plan.manifestHash = keccak256(abi.encode(profileId, "manifest"));
            plan.revenuePolicyHash = keccak256(abi.encode(profileId, "revenue-policy"));
            plan.launchWallet = address(uint160(uint256(keccak256(abi.encode(profileId, "wallet")))));
            plan.factory = address(factory);
            plan.factoryRuntimeCodeHash = address(factory).codehash;
            plan.renderer = address(renderer);
            plan.rendererRuntimeCodeHash = address(renderer).codehash;
            plan.token = token;
            plan.tokenRuntimeCodeHash = componentRuntime;
            plan.hook = hook;
            plan.hookRuntimeCodeHash = componentRuntime;
            plan.nft = nft;
            plan.nftRuntimeCodeHash = componentRuntime;
            plan.poolManager = POOL_MANAGER;
            plan.poolKey = PoolKey({
                currency0: Currency.wrap(address(0)),
                currency1: Currency.wrap(token),
                fee: DYNAMIC_FEE,
                tickSpacing: 60,
                hooks: IHooks(hook)
            });
            plan.configurationHash = keccak256(abi.encode(profileId, "configuration"));
            plan.startSqrtPriceX96 = START_SQRT_PRICE_X96;
            module.configure(plan, tokenSalt, hookSalt, nftSalt);
        }

        function _register(
            RegistryNestedFactoryModuleV1Mock module,
            IProgrammableNestedFactoryModuleV1.PlanV1 memory plan
        ) private returns (bytes32 profileKey) {
            return admin.register(
                router,
                plan.profileIdHash,
                plan.profileVersionHash,
                address(module),
                address(module).codehash,
                moduleSchemaHash
            );
        }

        function _permit(bytes32 profileKey, IProgrammableNestedFactoryModuleV1.PlanV1 memory plan)
            private
            view
            returns (IProgrammableLaunchStampRouterV2.LaunchPermitV2 memory permit)
        {
            bytes32 routePayloadHash = _planHash(plan);
            bytes32 launchId = router.computeLaunchId(plan.launchWallet, profileKey, routePayloadHash);
            permit.chainId = 1;
            permit.router = address(router);
            permit.launchWallet = plan.launchWallet;
            permit.routeIdHash = router.ROUTE_ID_HASH();
            permit.routeVersionHash = router.ROUTE_VERSION_HASH();
            permit.profileKey = profileKey;
            permit.routePayloadHash = routePayloadHash;
            permit.expectedResultHash = _expectedResultHash(plan);
            permit.stampRequestHash = _stampRequestHash(plan, launchId);
            permit.nonce = launchId;
            permit.validAfter = uint64(block.timestamp);
            permit.deadline = uint64(block.timestamp + 1 hours);
            permit.value = 0;
        }

        function _approve(IProgrammableLaunchStampRouterV2.LaunchPermitV2 memory permit)
            private
            returns (bytes32 digest)
        {
            digest = router.permitDigest(permit);
            authority.setApproved(digest, true);
        }

        function _planHash(IProgrammableNestedFactoryModuleV1.PlanV1 memory plan) private view returns (bytes32) {
            return keccak256(abi.encode(router.MODULE_PLAN_TYPEHASH(), keccak256(abi.encode(plan))));
        }

        function _stampRequestHash(IProgrammableNestedFactoryModuleV1.PlanV1 memory plan, bytes32 launchId)
            private
            pure
            returns (bytes32)
        {
            return keccak256(
                abi.encode(
                    STAMP_REQUEST_TYPEHASH,
                    launchId,
                    plan.token,
                    plan.tokenRuntimeCodeHash,
                    plan.hook,
                    plan.hookRuntimeCodeHash,
                    plan.nft,
                    plan.nftRuntimeCodeHash,
                    _poolKeyHash(plan.poolKey)
                )
            );
        }

        function _expectedResultHash(IProgrammableNestedFactoryModuleV1.PlanV1 memory plan)
            private
            pure
            returns (bytes32)
        {
            return keccak256(
                abi.encode(
                    EXPECTED_RESULT_TYPEHASH,
                    plan.factory,
                    plan.factoryRuntimeCodeHash,
                    plan.renderer,
                    plan.rendererRuntimeCodeHash,
                    plan.token,
                    plan.tokenRuntimeCodeHash,
                    plan.hook,
                    plan.hookRuntimeCodeHash,
                    plan.nft,
                    plan.nftRuntimeCodeHash,
                    plan.configurationHash,
                    _poolKeyHash(plan.poolKey),
                    plan.startSqrtPriceX96
                )
            );
        }

        function _poolKeyHash(PoolKey memory key) private pure returns (bytes32) {
            return keccak256(
                abi.encode(
                    POOL_KEY_TYPEHASH,
                    Currency.unwrap(key.currency0),
                    Currency.unwrap(key.currency1),
                    key.fee,
                    key.tickSpacing,
                    address(key.hooks)
                )
            );
        }

        function _poolSqrtPrice(PoolKey memory key) private view returns (uint160 sqrtPriceX96) {
            (sqrtPriceX96,,,) = IPoolManager(POOL_MANAGER).getSlot0(key.toId());
        }

        function _assertPrimaryLaunchMode(
            Vm.Log[] memory logs,
            IProgrammableLaunchStampRouterV2.ExecutionModeV2 expectedMode
        ) private view {
            bytes32 launchTopic = keccak256(
                "ProgrammableLaunchStampedV2(bytes32,address,address,address,address,address,address,bytes32,bytes32,uint8)"
            );
            uint256 matched;
            for (uint256 i; i < logs.length; ++i) {
                if (logs[i].emitter != address(router) || logs[i].topics[0] != launchTopic) continue;
                (,,,,,, IProgrammableLaunchStampRouterV2.ExecutionModeV2 mode) = abi.decode(
                    logs[i].data,
                    (
                        address,
                        address,
                        address,
                        address,
                        bytes32,
                        bytes32,
                        IProgrammableLaunchStampRouterV2.ExecutionModeV2
                    )
                );
                assertEq(uint8(mode), uint8(expectedMode));
                ++matched;
            }
            assertEq(matched, 1);
        }

        function _validHookSalt(address deployer, bytes32 seed) private pure returns (bytes32 salt) {
            for (uint256 i; i < 256; ++i) {
                salt = keccak256(abi.encode(seed, i));
                if (_hasValidHookFlags(_create2Address(deployer, salt))) return salt;
            }
            revert("no valid hook salt");
        }

        function _hasValidHookFlags(address hook) private pure returns (bool) {
            uint160 flags = uint160(hook) & ((1 << 14) - 1);
            if ((flags & (1 << 3)) != 0 && (flags & (1 << 7)) == 0) return false;
            if ((flags & (1 << 2)) != 0 && (flags & (1 << 6)) == 0) return false;
            if ((flags & (1 << 1)) != 0 && (flags & (1 << 10)) == 0) return false;
            if ((flags & 1) != 0 && (flags & (1 << 8)) == 0) return false;
            return true;
        }

        function _create2Address(address deployer, bytes32 salt) private pure returns (address) {
            return address(
                uint160(
                    uint256(
                        keccak256(
                            abi.encodePacked(
                                hex"ff", deployer, salt, keccak256(type(RegistryComponentV2Mock).creationCode)
                            )
                        )
                    )
                )
            );
        }
    }
