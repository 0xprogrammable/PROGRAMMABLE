// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IDomainVaultV1, TransferObservationV1 } from "../interfaces/IDomainVaultV1.sol";
import { NativeIdentityV1 } from "./NativeIdentityV1.sol";
import { NativeETHProfileV1 } from "../profiles/NativeETHProfileV1.sol";
import { StrictMeasuredERC20ProfileV1 } from "../profiles/StrictMeasuredERC20ProfileV1.sol";

/// @notice Immutable physical custody boundary for one Domain Revision and native asset tuple.
contract DomainVaultV1 is IDomainVaultV1 {
    error OnlyCore(address caller);
    error InvalidCoreDeploymentId();
    error CoreDeploymentIdMismatch(bytes32 supplied, bytes32 derived);
    error InvalidDomainRevisionId();
    error UnsupportedAssetProfile(bytes32 assetProfileId);
    error NativeAssetProfileMismatch(bytes32 assetProfileId, address nativeAsset);
    error NativeAssetRuntimeChanged(address nativeAsset, bytes32 expectedCodeHash, bytes32 actualCodeHash);
    error NativeValueRejected();
    error CoreRecipientForbidden(address recipient);

    address public immutable CORE;
    bytes32 public immutable CORE_DEPLOYMENT_ID;
    bytes32 public immutable DOMAIN_REVISION_ID;
    bytes32 public immutable ASSET_PROFILE_ID;
    address public immutable NATIVE_ASSET;
    bytes32 public immutable NATIVE_ASSET_RUNTIME_CODE_HASH;
    bytes32 public immutable VAULT_ID;

    modifier onlyCore() {
        _checkOnlyCore();
        _;
    }

    constructor(
        bytes32 coreDeploymentId,
        bytes32 constitutionId,
        uint32 coreMajor,
        address collector,
        bytes32 domainRevisionId,
        bytes32 assetProfileId,
        address nativeAsset
    ) {
        if (coreDeploymentId == bytes32(0)) revert InvalidCoreDeploymentId();
        if (domainRevisionId == bytes32(0)) revert InvalidDomainRevisionId();

        bytes32 derivedCoreDeploymentId =
            NativeIdentityV1.coreDeploymentId(block.chainid, msg.sender, constitutionId, coreMajor, collector);
        if (derivedCoreDeploymentId != coreDeploymentId) {
            revert CoreDeploymentIdMismatch(coreDeploymentId, derivedCoreDeploymentId);
        }

        CORE = msg.sender;
        CORE_DEPLOYMENT_ID = coreDeploymentId;
        DOMAIN_REVISION_ID = domainRevisionId;
        ASSET_PROFILE_ID = assetProfileId;
        NATIVE_ASSET = nativeAsset;

        if (assetProfileId == NativeIdentityV1.NATIVE_ETH_ASSET_PROFILE_ID) {
            if (nativeAsset != address(0)) revert NativeAssetProfileMismatch(assetProfileId, nativeAsset);
        } else if (assetProfileId == NativeIdentityV1.STRICT_MEASURED_ERC20_ASSET_PROFILE_ID) {
            if (nativeAsset == address(0) || nativeAsset.code.length == 0) {
                revert NativeAssetProfileMismatch(assetProfileId, nativeAsset);
            }
            NATIVE_ASSET_RUNTIME_CODE_HASH = nativeAsset.codehash;
        } else {
            revert UnsupportedAssetProfile(assetProfileId);
        }

        VAULT_ID = NativeIdentityV1.vaultId(coreDeploymentId, domainRevisionId, assetProfileId, nativeAsset);
    }

    receive() external payable {
        if (ASSET_PROFILE_ID != NativeIdentityV1.NATIVE_ETH_ASSET_PROFILE_ID) revert NativeValueRejected();
    }

    function pullERC20Exact(address source, uint128 amount)
        external
        onlyCore
        returns (TransferObservationV1 memory observation)
    {
        _requireErc20ProfileAndRuntime();
        observation = StrictMeasuredERC20ProfileV1.pullExact(NATIVE_ASSET, source, amount);
    }

    function pushERC20Exact(address recipient, uint128 amount)
        external
        onlyCore
        returns (TransferObservationV1 memory observation)
    {
        if (recipient == CORE) revert CoreRecipientForbidden(recipient);
        _requireErc20ProfileAndRuntime();
        observation = StrictMeasuredERC20ProfileV1.pushExact(NATIVE_ASSET, recipient, amount);
    }

    function pushNativeExact(address payable recipient, uint128 amount)
        external
        onlyCore
        returns (TransferObservationV1 memory observation)
    {
        if (ASSET_PROFILE_ID != NativeIdentityV1.NATIVE_ETH_ASSET_PROFILE_ID) {
            revert UnsupportedAssetProfile(ASSET_PROFILE_ID);
        }
        if (recipient == CORE) revert CoreRecipientForbidden(recipient);
        observation = NativeETHProfileV1.pushExact(recipient, amount);
    }

    function _checkOnlyCore() private view {
        if (msg.sender != CORE) revert OnlyCore(msg.sender);
    }

    function _requireErc20ProfileAndRuntime() private view {
        if (ASSET_PROFILE_ID != NativeIdentityV1.STRICT_MEASURED_ERC20_ASSET_PROFILE_ID) {
            revert UnsupportedAssetProfile(ASSET_PROFILE_ID);
        }
        bytes32 currentCodeHash = NATIVE_ASSET.codehash;
        if (currentCodeHash != NATIVE_ASSET_RUNTIME_CODE_HASH) {
            revert NativeAssetRuntimeChanged(NATIVE_ASSET, NATIVE_ASSET_RUNTIME_CODE_HASH, currentCodeHash);
        }
    }
}
