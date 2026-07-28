// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { DeployClassicV3InfrastructureV1 } from "../script/DeployClassicV3InfrastructureV1.s.sol";
import { DeployClassicV3InfrastructureV1ForkBase } from "./utils/DeployClassicV3InfrastructureV1ForkBase.sol";

contract DeployClassicV3InfrastructureV1MainnetTest is DeployClassicV3InfrastructureV1ForkBase {
    uint256 internal constant SNAPSHOT_BLOCK = 25_630_943;

    function setUp() public {
        _selectFork("ETHEREUM_RPC_URL", "https://eth.drpc.org", SNAPSHOT_BLOCK);
    }

    function test_mainnetDependenciesPlanDeploymentAndOfficialLaunchAreExact() public {
        deployment.validateOfficialDependencies();
        _assertDeterministicDeploymentAndLaunch();
    }

    function test_rejectsStaleNonceWrongTreasuryAndUnsupportedChain() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployClassicV3InfrastructureV1.UnexpectedNonce.selector, DEPLOYER, uint64(0), uint64(1)
            )
        );
        deployment.deployReviewed(DEPLOYER, 1, TREASURY);

        address wrongTreasury = makeAddr("wrongClassicV3Treasury");
        vm.expectRevert(
            abi.encodeWithSelector(DeployClassicV3InfrastructureV1.UnexpectedTreasury.selector, wrongTreasury, TREASURY)
        );
        deployment.deployReviewed(DEPLOYER, 0, wrongTreasury);

        vm.chainId(8453);
        vm.expectRevert(abi.encodeWithSelector(DeployClassicV3InfrastructureV1.UnexpectedChain.selector, 8453));
        deployment.validateOfficialDependencies();
    }
}
