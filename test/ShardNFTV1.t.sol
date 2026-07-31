// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { Base64 } from "solady/utils/Base64.sol";
import { LibString } from "solady/utils/LibString.sol";
import { IERC721Errors } from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

import { ShardNFTV1 } from "../src/ShardNFTV1.sol";
import { ShardErrorsV1 } from "../src/ShardErrorsV1.sol";
import { IShardHookV1 } from "../src/interfaces/IShardHookV1.sol";
import { IShardRendererV1 } from "../src/interfaces/IShardRendererV1.sol";

/// @dev Records every settleOnTransfer call so tests can assert exactly when
///      fee settlement fires (wallet moves) and when it must not (archive moves).
contract MockHook is IShardHookV1 {
    uint256 public settleCount;
    uint256 public lastTokenId;
    address public lastFrom;
    address public lastTo;

    function settleOnTransfer(uint256 tokenId, address from, address to) external override {
        settleCount += 1;
        lastTokenId = tokenId;
        lastFrom = from;
        lastTo = to;
    }

    function claimable(address) external pure override returns (uint256) {
        return 0;
    }
}

contract MockRenderer is IShardRendererV1 {
    using LibString for uint256;

    function generate(uint256 seed) external pure override returns (string memory) {
        return string.concat("<svg>LIVE:", seed.toString(), "</svg>");
    }

    function generateDormant(uint256 tokenId) external pure override returns (string memory) {
        return string.concat("<svg>DORMANT:", tokenId.toString(), "</svg>");
    }

    function attributes(uint256 seed) external pure override returns (string memory) {
        return string.concat('[{"trait_type":"Seed","value":"', seed.toString(), '"}]');
    }
}

/// @dev Flags whether onERC721Received fired. acquire() must NEVER trigger it:
///      the receiver callback under `_releasing == true` is the reentrancy hole
///      this whole design forbids.
contract RecordingReceiver {
    bool public callbackFired;

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        callbackFired = true;
        return this.onERC721Received.selector;
    }
}

