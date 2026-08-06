// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { PoolManager } from "@uniswap/v4-core/src/PoolManager.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

import { GeometricRendererV1 } from "../src/GeometricRendererV1.sol";
import { ShardErrorsV1 } from "../src/ShardErrorsV1.sol";
import { ShardHookV1 } from "../src/ShardHookV1.sol";
import { ShardNFTV1 } from "../src/ShardNFTV1.sol";
import { ShardSwapRouterV1 } from "../src/ShardSwapRouterV1.sol";
import { ShardTokenV1 } from "../src/ShardTokenV1.sol";
import { ShardConstantsV1 } from "../src/ShardConstantsV1.sol";
import { IShardNFTV1 } from "../src/interfaces/IShardNFTV1.sol";

contract MissingHookGetter { }

contract MalformedHookGetter {
    fallback() external {
        assembly ("memory-safe") {
            mstore(0, caller())
            return(0, 31)
        }
    }
}

contract ArbSysOne {
    function arbBlockNumber() external pure returns (uint256) {
        return 1;
    }
}

contract ArbSysTwo {
    function arbBlockNumber() external pure returns (uint256) {
        return 2;
    }
}

contract IndependentlyFalseERC20 {
    string public constant name = "False Shard";
    string public constant symbol = "FALSE";
    uint8 public constant decimals = 18;

    mapping(address account => uint256 amount) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    address public falseTransferCaller;
    bool public transferFromReturns = true;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function setFalseTransferCaller(address value) external {
        falseTransferCaller = value;
    }

    function setTransferFromReturns(bool value) external {
        transferFromReturns = value;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return msg.sender != falseTransferCaller;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "allowance");
            allowance[from][msg.sender] = allowed - amount;
        }
        _move(from, to, amount);
        return transferFromReturns;
    }

    function _move(address from, address to, uint256 amount) private {
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}

contract ShardWiringV1Test is Test {
    uint160 internal constant REQUIRED_HOOK_FLAGS = uint160(
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
    );

    int24 internal constant TICK_BAND = 22_980;
    int24 internal constant TICK_UPPER = 115_080;
    uint256 internal constant FAR = type(uint256).max;

    IPoolManager internal manager;
    ShardTokenV1 internal shard;
    GeometricRendererV1 internal renderer;
    ShardHookV1 internal hook;
    ShardNFTV1 internal candidate;
    int24 internal tickLower;
    uint160 internal startSqrtPriceX96;
    address internal launcher = makeAddr("launcher");
    address internal builder = makeAddr("builder");
    address internal alice = makeAddr("alice");

    function setUp() public {
        manager = IPoolManager(address(new PoolManager(address(this))));
        shard = new ShardTokenV1();
        renderer = new GeometricRendererV1();
        tickLower = TickMath.minUsableTick(60);
        startSqrtPriceX96 = TickMath.getSqrtPriceAtTick(TICK_UPPER);
        hook = _deployHook(shard, builder);
        candidate = new ShardNFTV1(address(hook), address(renderer));
    }

    function test_correctNftBackReferenceBindsAndMarketRemainsUsable() public {
        assertEq(IShardNFTV1(address(candidate)).hook(), address(hook));

        hook.setNFT(IShardNFTV1(address(candidate)));
        assertEq(address(hook.nft()), address(candidate));

        assertTrue(shard.transfer(address(hook), hook.SEED_AMOUNT()));
        hook.initialise();
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        uint256 tokenId = hook.buyNFT{ value: 1 ether }(type(uint256).max, FAR);
        assertEq(candidate.ownerOf(tokenId), alice);
    }

    function test_setNftRejectsNftBoundToAnotherValidHook() public {
        ShardTokenV1 otherShard = new ShardTokenV1();
        ShardHookV1 otherHook = _deployHook(otherShard, makeAddr("other builder"));
        ShardNFTV1 wrong = new ShardNFTV1(address(otherHook), address(renderer));

        vm.expectRevert(abi.encodeWithSelector(ShardErrorsV1.WrongNFT.selector, address(wrong), address(hook)));
        hook.setNFT(IShardNFTV1(address(wrong)));
    }

    function test_setNftNormalizesMissingHookGetter() public {
        MissingHookGetter wrong = new MissingHookGetter();
        vm.expectRevert(abi.encodeWithSelector(ShardErrorsV1.WrongNFT.selector, address(wrong), address(hook)));
        hook.setNFT(IShardNFTV1(address(wrong)));
    }

    function test_setNftNormalizesMalformedHookGetter() public {
        MalformedHookGetter wrong = new MalformedHookGetter();
        vm.expectRevert(abi.encodeWithSelector(ShardErrorsV1.WrongNFT.selector, address(wrong), address(hook)));
        hook.setNFT(IShardNFTV1(address(wrong)));
    }

    function test_setNftRetainsExactAuthorizationAndOneShotErrors() public {
        vm.prank(alice);
        vm.expectRevert(ShardErrorsV1.NotDeployer.selector);
        hook.setNFT(IShardNFTV1(address(candidate)));

        hook.setNFT(IShardNFTV1(address(candidate)));
        vm.expectRevert(ShardErrorsV1.AlreadyInitialised.selector);
        hook.setNFT(IShardNFTV1(address(candidate)));
    }

    function test_setNftRetainsExactZeroAddressError() public {
        vm.expectRevert(ShardErrorsV1.ZeroAddress.selector);
        hook.setNFT(IShardNFTV1(address(0)));
    }

    function test_ethereumArtSeedDoesNotDependOnArbitrumPrecompileAddress() public {
        hook.setNFT(IShardNFTV1(address(candidate)));
        assertTrue(shard.transfer(address(hook), hook.SEED_AMOUNT()));
        hook.initialise();
        vm.deal(alice, 1 ether);

        ArbSysOne one = new ArbSysOne();
        ArbSysTwo two = new ArbSysTwo();
        bytes memory firstCode = address(one).code;
        bytes memory secondCode = address(two).code;
        uint256 snapshot = vm.snapshotState();

        vm.etch(address(0x64), firstCode);
        vm.prank(alice);
        uint256 firstId = hook.buyNFT{ value: 1 ether }(type(uint256).max, FAR);
        uint256 firstSeed = candidate.tokenSeed(firstId);

        vm.revertToState(snapshot);
        vm.etch(address(0x64), secondCode);
        vm.prank(alice);
        uint256 secondId = hook.buyNFT{ value: 1 ether }(type(uint256).max, FAR);
        uint256 secondSeed = candidate.tokenSeed(secondId);

        assertEq(firstId, secondId);
        assertEq(firstSeed, secondSeed, "Ethereum seed depended on code at ArbSys address");
    }

    function _deployHook(ShardTokenV1 token, address builderRecipient) internal returns (ShardHookV1 deployed) {
        bytes memory constructorArgs = abi.encode(
            manager,
            token,
            tickLower,
            TICK_BAND,
            TICK_UPPER,
            startSqrtPriceX96,
            address(this),
            launcher,
            builderRecipient
        );
        (address predicted, bytes32 salt) =
            HookMiner.find(address(this), REQUIRED_HOOK_FLAGS, type(ShardHookV1).creationCode, constructorArgs);
        deployed = new ShardHookV1{ salt: salt }(
            manager,
            token,
            tickLower,
            TICK_BAND,
            TICK_UPPER,
            startSqrtPriceX96,
            address(this),
            launcher,
            builderRecipient
        );
        assertEq(address(deployed), predicted);
    }
}

