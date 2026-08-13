// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import {
    IProgrammableExactHookemonNormalCreateProfileV1
} from "../../src/router_vnext/IProgrammableExactHookemonNormalCreateProfileV1.sol";
import {
    IProgrammableExactHookemonReusableNormalCreateProfileV2
} from "../../src/router_vnext/IProgrammableExactHookemonReusableNormalCreateProfileV2.sol";
import { IProgrammableUniversalLaunchKernelV1 } from "../../src/router_vnext/IProgrammableUniversalLaunchKernelV1.sol";
import {
    ProgrammableExactHookemonReusablePlanModuleV2
} from "../../src/router_vnext/ProgrammableExactHookemonReusablePlanModuleV2.sol";
import {
    ProgrammableExactHookemonNormalCreateExecutorV2
} from "../../src/router_vnext/ProgrammableExactHookemonNormalCreateExecutorV2.sol";

contract HookemonPlanModuleCodeStubV2 { }

contract ProgrammableExactHookemonReusablePlanModuleV2Test is Test {
    ProgrammableExactHookemonReusablePlanModuleV2 private module;

    function setUp() external {
        module = new ProgrammableExactHookemonReusablePlanModuleV2();
    }

    function testFixedModuleBindingAndRuntimeAreExact() external view {
        assertEq(module.runtimeBindingHashV1(), module.MODULE_BINDING_HASH());
        assertEq(address(module).codehash, keccak256(type(ProgrammableExactHookemonReusablePlanModuleV2).runtimeCode));
        assertLt(address(module).code.length, 24_576);
    }

    function testFixedModuleCodeMutationChangesRuntimeIdentity() external {
        bytes32 expectedRuntime = address(module).codehash;
        vm.etch(address(module), hex"60006000fd");
        assertNotEq(address(module).codehash, expectedRuntime);
        assertNotEq(
            address(module).codehash, keccak256(type(ProgrammableExactHookemonReusablePlanModuleV2).runtimeCode)
        );
    }

    function testCanonicalGithubRepositoryIdentityVector() external pure {
        IProgrammableExactHookemonReusableNormalCreateProfileV2.ExactHookemonReusablePlanV2 memory plan = _plan();
        assertEq(plan.hookemon.githubRepositoryId, 1_324_982_531);
        assertEq(plan.hookemon.repositoryKey, 0x85af67313879b9844f94b66f3eb6bdc2f200e2647507f73f43242a576580961b);
    }

    function testPlanCommitmentsBindWebsiteIdentityAndPresentationMutation() external view {
        IProgrammableExactHookemonReusableNormalCreateProfileV2.ExactHookemonReusablePlanV2 memory plan = _plan();
        IProgrammableExactHookemonReusableNormalCreateProfileV2.PlanCommitmentsV2 memory beforeMutation =
            module.computePlanCommitmentsV2(plan);

        plan.hookemon.config.tokenName = "Hookemon Two";
        plan.hookemon.tokenNameHash = keccak256(bytes(plan.hookemon.config.tokenName));
        IProgrammableExactHookemonReusableNormalCreateProfileV2.PlanCommitmentsV2 memory afterName =
            module.computePlanCommitmentsV2(plan);
        assertNotEq(beforeMutation.planHash, afterName.planHash);
        assertNotEq(beforeMutation.configurationHash, afterName.configurationHash);

        plan = _plan();
        plan.hookemon.config.tokenSymbol = "HKM2";
        plan.hookemon.tokenSymbolHash = keccak256(bytes(plan.hookemon.config.tokenSymbol));
        IProgrammableExactHookemonReusableNormalCreateProfileV2.PlanCommitmentsV2 memory afterSymbol =
            module.computePlanCommitmentsV2(plan);
        assertNotEq(beforeMutation.planHash, afterSymbol.planHash);
        assertNotEq(beforeMutation.configurationHash, afterSymbol.configurationHash);

        plan = _plan();
        plan.hookemon.presentationBindingHash = keccak256("different-presentation");
        IProgrammableExactHookemonReusableNormalCreateProfileV2.PlanCommitmentsV2 memory afterPresentation =
            module.computePlanCommitmentsV2(plan);
        assertNotEq(beforeMutation.planHash, afterPresentation.planHash);
        assertNotEq(beforeMutation.configurationHash, afterPresentation.configurationHash);
    }

    function testExecutionCoreExcludesTransportButBindsExactInnerPlan() external view {
        IProgrammableExactHookemonReusableNormalCreateProfileV2.ExactHookemonReusablePlanV2 memory plan = _plan();
        bytes32 core = module.computeExecutionCoreHashV2(plan);
        assertEq(core, module.computeExecutionCoreHashV2(plan));

        plan.hookemon.completeInitCodeHash = keccak256("tampered-initcode");
        assertNotEq(core, module.computeExecutionCoreHashV2(plan));

        plan = _plan();
        plan.expectedExecutor = address(0xBEEF);
        assertNotEq(core, module.computeExecutionCoreHashV2(plan));
    }

    function testReservationsIncludeFixedModuleAndAllAuthorityDependencies() external view {
        IProgrammableExactHookemonReusableNormalCreateProfileV2.ExactHookemonReusablePlanV2 memory plan = _plan();
        ProgrammableExactHookemonReusablePlanModuleV2.ReservationDependenciesV2 memory dependencies;
        dependencies.codeStore = address(0xC001);
        dependencies.codeStoreRuntimeCodeHash = keccak256("code-store-runtime");
        dependencies.codeStoreBindingHash = keccak256("code-store-binding");
        dependencies.codeParts = [address(0xC002), address(0xC003)];
        dependencies.codePartRuntimeCodeHashes = [keccak256("part-0"), keccak256("part-1")];
        dependencies.postconditionVerifier = address(0xC004);
        dependencies.postconditionVerifierRuntimeCodeHash = keccak256("verifier-runtime");
        dependencies.verifierBindingHash = keccak256("verifier-binding");
        dependencies.planModule = address(module);
        dependencies.planModuleRuntimeCodeHash = address(module).codehash;
        dependencies.planModuleBindingHash = module.MODULE_BINDING_HASH();
        dependencies.permitAuthority = address(0xC005);
        dependencies.permitAuthorityRuntimeCodeHash = keccak256("permit-runtime");
        dependencies.permitAuthorityBindingHash = keccak256("permit-binding");
        IProgrammableUniversalLaunchKernelV1.ReservationV1[] memory reservations =
            module.buildReservationsV2(plan, dependencies);

        assertEq(reservations.length, 32);
        assertEq(reservations[0].account, plan.expectedExecutor);
        assertEq(
            reservations[0].expectedRuntimeCodeHash,
            keccak256(type(ProgrammableExactHookemonNormalCreateExecutorV2).runtimeCode)
        );
        assertEq(reservations[29].account, dependencies.postconditionVerifier);
        assertEq(reservations[30].account, address(module));
        assertEq(reservations[30].expectedRuntimeCodeHash, address(module).codehash);
        assertEq(reservations[30].sharedIdentityHash, module.MODULE_BINDING_HASH());
        assertEq(reservations[31].account, dependencies.permitAuthority);
        assertEq(reservations[31].sharedIdentityHash, dependencies.permitAuthorityBindingHash);
    }

    function testStructuralValidationRejectsRepoRouteAndExecutorMutation() external {
        IProgrammableExactHookemonReusableNormalCreateProfileV2.ExactHookemonReusablePlanV2 memory plan = _plan();
        address permitAuthority = plan.hookemon.repositoryLineageRegistry;

        vm.expectRevert(abi.encodeWithSelector(ProgrammableExactHookemonReusablePlanModuleV2.InvalidField.selector, 3));
        module.validateAndCommitPlanV2(plan, address(0xBAD), plan.expectedExecutor, plan.hookemon.exclusive.accounts[0]);

        plan = _plan();
        plan.hookemon.repositoryKey = keccak256("wrong-repo");
        vm.expectRevert(abi.encodeWithSelector(ProgrammableExactHookemonReusablePlanModuleV2.InvalidField.selector, 3));
        module.validateAndCommitPlanV2(
            plan, permitAuthority, plan.expectedExecutor, plan.hookemon.exclusive.accounts[0]
        );

        plan = _plan();
        vm.expectRevert(abi.encodeWithSelector(ProgrammableExactHookemonReusablePlanModuleV2.InvalidField.selector, 3));
        module.validateAndCommitPlanV2(plan, permitAuthority, address(0xBEEF), plan.hookemon.exclusive.accounts[0]);
    }

    function _plan()
        private
        pure
        returns (IProgrammableExactHookemonReusableNormalCreateProfileV2.ExactHookemonReusablePlanV2 memory plan)
    {
        plan.schemaVersion = 2;
        plan.hookemon.schemaVersion = 1;
        plan.hookemon.applicantWallet = address(0xA11CE);
        plan.hookemon.sourceLaunchId = keccak256("source-launch");
        plan.hookemon.githubRepositoryId = 1_324_982_531;
        plan.hookemon.repositoryKey = keccak256(abi.encode("programmable.github.repository.v1", uint64(1_324_982_531)));
        plan.hookemon.repositoryLineageRegistry = address(0xA007);
        plan.hookemon.presentationBindingHash = keccak256("presentation");
        plan.hookemon.config = _config();
        plan.hookemon.tokenNameHash = keccak256(bytes(plan.hookemon.config.tokenName));
        plan.hookemon.tokenSymbolHash = keccak256(bytes(plan.hookemon.config.tokenSymbol));
        plan.executorSalt = keccak256(
            abi.encode(
                keccak256(
                    "ExactHookemonExecutorSaltV2(bytes32 repositoryKey,bytes32 sourceLaunchId,address applicantWallet)"
                ),
                plan.hookemon.repositoryKey,
                plan.hookemon.sourceLaunchId,
                plan.hookemon.applicantWallet
            )
        );
        plan.expectedExecutor = address(0xE001);
        plan.hookemon.completeInitCodeHash = keccak256("launcher-initcode");
        plan.hookemon.poolManagerRuntimeCodeHash = keccak256("pool-manager-runtime");
        plan.hookemon.canonicalPoolId = keccak256("pool-id");
        plan.hookemon.expectedPositionTokenId = 77;
        plan.hookemon.expectedLaunchConfigHash = keccak256("launch-config");
        plan.hookemon.expectedLaunchId = keccak256("launch-id");
        plan.hookemon.expectedLaunchHash = keccak256("launch-hash");
        plan.hookemon.expectedArchitectureStateHash = keccak256("architecture");
        plan.hookemon.expectedPoolStateHash = keccak256("pool-state");
        plan.hookemon.expectedRevenueStateHash = keccak256("revenue-state");
        for (uint256 i; i < 9; ++i) {
            plan.hookemon.exclusive.accounts[i] = address(uint160(0x1000 + i));
            plan.hookemon.exclusive.runtimeCodeHashes[i] = keccak256(abi.encode("exclusive", i));
        }
        plan.hookemon.exclusive.accounts[0] = address(0x1A11CE);
        for (uint256 i; i < 14; ++i) {
            plan.hookemon.shared.accounts[i] = address(uint160(0x2000 + i));
            plan.hookemon.shared.runtimeCodeHashes[i] = keccak256(abi.encode("shared", i));
        }
        plan.hookemon.config.distributorFactory = plan.hookemon.shared.accounts[2];
        plan.hookemon.config.outboundBridgeFactory = plan.hookemon.shared.accounts[3];
        plan.hookemon.config.returnAdapterFactory = plan.hookemon.shared.accounts[4];
        plan.hookemon.config.cycleVaultFactory = plan.hookemon.shared.accounts[5];
        plan.hookemon.config.treasuryVestingFactory = plan.hookemon.shared.accounts[6];
        plan.hookemon.config.positionTimelockFactory = plan.hookemon.shared.accounts[7];
    }

    function _config()
        private
        pure
        returns (IProgrammableExactHookemonNormalCreateProfileV1.LaunchConfigV1 memory config)
    {
        config.tokenName = "Hookemon";
        config.tokenSymbol = "HKMN";
        config.poolManager = address(0x3001);
        config.positionManager = address(0x3002);
        config.usdc = address(0x3003);
        config.tokenMessengerV2 = address(0x3004);
        config.messageTransmitterV2 = address(0x3005);
        config.fundingWallet = address(0xA11CE);
        config.approvedMultisig = address(0x3006);
        config.executor = address(0x3007);
        config.artifactAuthorizer = address(0x3008);
        config.solanaUsdcAta = bytes32(uint256(1));
        config.solanaUsdcMint = bytes32(uint256(2));
        config.solanaReturnAuthority = bytes32(uint256(3));
        config.solanaTokenMessenger = bytes32(uint256(4));
        config.solanaDomain = 5;
        config.outboundProtocolFeeCapBps = 1;
        config.outboundForwardFeeCapMicroUsdc = 2_000_000;
        config.scheduleAnchor = 1_800_000_000;
        config.positionUnlockAt = config.scheduleAnchor + 2 * 365 days;
        config.launcherMode = 2;
        config.poolFee = 3000;
        config.tickSpacing = 60;
        config.tickLower = -887_220;
        config.tickUpper = 887_220;
        config.initialSqrtPriceX96 = 1 << 96;
        config.liquidityUsdcAmount = 29_000;
        config.cycleBootstrapUsdcAmount = 1000;
        config.expectedPositionLiquidity = 1;
    }
}
