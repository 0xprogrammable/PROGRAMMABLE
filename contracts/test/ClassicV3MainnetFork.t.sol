// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { UERC20 } from "@uniswap/uerc20-factory/src/tokens/UERC20.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { IV4Quoter } from "@uniswap/v4-periphery/src/interfaces/IV4Quoter.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { Test } from "forge-std/Test.sol";

import { EthCreatorFeeHookFactoryV3 } from "../src/EthCreatorFeeHookFactoryV3.sol";
import { EthCreatorFeeHookV3 } from "../src/EthCreatorFeeHookV3.sol";
import { FeeSplitVaultFactoryV1 } from "../src/FeeSplitVaultFactoryV1.sol";
import { FeeSplitVaultV1 } from "../src/FeeSplitVaultV1.sol";
import { LockedPositionFeeForwarderFactoryV1 } from "../src/LockedPositionFeeForwarderFactoryV1.sol";
import { MemeLaunchV2 } from "../src/MemeLaunchV2.sol";

interface IClassicV3UniversalRouter {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

interface IClassicV3Permit2 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

struct ClassicV3ExactInputSingleParams {
    PoolKey poolKey;
    bool zeroForOne;
    uint128 amountIn;
    uint128 amountOutMinimum;
    uint256 minHopPriceX36;
    bytes hookData;
}

contract ClassicV3MainnetForkTest is Test {
    using CurrencyLibrary for Currency;

    uint256 internal constant SNAPSHOT_BLOCK = 25_612_664;
    uint256 internal constant BUY_AMOUNT = 0.01 ether;
    uint256 internal constant MIN_INITIAL_BUY_WEI = 0.0006 ether;
    uint8 internal constant SWAP_EXACT_IN_SINGLE = 0x06;
    uint8 internal constant SETTLE_ALL = 0x0c;
    uint8 internal constant TAKE_ALL = 0x0f;
    uint8 internal constant UR_V4_SWAP = 0x10;

    address internal constant POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address internal constant POSITION_MANAGER = 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e;
    address internal constant V4_QUOTER = 0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address internal constant UNIVERSAL_ROUTER = 0xd92A36B0000531EF3063dEd4De20A0783308446C;

    IPoolManager internal poolManager;
    IPositionManager internal positionManager;
    EthCreatorFeeHookV3 internal feeHook;
    MemeLaunchV2 internal launcher;

    address internal deployer;
    address internal beneficiaryA;
    address internal beneficiaryB;
    address internal treasury;
    address internal trader;

    function setUp() public {
        string memory rpc = vm.envOr("ETHEREUM_RPC_URL", string("https://eth.drpc.org"));
        vm.createSelectFork(rpc, SNAPSHOT_BLOCK);

        poolManager = IPoolManager(POOL_MANAGER);
        positionManager = IPositionManager(POSITION_MANAGER);
        treasury = makeAddr("forkTreasury");

        FeeSplitVaultFactoryV1 vaultFactory = new FeeSplitVaultFactoryV1();
        EthCreatorFeeHookFactoryV3 hookFactory = new EthCreatorFeeHookFactoryV3();
        (, bytes32 hookSalt) = HookMiner.find(
            address(hookFactory),
            hookFactory.REQUIRED_HOOK_FLAGS(),
            type(EthCreatorFeeHookV3).creationCode,
            abi.encode(poolManager, treasury, vaultFactory)
        );
        feeHook = hookFactory.deploy(hookSalt, poolManager, treasury, vaultFactory);
        launcher = new MemeLaunchV2(
            poolManager,
            positionManager,
            new UERC20Factory(),
            feeHook,
            vaultFactory,
            new LockedPositionFeeForwarderFactoryV1(positionManager)
        );

        deployer = makeAddr("forkDeployer");
        beneficiaryA = makeAddr("forkBeneficiaryA");
        beneficiaryB = makeAddr("forkBeneficiaryB");
        trader = makeAddr("forkTrader");
        vm.deal(deployer, 1 ether);
        vm.deal(trader, 10 ether);
    }

    function test_fullLifecycleUsesOfficialMainnetContractsAndBeneficiaryOwnedClaims() public {
        MemeLaunchV2.LaunchResult memory result = _launch();
        PoolKey memory key = launcher.poolKey(result.token);

        assertEq(result.poolId, PoolId.unwrap(key.toId()));
        assertEq(UERC20(result.token).creator(), address(launcher));
        assertEq(IERC20(result.token).balanceOf(deployer), result.initialBuyTokenAmount);
        assertEq(IERC721(POSITION_MANAGER).ownerOf(result.positionTokenId), result.positionRecipient);
        assertEq(result.tokenLiquidityAmount + result.lockedTokenDust, launcher.TOKEN_SUPPLY());

        uint256 quotedBuy = _quoteExactInput(key, true, BUY_AMOUNT);
        _executeExactInput(trader, key, true, _asUint128(BUY_AMOUNT), _asUint128(quotedBuy * 99 / 100), BUY_AMOUNT);
        uint256 traderTokens = IERC20(result.token).balanceOf(trader);
        assertGt(traderTokens, 0);

        vm.startPrank(trader);
        IERC20(result.token).approve(PERMIT2, type(uint256).max);
        IClassicV3Permit2(PERMIT2).approve(result.token, UNIVERSAL_ROUTER, type(uint160).max, type(uint48).max);
        vm.stopPrank();
        uint256 sellAmount = traderTokens / 2;
        uint256 quotedSell = _quoteExactInput(key, false, sellAmount);
        _executeExactInput(trader, key, false, _asUint128(sellAmount), _asUint128(quotedSell * 99 / 100), 0);

        (,,,,, uint256 creatorFees) = feeHook.poolFeeConfig(result.poolId);
        uint256 platformFees = feeHook.launcherFeesAccrued();
        assertGt(creatorFees, 0);
        assertGt(platformFees, 0);
        assertEq(creatorFees + platformFees, feeHook.totalNativeFeesAccrued());
        assertEq(
            poolManager.balanceOf(address(feeHook), Currency.wrap(address(0)).toId()), feeHook.totalNativeFeesAccrued()
        );
        assertEq(poolManager.balanceOf(address(feeHook), Currency.wrap(result.token).toId()), 0);

        FeeSplitVaultV1 vault = FeeSplitVaultV1(payable(result.rewardVault));
        vm.prank(deployer);
        vm.expectRevert(abi.encodeWithSelector(FeeSplitVaultV1.UnauthorizedBeneficiary.selector, deployer));
        vault.claim();
        vm.prank(beneficiaryA);
        uint256 claimA = vault.claim();
        vm.prank(beneficiaryB);
        uint256 claimB = vault.claim();
        assertEq(claimA + claimB, creatorFees);

        vm.prank(treasury);
        feeHook.claimLauncherFees();
        assertEq(feeHook.totalNativeFeesAccrued(), 0);
        assertEq(poolManager.balanceOf(address(feeHook), Currency.wrap(address(0)).toId()), 0);
    }

    function _launch() private returns (MemeLaunchV2.LaunchResult memory result) {
        address[] memory beneficiaries = new address[](2);
        beneficiaries[0] = beneficiaryA;
        beneficiaries[1] = beneficiaryB;
        uint16[] memory shares = new uint16[](2);
        shares[0] = 2500;
        shares[1] = 7500;
        MemeLaunchV2.LaunchParameters memory parameters = MemeLaunchV2.LaunchParameters({
            name: "Programmable Classic V3 Fork",
            symbol: "PCV3F",
            buySwapFeeBps: 200,
            sellSwapFeeBps: 800,
            creatorSalt: keccak256("programmable-classic-v3-mainnet-fork"),
            metadata: UERC20Metadata({
                description: "Pinned Classic V3 mainnet fork fixture",
                website: "https://programmable.family",
                image: "",
                extraData: ""
            }),
            rewardBeneficiaries: beneficiaries,
            rewardSharesBps: shares
        });
        vm.prank(deployer);
        result = launcher.launch{ value: MIN_INITIAL_BUY_WEI }(parameters);
    }

    function _quoteExactInput(PoolKey memory key, bool zeroForOne, uint256 amountIn)
        private
        returns (uint256 amountOut)
    {
        (amountOut,) = IV4Quoter(V4_QUOTER)
            .quoteExactInputSingle(
                IV4Quoter.QuoteExactSingleParams({
                poolKey: key, zeroForOne: zeroForOne, exactAmount: _asUint128(amountIn), hookData: ""
            })
            );
        assertGt(amountOut, 0);
    }

    function _executeExactInput(
        address caller,
        PoolKey memory key,
        bool zeroForOne,
        uint128 amountIn,
        uint128 amountOutMinimum,
        uint256 value
    ) private {
        ClassicV3ExactInputSingleParams memory swap = ClassicV3ExactInputSingleParams({
            poolKey: key,
            zeroForOne: zeroForOne,
            amountIn: amountIn,
            amountOutMinimum: amountOutMinimum,
            minHopPriceX36: 0,
            hookData: ""
        });
        bytes memory actions = abi.encodePacked(SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL);
        bytes[] memory actionParameters = new bytes[](3);
        actionParameters[0] = abi.encode(swap);
        actionParameters[1] = abi.encode(zeroForOne ? address(0) : Currency.unwrap(key.currency1), uint256(amountIn));
        actionParameters[2] =
            abi.encode(zeroForOne ? Currency.unwrap(key.currency1) : address(0), uint256(amountOutMinimum));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(actions, actionParameters);

        vm.prank(caller);
        IClassicV3UniversalRouter(UNIVERSAL_ROUTER).execute{ value: value }(
            abi.encodePacked(UR_V4_SWAP), inputs, block.timestamp + 1 hours
        );
    }

    function _asUint128(uint256 value) private pure returns (uint128 narrowed) {
        require(value <= type(uint128).max);
        // forge-lint: disable-next-line(unsafe-typecast)
        narrowed = uint128(value);
    }
}
