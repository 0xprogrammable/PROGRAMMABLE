// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProgrammableCustomFeePolicyVerifierV1 } from "./ProgrammableCustomFeePolicyVerifierV1.sol";
import { ProgrammableCustomFeePolicyVerifierV2 } from "./ProgrammableCustomFeePolicyVerifierV2.sol";
import { ProgrammableCustomPartnerFactoryRegistryV2 } from "./ProgrammableCustomPartnerFactoryRegistryV2.sol";
import { ProgrammableCustomRegistryV1 } from "./ProgrammableCustomRegistryV1.sol";
import {
    IProgrammableCustomPartnerFactoryRegistryV1
} from "./interfaces/IProgrammableCustomPartnerFactoryRegistryV1.sol";

/// @title ProgrammableCustomRegistryV2
/// @notice Generation 2 deployment wrapper around the frozen 15-event V1 integration ABI.
/// @dev The inherited registry retains the reviewed 37-word binding and appends generation=2 to every scoped proof.
contract ProgrammableCustomRegistryV2 is ProgrammableCustomRegistryV1 {
    uint64 public constant REQUIRED_REGISTRY_GENERATION = 2;

    error GenerationTwoRequired(uint64 supplied);

    constructor(
        RegistryConfigV1 memory config,
        ProgrammableCustomPartnerFactoryRegistryV2 partnerFactoryRegistry,
        ProgrammableCustomFeePolicyVerifierV2 feePolicyVerifier
    )
        ProgrammableCustomRegistryV1(
            config,
            IProgrammableCustomPartnerFactoryRegistryV1(address(partnerFactoryRegistry)),
            ProgrammableCustomFeePolicyVerifierV1(address(feePolicyVerifier))
        )
    {
        if (config.registryGeneration != REQUIRED_REGISTRY_GENERATION) {
            revert GenerationTwoRequired(config.registryGeneration);
        }
    }
}
