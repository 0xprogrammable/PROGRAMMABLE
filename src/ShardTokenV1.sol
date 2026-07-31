// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ShardConstantsV1 } from "./ShardConstantsV1.sol";

/// @notice Fixed-supply fungible unit. 1e18 SHARD == 1 NFT.
/// @dev No mint, no burn, no owner. Supply is immutable from construction —
///      the hook's core invariant depends on it.
contract ShardTokenV1 is ERC20 {
    constructor() ERC20("Shard", "SHARD") {
        _mint(msg.sender, ShardConstantsV1.MAX_NFTS * ShardConstantsV1.SHARDS_PER_NFT);
    }
}
