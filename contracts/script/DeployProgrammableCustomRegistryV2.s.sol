// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Script } from "forge-std/Script.sol";
import { stdJson } from "forge-std/StdJson.sol";

import { ProgrammableCustomRegistryV2 } from "../src/ProgrammableCustomRegistryV2.sol";

/// @notice Environment-only deployment script. Running tests or builds never broadcasts.
contract DeployProgrammableCustomRegistryV2 is Script {
    using stdJson for string;

    function run() external returns (ProgrammableCustomRegistryV2 registry) {
        string memory reviewedPlanPath = vm.envString("REGISTRY_REVIEWED_PLAN_PATH");
        string memory reviewedPlan = vm.readFile(reviewedPlanPath);
        bytes32 expectedPlanDigest = vm.envBytes32("REGISTRY_REVIEWED_PLAN_SHA256");
        require(sha256(bytes(reviewedPlan)) == expectedPlanDigest, "reviewed plan digest mismatch");
        require(
            keccak256(bytes(reviewedPlan.readString(".schemaVersion")))
                == keccak256("programmable.custom-registry-deployment-preflight.v2"),
            "reviewed plan schema mismatch"
        );
        require(
            keccak256(bytes(reviewedPlan.readString(".status"))) == keccak256("READY_FOR_EXPLICIT_BROADCAST"),
            "reviewed plan is not authorized"
        );
        require(reviewedPlan.readBool(".signingAllowed"), "reviewed plan does not allow signing");
        require(reviewedPlan.readBool(".broadcastAllowed"), "reviewed plan does not allow broadcast");
        require(reviewedPlan.readUint(".chainId") == block.chainid, "reviewed plan chain mismatch");
        address deployer = vm.envAddress("REGISTRY_DEPLOYER");
        require(reviewedPlan.readAddress(".create.deployer") == deployer, "reviewed plan deployer mismatch");
        require(
            reviewedPlan.readUint(".create.exactPendingNonce") == vm.getNonce(deployer), "reviewed plan nonce mismatch"
        );
        require(
            reviewedPlan.readBytes32(".source.creationBytecodeKeccak256")
                == keccak256(type(ProgrammableCustomRegistryV2).creationCode),
            "reviewed plan bytecode mismatch"
        );

        ProgrammableCustomRegistryV2.RegistryConfigV2 memory config = ProgrammableCustomRegistryV2.RegistryConfigV2({
            initialAdminDelay: uint48(vm.envUint("REGISTRY_ADMIN_DELAY_SECONDS")),
            initialAdmin: vm.envAddress("REGISTRY_ADMIN"),
            initialApprover: vm.envAddress("REGISTRY_APPROVER"),
            initialRegistrar: vm.envAddress("REGISTRY_REGISTRAR"),
            initialFinalizer: vm.envAddress("REGISTRY_FINALIZER"),
            initialRevoker: vm.envAddress("REGISTRY_REVOKER"),
            minimumFinalityBlocks: uint64(vm.envUint("REGISTRY_MINIMUM_FINALITY_BLOCKS")),
            registryPolicyCommitment: vm.envBytes32("REGISTRY_POLICY_COMMITMENT")
        });
        bytes32 constructorCommitment = keccak256(abi.encode(config));
        require(
            reviewedPlan.readBytes32(".constructorCommitment") == constructorCommitment,
            "reviewed plan constructor mismatch"
        );

        vm.startBroadcast(deployer);
        registry = new ProgrammableCustomRegistryV2(config);
        vm.stopBroadcast();

        require(registry.CHAIN_ID() == block.chainid, "registry chain mismatch");
        require(registry.REGISTRY_GENERATION() == 2, "registry generation mismatch");
        require(registry.STANDARD10_PROTOCOL_FEE_BPS() == 10, "registry market policy mismatch");
        require(registry.NO_MARKET0_PROTOCOL_FEE_BPS() == 0, "registry no-market policy mismatch");
    }
}
