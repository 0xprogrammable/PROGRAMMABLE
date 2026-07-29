// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { DeployClassicV3InfrastructureV1 } from "../script/DeployClassicV3InfrastructureV1.s.sol";
import { DeployClassicV3InfrastructureV1ForkBase } from "./utils/DeployClassicV3InfrastructureV1ForkBase.sol";

contract DeployClassicV3InfrastructureV1MainnetTest is DeployClassicV3InfrastructureV1ForkBase {
    uint256 internal constant SNAPSHOT_BLOCK = 25_639_000;
    address internal constant LAUNCHER_FEE_RECIPIENT = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;

    function setUp() public {
        _selectFork("ETHEREUM_RPC_URL", "https://eth.drpc.org", SNAPSHOT_BLOCK);
    }

    function test_mainnetDependenciesPlanDeploymentAndOfficialLaunchAreExact() public {
        deployment.validateOfficialDependencies();
        assertEq(deployment.expectedLauncherFeeRecipient(), LAUNCHER_FEE_RECIPIENT);
        _assertDeterministicDeploymentAndLaunch();
    }

    function test_rejectsStaleNonceWrongLauncherFeeRecipientAndUnsupportedChain() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployClassicV3InfrastructureV1.UnexpectedNonce.selector, DEPLOYER, uint64(0), uint64(1)
            )
        );
        deployment.deployReviewed(DEPLOYER, 1, LAUNCHER_FEE_RECIPIENT);

        address wrongRecipient = makeAddr("wrongClassicV3LauncherFeeRecipient");
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployClassicV3InfrastructureV1.UnexpectedLauncherFeeRecipient.selector,
                wrongRecipient,
                LAUNCHER_FEE_RECIPIENT
            )
        );
        deployment.deployReviewed(DEPLOYER, 0, wrongRecipient);

        vm.chainId(8453);
        vm.expectRevert(abi.encodeWithSelector(DeployClassicV3InfrastructureV1.UnexpectedChain.selector, 8453));
        deployment.validateOfficialDependencies();
    }
}
