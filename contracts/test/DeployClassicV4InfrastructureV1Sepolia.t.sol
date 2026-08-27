// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { DeployClassicV4InfrastructureV1ForkBase } from "./utils/DeployClassicV4InfrastructureV1ForkBase.sol";

contract DeployClassicV4InfrastructureV1SepoliaTest is DeployClassicV4InfrastructureV1ForkBase {
    uint256 internal constant SNAPSHOT_BLOCK = 11_577_000;

    function setUp() public {
        _selectFork("SEPOLIA_RPC_URL", "https://ethereum-sepolia-rpc.publicnode.com", SNAPSHOT_BLOCK);
    }

    function test_sepoliaReusesExactV3DependenciesAndDeploysStandardReleasePrep() public {
        _assertDeterministicDeploymentAndLaunch(0);
    }
}
