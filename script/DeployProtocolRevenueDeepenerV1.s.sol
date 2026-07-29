// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Script } from "forge-std/Script.sol";

import { ProtocolRevenueDeepenerV1 } from "../src/ProtocolRevenueDeepenerV1.sol";

contract DeployProtocolRevenueDeepenerV1 is Script {
    function run() external returns (ProtocolRevenueDeepenerV1 deepener) {
        vm.startBroadcast();
        deepener = new ProtocolRevenueDeepenerV1();
        vm.stopBroadcast();
    }
}
