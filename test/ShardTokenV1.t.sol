// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { ShardTokenV1 } from "../src/ShardTokenV1.sol";
import { ShardConstantsV1 } from "../src/ShardConstantsV1.sol";

contract ShardTokenV1Test is Test {
    ShardTokenV1 internal shard;

    function setUp() public {
        shard = new ShardTokenV1();
    }

    function test_totalSupplyIsTenThousandWhole() public view {
        assertEq(shard.totalSupply(), 10_000 ether);
    }

    function test_entireSupplyGoesToDeployer() public view {
        assertEq(shard.balanceOf(address(this)), shard.totalSupply());
    }

    function test_oneShardEqualsOneNft() public view {
        assertEq(shard.totalSupply() / ShardConstantsV1.SHARDS_PER_NFT, 10_000);
    }

    function test_hasNoMintFunction() public {
        (bool success,) = address(shard)
            .staticcall(abi.encodeWithSelector(bytes4(keccak256("mint(address,uint256)")), address(this), 1 ether));
        assertFalse(success);
    }

    function test_hasNoBurnFunction() public {
        (bool success,) = address(shard).staticcall(abi.encodeWithSelector(bytes4(keccak256("burn(uint256)")), 1 ether));
        assertFalse(success);
    }

    function test_metadata() public view {
        assertEq(shard.name(), "Shard");
        assertEq(shard.symbol(), "SHARD");
        assertEq(shard.decimals(), 18);
    }
}
