// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    DomainRevisionDescriptorV1,
    EngineRevisionDescriptorV1,
    MarketDescriptorV1,
    NativeIdentityV1
} from "../../src/core/NativeIdentityV1.sol";

contract IdentityHarness {
    function coreDeploymentId(
        uint256 chainId,
        address core,
        bytes32 constitutionId,
        uint32 coreMajor,
        address collector
    ) external pure returns (bytes32) {
        return NativeIdentityV1.coreDeploymentId(chainId, core, constitutionId, coreMajor, collector);
    }

    function engineRevisionId(EngineRevisionDescriptorV1 calldata descriptor) external pure returns (bytes32) {
        return NativeIdentityV1.engineRevisionId(descriptor);
    }

    function marketId(bytes32 coreDeploymentId_, MarketDescriptorV1 calldata descriptor)
        external
        pure
        returns (bytes32)
    {
        return NativeIdentityV1.marketId(coreDeploymentId_, descriptor);
    }

    function domainRevisionId(bytes32 coreDeploymentId_, DomainRevisionDescriptorV1 calldata descriptor)
        external
        pure
        returns (bytes32)
    {
        return NativeIdentityV1.domainRevisionId(coreDeploymentId_, descriptor);
    }

    function vaultId(bytes32 coreDeploymentId_, bytes32 domainRevisionId_, bytes32 assetProfileId, address nativeAsset)
        external
        pure
        returns (bytes32)
    {
        return NativeIdentityV1.vaultId(coreDeploymentId_, domainRevisionId_, assetProfileId, nativeAsset);
    }
}
