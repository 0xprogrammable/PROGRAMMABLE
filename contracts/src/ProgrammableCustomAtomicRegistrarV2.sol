// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProgrammableCustomAtomicRegistrarV1 } from "./ProgrammableCustomAtomicRegistrarV1.sol";
import { IProgrammableCustomRegistryV1 } from "./interfaces/IProgrammableCustomRegistryV1.sol";

/// @title ProgrammableCustomAtomicRegistrarV2
/// @notice Generation 2 deployment entry point retaining the frozen atomic-request and event ABI.
contract ProgrammableCustomAtomicRegistrarV2 is ProgrammableCustomAtomicRegistrarV1 {
    constructor(IProgrammableCustomRegistryV1 registry) ProgrammableCustomAtomicRegistrarV1(registry) { }
}