contract ShardCheckedTransferV1Test is Test {
    uint160 internal constant REQUIRED_HOOK_FLAGS = uint160(
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
    );
    int24 internal constant TICK_BAND = 22_980;
    int24 internal constant TICK_UPPER = 115_080;
    uint256 internal constant FAR = type(uint256).max;

    IPoolManager internal manager;
    IndependentlyFalseERC20 internal token;
    ShardHookV1 internal hook;
    ShardNFTV1 internal nft;
    int24 internal tickLower;
    uint160 internal startSqrtPriceX96;
    address internal launcher = makeAddr("false launcher");
    address internal builder = makeAddr("false builder");
    address internal alice = makeAddr("false alice");

    function setUp() public {
        manager = IPoolManager(address(new PoolManager(address(this))));
        token = new IndependentlyFalseERC20();
        tickLower = TickMath.minUsableTick(60);
        startSqrtPriceX96 = TickMath.getSqrtPriceAtTick(TICK_UPPER);

        bytes memory constructorArgs = abi.encode(
            manager,
            ShardTokenV1(address(token)),
            tickLower,
            TICK_BAND,
            TICK_UPPER,
            startSqrtPriceX96,
            address(this),
            launcher,
            builder
        );
        (address predicted, bytes32 salt) =
            HookMiner.find(address(this), REQUIRED_HOOK_FLAGS, type(ShardHookV1).creationCode, constructorArgs);
        hook = new ShardHookV1{ salt: salt }(
            manager,
            ShardTokenV1(address(token)),
            tickLower,
            TICK_BAND,
            TICK_UPPER,
            startSqrtPriceX96,
            address(this),
            launcher,
            builder
        );
        assertEq(address(hook), predicted);

        GeometricRendererV1 renderer = new GeometricRendererV1();
        nft = new ShardNFTV1(address(hook), address(renderer));
        hook.setNFT(IShardNFTV1(address(nft)));
        token.mint(address(hook), hook.SEED_AMOUNT());
        vm.deal(alice, 1 ether);
    }

    function test_initialiseRejectsFalseReturnFromLiquiditySettlementTransfer() public {
        token.setFalseTransferCaller(address(hook));
        vm.expectRevert(ShardErrorsV1.TokenTransferFailed.selector);
        hook.initialise();
    }

    function test_buyMaxRejectsFalseReturnWhenReturningFractionalShard() public {
        hook.initialise();
        token.setFalseTransferCaller(address(hook));

        vm.prank(alice);
        vm.expectRevert(ShardErrorsV1.TokenTransferFailed.selector);
        hook.buyMax{ value: 0.0001 ether }(0, FAR);
    }

    function test_redeemRejectsFalseReturnFromShardTransferFrom() public {
        hook.initialise();
        token.mint(alice, 1 ether);
        vm.prank(alice);
        token.approve(address(hook), 1 ether);
        token.setTransferFromReturns(false);

        vm.prank(alice);
        vm.expectRevert(ShardErrorsV1.TokenTransferFailed.selector);
        hook.redeem();
    }

    function test_routerRejectsFalseReturnFromShardTransferFrom() public {
        hook.initialise();
        PoolKey memory key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(token)),
            fee: ShardConstantsV1.POOL_FEE,
            tickSpacing: ShardConstantsV1.TICK_SPACING,
            hooks: IHooks(address(hook))
        });
        ShardSwapRouterV1 router = new ShardSwapRouterV1(manager, key);
        vm.prank(alice);
        hook.buyNFT{ value: 1 ether }(type(uint256).max, FAR);
        token.mint(alice, 1 ether);
        vm.prank(alice);
        token.approve(address(router), 1 ether);
        token.setTransferFromReturns(false);

        vm.prank(alice);
        vm.expectRevert(ShardSwapRouterV1.TokenTransferFailed.selector);
        router.swapShardForEth(key, 1 ether, 0, FAR);
    }
}
