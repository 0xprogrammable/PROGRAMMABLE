// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {
    ITimelockedPositionRecipient
} from "@uniswap/liquidity-launcher/src/interfaces/ITimelockedPositionRecipient.sol";
import { PositionFeesForwarder } from "@uniswap/liquidity-launcher/src/periphery/PositionFeesForwarder.sol";
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

import { ClassicCtoAuthorityV1 } from "../src/ClassicCtoAuthorityV1.sol";
import {
    ClassicInitialBuyCustodyConfig,
    ClassicInitialBuyCustodyMode
} from "../src/ClassicInitialBuyVestingWalletV1.sol";
import { ClassicInitialBuyVestingWalletFactoryV1 } from "../src/ClassicInitialBuyVestingWalletFactoryV1.sol";
import { ClassicLaunchPolicyV1 } from "../src/ClassicLaunchPolicyV1.sol";
import { ClassicRewardVaultFactoryV1 } from "../src/ClassicRewardVaultFactoryV1.sol";
import { ClassicRewardVaultV1 } from "../src/ClassicRewardVaultV1.sol";
import { EthCreatorFeeHookFactoryV3 } from "../src/EthCreatorFeeHookFactoryV3.sol";
import { EthCreatorFeeHookV3 } from "../src/EthCreatorFeeHookV3.sol";
import { FeeSplitVaultFactoryV1 } from "../src/FeeSplitVaultFactoryV1.sol";
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

    uint256 internal constant SNAPSHOT_BLOCK = 25_639_000;
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
    address internal constant UERC20_FACTORY = 0x000000e200088D55C39a11F609E5F667729ad49b;
    address internal constant POSITION_FORWARDER_FACTORY = 0x291a9ff1059d225d02B1659430804486404dB507;
    address internal constant LAUNCHER_FEE_RECIPIENT = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;

    bytes32 internal constant POOL_MANAGER_CODE_HASH =
        0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293;
    bytes32 internal constant POSITION_MANAGER_CODE_HASH =
        0x77e36c08b19959a30dde46dec9abe6208e371ff2f56884a56fe1e1a53615528b;
    bytes32 internal constant V4_QUOTER_CODE_HASH = 0x06de58fa119c5deaa7a667fb92d3894e25d9160e62fb82c8d86d43b47eefe441;
    bytes32 internal constant PERMIT2_CODE_HASH = 0xc67d1657868aa5146eaf24fb879fb1fdec3d2d493b3683a61c9c2f4fb2851131;
    bytes32 internal constant UNIVERSAL_ROUTER_CODE_HASH =
        0x41ccd905c8e4de29ce9536ff49233b79e3085a0987d490664e703ee1e7b1dc49;
    bytes32 internal constant UERC20_FACTORY_CODE_HASH =
        0x9f042af1533641f048ced56b55898d9e87b2ccb0ec6854292e2cd8ea733e6aeb;
    bytes32 internal constant POSITION_FORWARDER_FACTORY_CODE_HASH =
        0xcefd10b60f990984bb60c98eb53e66048bfd36da9b48200e8535f5ca39d58fb2;

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
        treasury = LAUNCHER_FEE_RECIPIENT;
        _assertOfficialDependencyHashes();

        ClassicCtoAuthorityV1 ctoAuthority = new ClassicCtoAuthorityV1(makeAddr("forkCtoAuthority"));
        ClassicRewardVaultFactoryV1 vaultFactory = new ClassicRewardVaultFactoryV1(ctoAuthority);
        ClassicInitialBuyVestingWalletFactoryV1 initialBuyVestingWalletFactory =
            new ClassicInitialBuyVestingWalletFactoryV1();
        ClassicLaunchPolicyV1 launchPolicy = new ClassicLaunchPolicyV1();
        EthCreatorFeeHookFactoryV3 hookFactory = new EthCreatorFeeHookFactoryV3();
        (, bytes32 hookSalt) = HookMiner.find(
            address(hookFactory),
            hookFactory.REQUIRED_HOOK_FLAGS(),
            type(EthCreatorFeeHookV3).creationCode,
            abi.encode(poolManager, treasury, FeeSplitVaultFactoryV1(address(vaultFactory)))
        );
        feeHook = hookFactory.deploy(hookSalt, poolManager, treasury, FeeSplitVaultFactoryV1(address(vaultFactory)));
        launcher = new MemeLaunchV2(
            poolManager,
            positionManager,
            UERC20Factory(UERC20_FACTORY),
            feeHook,
            vaultFactory,
            initialBuyVestingWalletFactory,
            launchPolicy,
            LockedPositionFeeForwarderFactoryV1(POSITION_FORWARDER_FACTORY)
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
        LockedPositionFeeForwarderFactoryV1 forwarderFactory =
            LockedPositionFeeForwarderFactoryV1(POSITION_FORWARDER_FACTORY);
        PositionFeesForwarder forwarder = PositionFeesForwarder(payable(result.positionRecipient));
        assertTrue(forwarderFactory.isFactoryForwarder(result.positionRecipient));
        assertEq(address(forwarder.positionManager()), POSITION_MANAGER);
        assertEq(forwarder.operator(), address(0));
        assertEq(forwarder.timelockBlockNumber(), type(uint256).max);
        assertEq(forwarder.feeRecipient(), deployer);
        vm.expectRevert(ITimelockedPositionRecipient.Timelocked.selector);
        forwarder.approveOperator();

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

        ClassicRewardVaultV1 vault = ClassicRewardVaultV1(payable(result.rewardVault));
        vm.prank(deployer);
        vm.expectRevert(abi.encodeWithSelector(ClassicRewardVaultV1.NoFeesToClaim.selector, deployer));
        vault.claim();
        vm.prank(beneficiaryA);
        uint256 claimA = vault.claim();
        vm.prank(beneficiaryB);
        uint256 claimB = vault.claim();
        assertEq(claimA + claimB, creatorFees);

        address unauthorizedCaller = makeAddr("unauthorizedLauncherFeeCaller");
        vm.prank(unauthorizedCaller);
        vm.expectRevert(
            abi.encodeWithSelector(
                EthCreatorFeeHookV3.UnauthorizedFeeRedirect.selector, unauthorizedCaller, LAUNCHER_FEE_RECIPIENT
            )
        );
        feeHook.claimLauncherFees();

        uint256 treasuryBalanceBefore = LAUNCHER_FEE_RECIPIENT.balance;
        vm.prank(LAUNCHER_FEE_RECIPIENT);
        uint256 claimed = feeHook.claimLauncherFees();
        assertEq(claimed, platformFees);
        assertEq(LAUNCHER_FEE_RECIPIENT.balance - treasuryBalanceBefore, platformFees);
        assertEq(feeHook.totalNativeFeesAccrued(), 0);
        assertEq(poolManager.balanceOf(address(feeHook), Currency.wrap(address(0)).toId()), 0);
    }

    function _assertOfficialDependencyHashes() private view {
        assertEq(POOL_MANAGER.codehash, POOL_MANAGER_CODE_HASH);
        assertEq(POSITION_MANAGER.codehash, POSITION_MANAGER_CODE_HASH);
        assertEq(V4_QUOTER.codehash, V4_QUOTER_CODE_HASH);
        assertEq(PERMIT2.codehash, PERMIT2_CODE_HASH);
        assertEq(UNIVERSAL_ROUTER.codehash, UNIVERSAL_ROUTER_CODE_HASH);
        assertEq(UERC20_FACTORY.codehash, UERC20_FACTORY_CODE_HASH);
        assertEq(POSITION_FORWARDER_FACTORY.codehash, POSITION_FORWARDER_FACTORY_CODE_HASH);
    }

    function _launch() private returns (MemeLaunchV2.LaunchResult memory result) {
        address[] memory beneficiaries = new address[](2);
        beneficiaries[0] = beneficiaryA;
        beneficiaries[1] = beneficiaryB;
        uint16[] memory shares = new uint16[](2);
        shares[0] = 2500;
        shares[1] = 7500;
        MemeLaunchV2.LaunchParameters memory parameters = MemeLaunchV2.LaunchParameters({
            name: "Programmable Classic Fork",
            symbol: "PCF",
            buySwapFeeBps: 200,
            sellSwapFeeBps: 800,
            creatorSalt: keccak256("programmable-classic-mainnet-fork"),
            metadata: UERC20Metadata({
                description: "Pinned Classic mainnet fork fixture",
                website: "https://programmable.family",
                image: "",
                extraData: ""
            }),
            rewardBeneficiaries: beneficiaries,
            rewardSharesBps: shares,
            initialBuyCustody: ClassicInitialBuyCustodyConfig({
                mode: ClassicInitialBuyCustodyMode.Unlocked, durationDays: 0, cliffDays: 0
            })
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
