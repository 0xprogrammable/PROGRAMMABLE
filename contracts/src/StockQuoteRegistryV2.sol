// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { IBeacon } from "@openzeppelin/contracts/proxy/beacon/IBeacon.sol";

interface IOndoGMTokenManagerV2 {
    function gmTokenAccepted(address token) external view returns (bool);
}

/// @title StockQuoteRegistryV2
/// @notice Ownerless, immutable launch allowlist for eleven route-reviewed Ondo quote assets.
/// @dev New launches fail closed if the token, Ondo manager, beacon or implementation runtime changes.
///      Existing pools remain subject to Ondo's token controls and are not frozen by this registry.
contract StockQuoteRegistryV2 {
    uint256 public constant REQUIRED_ASSET_COUNT = 11;
    uint8 public constant REQUIRED_DECIMALS = 18;

    address public immutable beacon;
    address public immutable reviewedImplementation;
    IOndoGMTokenManagerV2 public immutable gmTokenManager;
    bytes32 public immutable expectedTokenCodeHash;
    bytes32 public immutable expectedBeaconCodeHash;
    bytes32 public immutable expectedImplementationCodeHash;
    bytes32 public immutable expectedGMTokenManagerCodeHash;
    bytes32 public immutable configurationHash;

    address[] private _assets;
    mapping(address asset => uint256 indexPlusOne) private _assetIndexPlusOne;
    mapping(address asset => bytes32 symbolHash) public expectedSymbolHash;

    error DuplicateAsset(address asset);
    error InvalidAsset(address asset);
    error InvalidAssetCount(uint256 actual, uint256 expected);
    error InvalidBeacon(address actual, address expected);
    error InvalidCodeHash(address target, bytes32 actual, bytes32 expected);
    error InvalidDecimals(address asset, uint8 actual, uint8 expected);
    error InvalidImplementation(address actual, address expected);
    error InvalidSymbol(address asset, bytes32 actual, bytes32 expected);
    error InvalidSymbolCount(uint256 actual, uint256 expected);
    error TokenNotAcceptedByIssuer(address asset);
    error UnsupportedQuoteAsset(address asset);
    error ZeroAddress();
    error ZeroCodeHash();

    event StockQuoteRegistryConfigured(
        bytes32 indexed configurationHash, address indexed beacon, address implementation, address gmTokenManager
    );
    event StockQuoteAssetAccepted(address indexed asset, bytes32 indexed symbolHash, uint256 indexed index);

    constructor(
        address[] memory assets_,
        bytes32[] memory symbolHashes_,
        address beacon_,
        address reviewedImplementation_,
        address gmTokenManager_,
        bytes32 expectedTokenCodeHash_,
        bytes32 expectedBeaconCodeHash_,
        bytes32 expectedImplementationCodeHash_,
        bytes32 expectedGMTokenManagerCodeHash_
    ) {
        if (assets_.length != REQUIRED_ASSET_COUNT) {
            revert InvalidAssetCount(assets_.length, REQUIRED_ASSET_COUNT);
        }
        if (symbolHashes_.length != assets_.length) {
            revert InvalidSymbolCount(symbolHashes_.length, assets_.length);
        }
        if (beacon_ == address(0) || reviewedImplementation_ == address(0) || gmTokenManager_ == address(0)) {
            revert ZeroAddress();
        }
        if (
            expectedTokenCodeHash_ == bytes32(0) || expectedBeaconCodeHash_ == bytes32(0)
                || expectedImplementationCodeHash_ == bytes32(0) || expectedGMTokenManagerCodeHash_ == bytes32(0)
        ) {
            revert ZeroCodeHash();
        }

        beacon = beacon_;
        reviewedImplementation = reviewedImplementation_;
        gmTokenManager = IOndoGMTokenManagerV2(gmTokenManager_);
        expectedTokenCodeHash = expectedTokenCodeHash_;
        expectedBeaconCodeHash = expectedBeaconCodeHash_;
        expectedImplementationCodeHash = expectedImplementationCodeHash_;
        expectedGMTokenManagerCodeHash = expectedGMTokenManagerCodeHash_;

        _assertSharedRuntimeReady();
        for (uint256 index; index < assets_.length; index++) {
            address asset = assets_[index];
            bytes32 symbolHash = symbolHashes_[index];
            if (asset == address(0)) revert InvalidAsset(asset);
            if (_assetIndexPlusOne[asset] != 0) revert DuplicateAsset(asset);
            if (symbolHash == bytes32(0)) revert InvalidSymbol(asset, bytes32(0), symbolHash);

            _assetIndexPlusOne[asset] = index + 1;
            expectedSymbolHash[asset] = symbolHash;
            _assets.push(asset);
            _assertTokenRuntimeReady(asset, symbolHash);
            emit StockQuoteAssetAccepted(asset, symbolHash, index);
        }

        configurationHash = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                assets_,
                symbolHashes_,
                beacon_,
                reviewedImplementation_,
                gmTokenManager_,
                expectedTokenCodeHash_,
                expectedBeaconCodeHash_,
                expectedImplementationCodeHash_,
                expectedGMTokenManagerCodeHash_
            )
        );
        emit StockQuoteRegistryConfigured(configurationHash, beacon_, reviewedImplementation_, gmTokenManager_);
    }

    function assetCount() external pure returns (uint256) {
        return REQUIRED_ASSET_COUNT;
    }

    function assetAt(uint256 index) external view returns (address) {
        return _assets[index];
    }

    function isSupported(address asset) public view returns (bool) {
        return _assetIndexPlusOne[asset] != 0;
    }

    /// @notice Revalidates the reviewed issuer and token runtimes before a new launch.
    function assertAssetReady(address asset) external view returns (bytes32 assetConfigurationHash) {
        if (!isSupported(asset)) revert UnsupportedQuoteAsset(asset);
        _assertSharedRuntimeReady();
        bytes32 symbolHash = expectedSymbolHash[asset];
        _assertTokenRuntimeReady(asset, symbolHash);
        assetConfigurationHash = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                asset,
                symbolHash,
                expectedTokenCodeHash,
                beacon,
                expectedBeaconCodeHash,
                reviewedImplementation,
                expectedImplementationCodeHash,
                gmTokenManager,
                expectedGMTokenManagerCodeHash
            )
        );
    }

    function _assertSharedRuntimeReady() private view {
        bytes32 managerCodeHash = address(gmTokenManager).codehash;
        if (managerCodeHash != expectedGMTokenManagerCodeHash) {
            revert InvalidCodeHash(address(gmTokenManager), managerCodeHash, expectedGMTokenManagerCodeHash);
        }

        bytes32 beaconCodeHash = beacon.codehash;
        if (beaconCodeHash != expectedBeaconCodeHash) {
            revert InvalidCodeHash(beacon, beaconCodeHash, expectedBeaconCodeHash);
        }

        address implementation = IBeacon(beacon).implementation();
        if (implementation != reviewedImplementation) {
            revert InvalidImplementation(implementation, reviewedImplementation);
        }
        bytes32 implementationCodeHash = implementation.codehash;
        if (implementationCodeHash != expectedImplementationCodeHash) {
            revert InvalidCodeHash(reviewedImplementation, implementationCodeHash, expectedImplementationCodeHash);
        }
    }

    function _assertTokenRuntimeReady(address asset, bytes32 symbolHash) private view {
        if (!gmTokenManager.gmTokenAccepted(asset)) {
            revert TokenNotAcceptedByIssuer(asset);
        }

        bytes32 tokenCodeHash = asset.codehash;
        if (tokenCodeHash != expectedTokenCodeHash) {
            revert InvalidCodeHash(asset, tokenCodeHash, expectedTokenCodeHash);
        }

        uint8 decimals = IERC20Metadata(asset).decimals();
        if (decimals != REQUIRED_DECIMALS) {
            revert InvalidDecimals(asset, decimals, REQUIRED_DECIMALS);
        }
        bytes32 actualSymbolHash = keccak256(bytes(IERC20Metadata(asset).symbol()));
        if (actualSymbolHash != symbolHash) {
            revert InvalidSymbol(asset, actualSymbolHash, symbolHash);
        }
    }
}
