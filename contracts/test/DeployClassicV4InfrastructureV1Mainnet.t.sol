// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { DeployClassicV4InfrastructureV1 } from "../script/DeployClassicV4InfrastructureV1.s.sol";
import { DeployClassicV4InfrastructureV1ForkBase } from "./utils/DeployClassicV4InfrastructureV1ForkBase.sol";

contract DeployClassicV4InfrastructureV1MainnetTest is DeployClassicV4InfrastructureV1ForkBase {
    uint256 internal constant SNAPSHOT_BLOCK = 25_640_000;

    function setUp() public {
        _selectFork("ETHEREUM_RPC_URL", "https://eth.drpc.org", SNAPSHOT_BLOCK);
    }

    function test_mainnetReusesExactV3DependenciesAndDeploysDeep30ReleasePrep() public {
        _assertApprovalAndInputGuards();
        _assertDeterministicDeploymentAndLaunch(1);
    }

    function _assertApprovalAndInputGuards() private {
        DeployClassicV4InfrastructureV1.Inputs memory inputs = deployment.expectedInputs();
        address launcherFeeRecipient = deployment.expectedLauncherFeeRecipient();
        vm.setEnv("CLASSIC_V4_MAINNET_OWNER_APPROVED", "false");
        vm.expectRevert(DeployClassicV4InfrastructureV1.ExplicitOwnerApprovalRequired.selector);
        deployment.deployReviewed(inputs, DEPLOYER, 0, launcherFeeRecipient);

        _approve(inputs);
        bytes32 actualCommitment = deployment.deploymentSourceCommitment(inputs);
        bytes32 wrongCommitment = keccak256("unreviewed-classic-v4-source");
        vm.setEnv("CLASSIC_V4_MAINNET_SOURCE_COMMITMENT", vm.toString(wrongCommitment));
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployClassicV4InfrastructureV1.UnexpectedCommitment.selector,
                keccak256("sourceCommitment"),
                actualCommitment,
                wrongCommitment
            )
        );
        deployment.deployReviewed(inputs, DEPLOYER, 0, launcherFeeRecipient);

        DeployClassicV4InfrastructureV1.Inputs memory wrongInputs = inputs;
        address expectedRewardVaultFactory = inputs.rewardVaultFactory;
        wrongInputs.rewardVaultFactory = makeAddr("wrongRewardVaultFactory");
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployClassicV4InfrastructureV1.UnexpectedAddress.selector,
                keccak256("rewardVaultFactory"),
                wrongInputs.rewardVaultFactory,
                expectedRewardVaultFactory
            )
        );
        deployment.validateSharedDependencies(wrongInputs);

        vm.chainId(8453);
        vm.expectRevert(abi.encodeWithSelector(DeployClassicV4InfrastructureV1.UnexpectedChain.selector, 8453));
        deployment.validateOfficialDependencies();
        vm.chainId(1);
    }
}
