// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { Base64 } from "solady/utils/Base64.sol";
import { LibString } from "solady/utils/LibString.sol";

import { IShardNFTV1 } from "./interfaces/IShardNFTV1.sol";
import { IShardHookV1 } from "./interfaces/IShardHookV1.sol";
import { IShardRendererV1 } from "./interfaces/IShardRendererV1.sol";
import { ShardErrorsV1 } from "./ShardErrorsV1.sol";
import { ShardConstantsV1 } from "./ShardConstantsV1.sol";

/// @title ShardNFTV1
/// @notice A fixed 10,000-piece collection market-made by a Uniswap v4 hook.
///         Tokens live either with users or in this contract's own "archive"
///         (the pool inventory). Art is regenerated on every acquisition from
///         the archive and destroyed on the way back in — the art exists only
///         while you hold it.
contract ShardNFTV1 is ERC721, IShardNFTV1 {
    using LibString for uint256;

    uint256 public constant override MAX_SUPPLY = ShardConstantsV1.MAX_NFTS;

    address public immutable override hook;
    IShardRendererV1 public immutable renderer;

    /// @dev Bit index == tokenId - 1. Token IDs are 1..10_000, so bit indices
    ///      are 0..9_999 => words 0..39 (ceil(10000/256) == 40). A set bit
    ///      means "in the archive" (available to be handed out).
    ///      Word 39 covers bit indices 9_984..10_239; indices 10_000..10_239
    ///      correspond to non-existent token IDs 10_001..10_240 and are left
    ///      permanently set. That is deliberate: it makes `_advanceLowest`
    ///      terminate at 10_001 rather than scanning forever, and the
    ///      `tokenId > MAX_SUPPLY` check in `acquire` then raises PoolExhausted.
    mapping(uint256 => uint256) private _heldBits;

    mapping(uint256 => uint256) public override tokenSeed;

    uint256 private _lowestAvailable = 1;
    uint256 private _circulating;

    /// @dev Set only for the duration of an archive-side move inside
    ///      `acquire` / `release`, to bypass the direct-deposit guard in
    ///      `_update`. Safe ONLY because no external call can occur while set.
    bool private _releasing;

    modifier onlyHook() {
        if (msg.sender != hook) revert ShardErrorsV1.NotHook();
        _;
    }

    constructor(address hook_, address renderer_) ERC721("Shards", "SHARDS") {
        if (hook_ == address(0) || renderer_ == address(0)) revert ShardErrorsV1.ZeroAddress();
        hook = hook_;
        renderer = IShardRendererV1(renderer_);
        // Every ID starts in the archive.
        for (uint256 w = 0; w < 40; w++) {
            _heldBits[w] = type(uint256).max;
        }
    }

    // -------------------------------------------------------------------
    // Hook-driven inventory moves
    // -------------------------------------------------------------------

    /// @notice Hand the lowest archived ID to `to` and generate fresh art for it.
    /// @dev The seed is supplied by the caller — this contract produces no
    ///      entropy of its own and is fully deterministic.
    function acquire(address to, uint256 seed) external override onlyHook returns (uint256 tokenId) {
        tokenId = _lowestAvailable;
        if (tokenId == 0 || tokenId > MAX_SUPPLY) revert ShardErrorsV1.PoolExhausted();

        _markHeld(tokenId, false);
        tokenSeed[tokenId] = seed; // always fresh — this IS the art regeneration
        _circulating += 1;

        _releasing = true; // archive-side move; bypass the deposit guard in _update

        // HARD RULE: _mint / _transfer, NEVER _safeMint / _safeTransfer.
        //
        // `_releasing` is only safe because NO external call can occur while it
        // is set, and this contract has no reentrancy guard. A safe variant
        // fires the receiver's onERC721Received callback while _releasing ==
        // true; the receiver could then re-enter transferFrom(attacker,
        // address(this), otherTokenId) directly on this NFT — outside the
        // hook's nonReentrant scope. That token would land in the archive
        // without _markHeld, without `_circulating -= 1`, and without the
        // hook's accounting, permanently breaking the core invariant
        // (shard.balanceOf(hook) == circulatingSupply() * 1e18) on a contract
        // with no upgrade path. Do not "improve" these to the safe variants.
        if (_ownerOf(tokenId) == address(0)) {
            _mint(to, tokenId); // NEVER _safeMint
        } else {
            _transfer(address(this), to, tokenId); // NEVER _safeTransfer
        }

        _releasing = false;

        _advanceLowest();
    }

    /// @notice Return `tokenId` to the archive and destroy its art.
    function release(address from, uint256 tokenId) external override onlyHook {
        _releasing = true; // archive-side move; bypass the deposit guard in _update

        // HARD RULE: _transfer, NEVER _safeTransfer. See the comment in
        // `acquire` — with `_releasing` set and no reentrancy guard, a receiver
        // callback here would let the receiver re-enter transferFrom into the
        // archive outside the hook's nonReentrant scope, stranding an ID and
        // corrupting circulating-supply accounting irreversibly.
        _transfer(from, address(this), tokenId); // NEVER _safeTransfer

        _releasing = false;

        tokenSeed[tokenId] = 0; // the art is destroyed
        _markHeld(tokenId, true);
        _circulating -= 1;
        if (tokenId < _lowestAvailable) _lowestAvailable = tokenId;
    }

    // -------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------

    function lowestAvailableId() external view override returns (uint256) {
        return _lowestAvailable;
    }

    /// @notice True when `tokenId` currently sits in the archive (pool inventory).
    function isPoolHeld(uint256 tokenId) public view override returns (bool) {
        if (tokenId == 0 || tokenId > MAX_SUPPLY) return false;
        uint256 idx = tokenId - 1; // bit index == tokenId - 1
        return (_heldBits[idx >> 8] >> (idx & 255)) & 1 == 1;
    }

    function circulatingSupply() external view override returns (uint256) {
        return _circulating;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        if (tokenId == 0 || tokenId > MAX_SUPPLY) revert ShardErrorsV1.TokenDoesNotExist(tokenId);
        bool dormant = isPoolHeld(tokenId);
        string memory svg = dormant ? renderer.generateDormant(tokenId) : renderer.generate(tokenSeed[tokenId]);
        string memory json = string.concat(
            '{"name":"Shard #',
            tokenId.toString(),
            '","description":"On-chain art that exists only while you hold it. ',
            'Sell it back and this piece is gone forever.","image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(svg)),
            '","attributes":',
            dormant ? '[{"trait_type":"State","value":"Dormant"}]' : renderer.attributes(tokenSeed[tokenId]),
            "}"
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    // -------------------------------------------------------------------
    // Internals
    // -------------------------------------------------------------------

    /// @dev The single choke point for every ownership move. Note it does NOT
    ///      touch `tokenSeed`: art regenerates ONLY on acquisition from the
    ///      archive, never on a wallet-to-wallet transfer. If it regenerated
    ///      here, every secondary purchase would be a blind lottery and
    ///      secondary trading would die.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        // Reject direct deposits. transferFrom does NOT call onERC721Received, so
        // guarding there alone leaves a hole that permanently strands an ID.
        if (!_releasing && (to == address(this) || to == hook)) revert ShardErrorsV1.DirectTransferRejected();

        from = super._update(to, tokenId, auth);

        // Settle fees to the outgoing owner — but NOT for mints, and NOT when the
        // archive is either side. Archive-side moves are accounted by the hook's
        // _acquireAccounting / _releaseAccounting; settling here would credit
        // address(this), which cannot claim, stranding ETH forever.
        if (from != address(0) && from != address(this) && to != address(this)) {
            IShardHookV1(hook).settleOnTransfer(tokenId, from, to);
        }
    }

    /// @dev bit index == tokenId - 1; word = idx >> 8, position = idx & 255.
    function _markHeld(uint256 tokenId, bool held) private {
        uint256 idx = tokenId - 1;
        uint256 word = idx >> 8;
        uint256 mask = 1 << (idx & 255);
        if (held) {
            _heldBits[word] |= mask;
        } else {
            _heldBits[word] &= ~mask;
        }
    }

    /// @dev Scan forward from `_lowestAvailable` for the next set (archived) bit.
    ///      Terminates because word 39's padding bits (indices 10_000..10_239)
    ///      are permanently set: a fully drained pool resolves to 10_001, which
    ///      `acquire` then rejects with PoolExhausted.
    function _advanceLowest() private {
        uint256 idx = _lowestAvailable - 1; // bit index == tokenId - 1
        uint256 word = idx >> 8;
        uint256 masked = _heldBits[word] & (type(uint256).max << (idx & 255));

        while (masked == 0) {
            unchecked {
                word += 1;
            }
            if (word > 39) {
                _lowestAvailable = MAX_SUPPLY + 1;
                return;
            }
            masked = _heldBits[word];
        }

        _lowestAvailable = (word << 8) + _ctz(masked) + 1;
    }

    /// @dev Count trailing zeros. `x` must be non-zero.
    function _ctz(uint256 x) private pure returns (uint256 r) {
        x = x & (~x + 1); // isolate the lowest set bit
        if (x >> 128 != 0) {
            r += 128;
            x >>= 128;
        }
        if (x >> 64 != 0) {
            r += 64;
            x >>= 64;
        }
        if (x >> 32 != 0) {
            r += 32;
            x >>= 32;
        }
        if (x >> 16 != 0) {
            r += 16;
            x >>= 16;
        }
        if (x >> 8 != 0) {
            r += 8;
            x >>= 8;
        }
        if (x >> 4 != 0) {
            r += 4;
            x >>= 4;
        }
        if (x >> 2 != 0) {
            r += 2;
            x >>= 2;
        }
        if (x >> 1 != 0) {
            r += 1;
        }
    }
}