contract ShardNFTV1Test is Test {
    using LibString for uint256;

    ShardNFTV1 internal nft;
    MockHook internal hook;
    MockRenderer internal renderer;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    function setUp() public {
        hook = new MockHook();
        renderer = new MockRenderer();
        nft = new ShardNFTV1(address(hook), address(renderer));
    }

    function _acquire(address to, uint256 seed) internal returns (uint256 id) {
        vm.prank(address(hook));
        id = nft.acquire(to, seed);
    }

    function _release(address from, uint256 tokenId) internal {
        vm.prank(address(hook));
        nft.release(from, tokenId);
    }

    // ------------------------------------------------------------------
    // Supply / ID allocation
    // ------------------------------------------------------------------

    function test_maxSupplyIsTenThousand() public view {
        assertEq(nft.MAX_SUPPLY(), 10_000);
    }

    function test_acquireHandsOutLowestAvailableId() public {
        assertEq(nft.lowestAvailableId(), 1);
        assertEq(_acquire(alice, 111), 1);
        assertEq(nft.lowestAvailableId(), 2);
        assertEq(_acquire(bob, 222), 2);
        assertEq(nft.lowestAvailableId(), 3);
    }

    function test_acquireMintsLazily() public {
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, uint256(1)));
        nft.ownerOf(1);

        _acquire(alice, 111);
        assertEq(nft.ownerOf(1), alice);
    }

    function test_releaseReturnsIdToArchiveAndZeroesSeed() public {
        uint256 id = _acquire(alice, 12_345);
        assertEq(nft.tokenSeed(id), 12_345);
        assertFalse(nft.isPoolHeld(id));

        _release(alice, id);

        assertEq(nft.ownerOf(id), address(nft));
        assertEq(nft.tokenSeed(id), 0);
        assertTrue(nft.isPoolHeld(id));
    }

    function test_releasedIdIsHandedOutAgain() public {
        _acquire(alice, 1);
        _acquire(bob, 2);
        assertEq(nft.lowestAvailableId(), 3);

        _release(alice, 1);
        assertEq(nft.lowestAvailableId(), 1);

        assertEq(_acquire(bob, 3), 1);
        assertEq(nft.lowestAvailableId(), 3);
    }

    function test_acquireAlwaysWritesFreshSeed() public {
        uint256 id = _acquire(alice, 777);
        assertEq(nft.tokenSeed(id), 777);

        _release(alice, id);
        assertEq(nft.tokenSeed(id), 0);

        uint256 again = _acquire(bob, 999);
        assertEq(again, id);
        assertEq(nft.tokenSeed(id), 999);
    }

    // ------------------------------------------------------------------
    // The critical rule: art survives wallet-to-wallet trading
    // ------------------------------------------------------------------

    function test_walletTransferDoesNotChangeSeed() public {
        uint256 id = _acquire(alice, 424_242);

        vm.prank(alice);
        nft.transferFrom(alice, bob, id);

        assertEq(nft.ownerOf(id), bob);
        assertEq(nft.tokenSeed(id), 424_242, "secondary trade must not regenerate the art");
    }

    function test_walletTransferCallsSettleOnHook() public {
        uint256 id = _acquire(alice, 5);
        uint256 before = hook.settleCount();

        vm.prank(alice);
        nft.transferFrom(alice, bob, id);

        assertEq(hook.settleCount(), before + 1);
        assertEq(hook.lastTokenId(), id);
        assertEq(hook.lastFrom(), alice);
        assertEq(hook.lastTo(), bob);
    }

    function test_archiveMoveDoesNotCallSettle() public {
        uint256 id = _acquire(alice, 5);
        assertEq(hook.settleCount(), 0, "mint must not settle");

        _release(alice, id);
        assertEq(hook.settleCount(), 0, "release into archive must not settle");

        _acquire(bob, 6);
        assertEq(hook.settleCount(), 0, "acquire out of archive must not settle");
    }

    // ------------------------------------------------------------------
    // Direct deposit guard
    // ------------------------------------------------------------------

    function test_directTransferFromToArchiveReverts() public {
        uint256 id = _acquire(alice, 5);

        vm.prank(alice);
        vm.expectRevert(ShardErrorsV1.DirectTransferRejected.selector);
        nft.transferFrom(alice, address(nft), id);
    }

    function test_directTransferFromToHookReverts() public {
        uint256 id = _acquire(alice, 5);

        vm.prank(alice);
        vm.expectRevert(ShardErrorsV1.DirectTransferRejected.selector);
        nft.transferFrom(alice, address(hook), id);
    }

    // ------------------------------------------------------------------
    // Metadata
    // ------------------------------------------------------------------

    function test_tokenUriIsBase64DataUri() public {
        uint256 id = _acquire(alice, 31_337);
        string memory uri = nft.tokenURI(id);

        string memory expected = string.concat(
            "data:application/json;base64,",
            Base64.encode(
                bytes(
                    string.concat(
                        '{"name":"Shard #',
                        id.toString(),
                        '","description":"On-chain art that exists only while you hold it. ',
                        'Sell it back and this piece is gone forever.","image":"data:image/svg+xml;base64,',
                        Base64.encode(bytes(renderer.generate(31_337))),
                        '","attributes":',
                        renderer.attributes(31_337),
                        "}"
                    )
                )
            )
        );

        assertEq(uri, expected);
        assertTrue(LibString.startsWith(uri, "data:application/json;base64,"));
    }

    function test_poolHeldIdRendersDormant() public view {
        assertTrue(nft.isPoolHeld(5));
        string memory uri = nft.tokenURI(5);

        string memory expected = string.concat(
            "data:application/json;base64,",
            Base64.encode(
                bytes(
                    string.concat(
                        '{"name":"Shard #5","description":"On-chain art that exists only while you hold it. ',
                        'Sell it back and this piece is gone forever.","image":"data:image/svg+xml;base64,',
                        Base64.encode(bytes(renderer.generateDormant(5))),
                        '","attributes":[{"trait_type":"State","value":"Dormant"}]}'
                    )
                )
            )
        );

        assertEq(uri, expected);
    }

    function test_outOfRangeTokenUriReverts() public {
        vm.expectRevert(abi.encodeWithSelector(ShardErrorsV1.TokenDoesNotExist.selector, uint256(0)));
        nft.tokenURI(0);

        vm.expectRevert(abi.encodeWithSelector(ShardErrorsV1.TokenDoesNotExist.selector, uint256(10_001)));
        nft.tokenURI(10_001);
    }

    // ------------------------------------------------------------------
    // Access control / accounting
    // ------------------------------------------------------------------

    function test_onlyHookCanAcquire() public {
        vm.prank(alice);
        vm.expectRevert(ShardErrorsV1.NotHook.selector);
        nft.acquire(alice, 1);
    }

    function test_onlyHookCanRelease() public {
        uint256 id = _acquire(alice, 1);

        vm.prank(alice);
        vm.expectRevert(ShardErrorsV1.NotHook.selector);
        nft.release(alice, id);
    }

    function test_circulatingSupplyTracksAcquireAndRelease() public {
        assertEq(nft.circulatingSupply(), 0);

        uint256 a = _acquire(alice, 1);
        assertEq(nft.circulatingSupply(), 1);

        uint256 b = _acquire(bob, 2);
        assertEq(nft.circulatingSupply(), 2);

        _release(alice, a);
        assertEq(nft.circulatingSupply(), 1);

        _release(bob, b);
        assertEq(nft.circulatingSupply(), 0);
    }

    // ------------------------------------------------------------------
    // Regression: the hard rule
    // ------------------------------------------------------------------

    function test_acquireUsesUnsafeMintOnly() public {
        RecordingReceiver receiver = new RecordingReceiver();

        // Lazy mint path.
        uint256 id = _acquire(address(receiver), 1);
        assertEq(nft.ownerOf(id), address(receiver));
        assertFalse(receiver.callbackFired(), "acquire must use _mint, never _safeMint");

        // Archive transfer path.
        _release(address(receiver), id);
        uint256 again = _acquire(address(receiver), 2);
        assertEq(again, id);
        assertEq(nft.ownerOf(id), address(receiver));
        assertFalse(receiver.callbackFired(), "acquire must use _transfer, never _safeTransfer");
    }

    // ------------------------------------------------------------------
    // Fuzz
    // ------------------------------------------------------------------

    function testFuzz_lowestAvailableIdIsAlwaysUnheld(uint8 acquireCount, uint256 releaseMask) public {
        uint256 n = bound(uint256(acquireCount), 1, 16);

        uint256[] memory ids = new uint256[](n);
        for (uint256 i; i < n; i++) {
            ids[i] = _acquire(alice, i + 1);
        }
        for (uint256 i; i < n; i++) {
            if ((releaseMask >> i) & 1 == 1) {
                _release(alice, ids[i]);
            }
        }

        uint256 low = nft.lowestAvailableId();
        assertTrue(low >= 1 && low <= 10_000);
        assertTrue(nft.isPoolHeld(low), "lowestAvailableId must be in the archive");
        for (uint256 id = 1; id < low; id++) {
            assertFalse(nft.isPoolHeld(id), "no archived id may sit below lowestAvailableId");
        }
    }
}
