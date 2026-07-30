// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IBeacon } from "@openzeppelin/contracts/proxy/beacon/IBeacon.sol";
import { Test } from "forge-std/Test.sol";

import { StockQuoteRegistryV2 } from "../src/StockQuoteRegistryV2.sol";

contract StockQuoteRegistryV2Token is ERC20 {
    constructor(string memory symbol_) ERC20(symbol_, symbol_) { }
}

contract StockQuoteRegistryV2Implementation { }

contract StockQuoteRegistryV2Beacon is IBeacon {
    address private immutable _implementation;

    constructor(address implementation_) {
        _implementation = implementation_;
    }

    function implementation() external view returns (address) {
        return _implementation;
    }
}

contract StockQuoteRegistryV2Manager {
    mapping(address token => bool accepted) public gmTokenAccepted;

    function setAccepted(address token, bool accepted) external {
        gmTokenAccepted[token] = accepted;
    }
}

contract StockQuoteRegistryV2Test is Test {
    string[11] internal symbols =
        ["NVDAon", "SPYon", "GOOGLon", "SLVon", "TSLAon", "AAPLon", "BABAon", "COPXon", "CRCLon", "TLTon", "USOon"];

    StockQuoteRegistryV2Token[11] internal tokens;
    StockQuoteRegistryV2Manager internal manager;
    StockQuoteRegistryV2Beacon internal beacon;
    StockQuoteRegistryV2Implementation internal implementation;
    StockQuoteRegistryV2 internal registry;

    function setUp() public {
        manager = new StockQuoteRegistryV2Manager();
        implementation = new StockQuoteRegistryV2Implementation();
        beacon = new StockQuoteRegistryV2Beacon(address(implementation));

        for (uint256 index; index < symbols.length; index++) {
            tokens[index] = new StockQuoteRegistryV2Token(symbols[index]);
            manager.setAccepted(address(tokens[index]), true);
        }

        registry = _deploy(_assets(), _symbolHashes());
    }

    function test_registryPinsExactlyElevenIssuerAcceptedAssets() public view {
        assertEq(registry.assetCount(), 11);
        assertEq(address(registry.gmTokenManager()), address(manager));
        for (uint256 index; index < tokens.length; index++) {
            address asset = address(tokens[index]);
            assertEq(registry.assetAt(index), asset);
            assertTrue(registry.isSupported(asset));
            assertTrue(registry.assertAssetReady(asset) != bytes32(0));
        }
    }

    function test_assetFailsClosedWhenIssuerAcceptanceIsRevoked() public {
        address asset = address(tokens[6]);
        manager.setAccepted(asset, false);
        vm.expectRevert(abi.encodeWithSelector(StockQuoteRegistryV2.TokenNotAcceptedByIssuer.selector, asset));
        registry.assertAssetReady(asset);
    }

    function test_assetFailsClosedWhenTokenRuntimeDrifts() public {
        address asset = address(tokens[2]);
        bytes32 expected = registry.expectedTokenCodeHash();
        vm.etch(asset, hex"00");
        vm.expectRevert(
            abi.encodeWithSelector(StockQuoteRegistryV2.InvalidCodeHash.selector, asset, asset.codehash, expected)
        );
        registry.assertAssetReady(asset);
    }

    function test_registryFailsClosedWhenManagerRuntimeDrifts() public {
        bytes32 expected = registry.expectedGMTokenManagerCodeHash();
        vm.etch(address(manager), hex"00");
        vm.expectRevert(
            abi.encodeWithSelector(
                StockQuoteRegistryV2.InvalidCodeHash.selector, address(manager), address(manager).codehash, expected
            )
        );
        registry.assertAssetReady(address(tokens[0]));
    }

    function test_constructorRejectsWrongCountDuplicateAndUnacceptedAsset() public {
        address[] memory tooFew = new address[](10);
        bytes32[] memory tooFewSymbols = new bytes32[](10);
        for (uint256 index; index < tooFew.length; index++) {
            tooFew[index] = address(tokens[index]);
            tooFewSymbols[index] = keccak256(bytes(symbols[index]));
        }
        vm.expectRevert(
            abi.encodeWithSelector(StockQuoteRegistryV2.InvalidAssetCount.selector, uint256(10), uint256(11))
        );
        _deploy(tooFew, tooFewSymbols);

        address[] memory assets = _assets();
        bytes32[] memory hashes = _symbolHashes();
        assets[10] = assets[0];
        hashes[10] = hashes[0];
        vm.expectRevert(abi.encodeWithSelector(StockQuoteRegistryV2.DuplicateAsset.selector, assets[10]));
        _deploy(assets, hashes);

        assets = _assets();
        manager.setAccepted(assets[10], false);
        vm.expectRevert(abi.encodeWithSelector(StockQuoteRegistryV2.TokenNotAcceptedByIssuer.selector, assets[10]));
        _deploy(assets, _symbolHashes());
    }

    function _deploy(address[] memory assets, bytes32[] memory hashes) private returns (StockQuoteRegistryV2 deployed) {
        deployed = new StockQuoteRegistryV2(
            assets,
            hashes,
            address(beacon),
            address(implementation),
            address(manager),
            address(tokens[0]).codehash,
            address(beacon).codehash,
            address(implementation).codehash,
            address(manager).codehash
        );
    }

    function _assets() private view returns (address[] memory values) {
        values = new address[](tokens.length);
        for (uint256 index; index < tokens.length; index++) {
            values[index] = address(tokens[index]);
        }
    }

    function _symbolHashes() private view returns (bytes32[] memory values) {
        values = new bytes32[](symbols.length);
        for (uint256 index; index < symbols.length; index++) {
            values[index] = keccak256(bytes(symbols[index]));
        }
    }
}
