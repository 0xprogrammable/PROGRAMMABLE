// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import { Permit2 } from "@uniswap/permit2/src/Permit2.sol";

/// @dev A separate 0.8.17 compilation root for Foundry's `vm.deployCode`. Tests interact with the exact pinned
/// Permit2 source through its public interface and never import this artifact into the 0.8.26 kernel graph.
contract PinnedPermit2Artifact is Permit2 { }
