// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { DeployClassicV3InfrastructureV1ForkBase } from "./utils/DeployClassicV3InfrastructureV1ForkBase.sol";

contract DeployClassicV3InfrastructureV1SepoliaTest is DeployClassicV3InfrastructureV1ForkBase {
    uint256 internal constant SNAPSHOT_BLOCK = 11_368_230;

    function setUp() public {
        _selectFork("SEPOLIA_RPC_URL", "https://sepolia.drpc.org", SNAPSHOT_BLOCK);
    }

    function test_sepoliaDependenciesPlanDeploymentAndOfficialLaunchAreExact() public {
        deployment.validateOfficialDependencies();
        _assertDeterministicDeploymentAndLaunch();
    }
}
