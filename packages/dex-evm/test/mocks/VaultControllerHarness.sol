// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { DomainVaultV1 } from "../../src/core/DomainVaultV1.sol";
import { NativeIdentityV1 } from "../../src/core/NativeIdentityV1.sol";
import { TransferObservationV1 } from "../../src/interfaces/IDomainVaultV1.sol";

contract VaultControllerHarness {
    bytes32 internal constant TEST_CONSTITUTION_ID = keccak256("vault controller constitution");
    uint32 internal constant TEST_CORE_MAJOR = 1;
    address internal constant TEST_COLLECTOR = address(0xC011EC70);

    receive() external payable { }

    function coreDeploymentId() public view returns (bytes32) {
        return NativeIdentityV1.coreDeploymentId(
            block.chainid, address(this), TEST_CONSTITUTION_ID, TEST_CORE_MAJOR, TEST_COLLECTOR
        );
    }

    function deployVault(
        bytes32 salt,
        bytes32 expectedCoreDeploymentId,
        bytes32 domainRevisionId,
        bytes32 assetProfileId,
        address nativeAsset
    ) external returns (DomainVaultV1 vault) {
        vault = new DomainVaultV1{ salt: salt }(
            expectedCoreDeploymentId,
            TEST_CONSTITUTION_ID,
            TEST_CORE_MAJOR,
            TEST_COLLECTOR,
            domainRevisionId,
            assetProfileId,
            nativeAsset
        );
    }

    function pullERC20(DomainVaultV1 vault, address source, uint128 amount)
        external
        returns (TransferObservationV1 memory)
    {
        return vault.pullERC20Exact(source, amount);
    }

    function pushERC20(DomainVaultV1 vault, address recipient, uint128 amount)
        external
        returns (TransferObservationV1 memory)
    {
        return vault.pushERC20Exact(recipient, amount);
    }

    function pushNative(DomainVaultV1 vault, address payable recipient, uint128 amount)
        external
        returns (TransferObservationV1 memory)
    {
        return vault.pushNativeExact(recipient, amount);
    }
}
