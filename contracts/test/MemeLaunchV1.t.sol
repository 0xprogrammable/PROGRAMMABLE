// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {
    ITimelockedPositionRecipient
} from "@uniswap/liquidity-launcher/src/interfaces/ITimelockedPositionRecipient.sol";
import { PositionFeesForwarder } from "@uniswap/liquidity-launcher/src/periphery/PositionFeesForwarder.sol";
import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { UERC20 } from "@uniswap/uerc20-factory/src/tokens/UERC20.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";
import { PositionManager } from "@uniswap/v4-periphery/src/PositionManager.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

import { EthCreatorFeeHookFactoryV1 } from "../src/EthCreatorFeeHookFactoryV1.sol";
import { EthCreatorFeeHookV1 } from "../src/EthCreatorFeeHookV1.sol";
import { LockedPositionFeeForwarderFactoryV1 } from "../src/LockedPositionFeeForwarderFactoryV1.sol";
import { MemeLaunchV1 } from "../src/MemeLaunchV1.sol";

contract MemeLaunchV1Test is Deployers {
    using SafeCast for uint256;
    using StateLibrary for IPoolManager;

    struct OfficialMetadataV2 {
        string description;
        string website;
        string image;
        bytes extraData;
    }

    struct OfficialLaunchParametersV2 {
        string name;
        string symbol;
        uint16 totalSwapFeeBps;
        bytes32 creatorSalt;
        OfficialMetadataV2 metadata;
    }

    address internal constant CANONICAL_POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address internal constant CANONICAL_POSITION_MANAGER = 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e;
    bytes32 internal constant CREATOR_SALT = keccak256("meme-launch-fixture");
    uint16 internal constant TOTAL_SWAP_FEE_BPS = 100;
    uint256 internal constant MIN_INITIAL_BUY_WEI = 0.0006 ether;

    IPositionManager internal positionManager;
    UERC20Factory internal tokenFactory;
    EthCreatorFeeHookFactoryV1 internal hookFactory;
    EthCreatorFeeHookV1 internal feeHook;
    LockedPositionFeeForwarderFactoryV1 internal positionForwarderFactory;
    MemeLaunchV1 internal launcher;

    address internal creator;
    address internal launcherTreasury;
    address internal tokenAddress;
    bytes32 internal effectiveGraffiti;

    function setUp() public {
        deployCodeTo("PoolManager.sol:PoolManager", abi.encode(address(this)), CANONICAL_POOL_MANAGER);
        manager = IPoolManager(CANONICAL_POOL_MANAGER);
        deployCodeTo(
            "PositionManager.sol:PositionManager",
            abi.encode(manager, address(0), uint256(0), address(0), address(0)),
            CANONICAL_POSITION_MANAGER
        );
        positionManager = IPositionManager(CANONICAL_POSITION_MANAGER);

        tokenFactory = new UERC20Factory();
        hookFactory = new EthCreatorFeeHookFactoryV1();
        positionForwarderFactory = new LockedPositionFeeForwarderFactoryV1(positionManager);
        launcherTreasury = makeAddr("memeLauncherTreasury");
        feeHook = _deployHook();
        launcher = new MemeLaunchV1(manager, positionManager, tokenFactory, feeHook, positionForwarderFactory);

        creator = makeAddr("memeLaunchCreator");
        vm.deal(creator, 10 ether);
        (tokenAddress, effectiveGraffiti) =
            launcher.predictTokenAddress("Meme Launch Token", "MEME", creator, CREATOR_SALT);
    }

    function test_launchesLockedPositionAndExecutesMinimumCreatorDevBuy() public {
        uint256 creatorEthBefore = creator.balance;
        MemeLaunchV1.LaunchResult memory result = _launch();
        PoolKey memory key = launcher.poolKey(result.token);
        PositionFeesForwarder forwarder = PositionFeesForwarder(payable(result.positionRecipient));

        assertEq(result.token, tokenAddress);
        assertEq(result.positionTokenId, positionManager.nextTokenId() - 1);
        assertEq(result.poolId, PoolId.unwrap(key.toId()));
        assertEq(result.launchHash, launcher.launchHashOf(result.token));
        assertTrue(result.launchHash != bytes32(0));

        assertEq(IERC20(result.token).totalSupply(), launcher.TOKEN_SUPPLY());
        assertEq(result.initialBuyNativeAmount, MIN_INITIAL_BUY_WEI);
        assertEq(IERC20(result.token).balanceOf(creator), result.initialBuyTokenAmount);
        assertGt(result.initialBuyTokenAmount, 0);
        assertEq(IERC20(result.token).balanceOf(address(launcher)), 0);
        assertEq(IERC20(result.token).balanceOf(address(positionManager)), 0);
        assertEq(IERC20(result.token).balanceOf(result.positionRecipient), result.lockedTokenDust);
        assertEq(result.tokenLiquidityAmount + result.lockedTokenDust, launcher.TOKEN_SUPPLY());
        assertGt(result.tokenLiquidityAmount, 0);
        assertEq(creator.balance, creatorEthBefore - MIN_INITIAL_BUY_WEI);
        assertEq(address(launcher).balance, 0);

        assertEq(UERC20(result.token).creator(), address(launcher));
        assertEq(UERC20(result.token).graffiti(), effectiveGraffiti);
        assertEq(positionManager.getPositionLiquidity(result.positionTokenId) > 0, true);
        assertEq(IERC721(address(positionManager)).ownerOf(result.positionTokenId), result.positionRecipient);

        (uint160 sqrtPriceX96, int24 tick,,) = manager.getSlot0(key.toId());
        assertLt(sqrtPriceX96, TickMath.getSqrtPriceAtTick(launcher.INITIAL_TICK()));
        assertLt(tick, launcher.INITIAL_TICK());
        assertGt(manager.getLiquidity(key.toId()), 0);
        assertEq(key.fee, 0);
        assertEq(key.tickSpacing, 200);
        assertEq(address(key.hooks), address(feeHook));

        (address feeCreator, address registrar, uint16 totalSwapFeeBps, bool registered, uint256 accrued) =
            feeHook.poolFeeConfig(result.poolId);
        assertEq(feeCreator, creator);
        assertEq(registrar, address(launcher));
        assertEq(totalSwapFeeBps, TOTAL_SWAP_FEE_BPS);
        assertTrue(registered);
        assertEq(accrued, 5_400_000_000_000);
        assertEq(feeHook.launcherFeesAccrued(), 600_000_000_000);

        assertEq(forwarder.operator(), address(0));
        assertEq(forwarder.timelockBlockNumber(), type(uint256).max);
        assertEq(forwarder.feeRecipient(), creator);
        assertTrue(positionForwarderFactory.isFactoryForwarder(result.positionRecipient));

        vm.expectRevert(ITimelockedPositionRecipient.Timelocked.selector);
        forwarder.approveOperator();
        vm.expectRevert();
        vm.prank(creator);
        IERC721(address(positionManager)).transferFrom(result.positionRecipient, creator, result.positionTokenId);
    }

    function test_creatorCanChooseALargerAtomicDevBuy() public {
        MemeLaunchV1.LaunchResult memory minimumResult = _launch();
        uint256 largerBuy = 0.002 ether;
        MemeLaunchV1.LaunchParameters memory parameters =
            _parametersFor(TOTAL_SWAP_FEE_BPS, keccak256("larger-dev-buy"));

        uint256 creatorEthBefore = creator.balance;
        vm.prank(creator);
        MemeLaunchV1.LaunchResult memory largerResult = launcher.launch{ value: largerBuy }(parameters);

        assertEq(largerResult.initialBuyNativeAmount, largerBuy);
        assertGt(largerResult.initialBuyTokenAmount, minimumResult.initialBuyTokenAmount);
        assertEq(IERC20(largerResult.token).balanceOf(creator), largerResult.initialBuyTokenAmount);
        assertEq(creator.balance, creatorEthBefore - largerBuy);
        assertEq(address(launcher).balance, 0);
    }

    function test_launchRoundTripsNonemptyOfficialExtraDataWithoutAbiGarbage() public {
        bytes memory expectedExtraData = hex"0102030405aabbcc";
        OfficialLaunchParametersV2 memory parameters = OfficialLaunchParametersV2({
            name: "Metadata Fixture",
            symbol: "META",
            totalSwapFeeBps: TOTAL_SWAP_FEE_BPS,
            creatorSalt: keccak256("official-metadata-v2-fixture"),
            metadata: OfficialMetadataV2({
                description: "Official UERC20 metadata fixture",
                website: "https://programmable.family",
                image: "ipfs://programmable-metadata-fixture",
                extraData: expectedExtraData
            })
        });
        bytes4 officialLaunchSelector =
            bytes4(keccak256("launch((string,string,uint16,bytes32,(string,string,string,bytes)))"));

        vm.prank(creator);
        (bool launchSucceeded, bytes memory launchData) = address(launcher).call{ value: MIN_INITIAL_BUY_WEI }(
            abi.encodeWithSelector(officialLaunchSelector, parameters)
        );
        assertTrue(launchSucceeded, "official extraData ABI launch reverted");

        MemeLaunchV1.LaunchResult memory result = abi.decode(launchData, (MemeLaunchV1.LaunchResult));
        (bool metadataSucceeded, bytes memory metadataData) =
            result.token.staticcall(abi.encodeWithSignature("metadata()"));
        assertTrue(metadataSucceeded, "metadata read reverted");

        (string memory description, string memory website, string memory image, bytes memory actualExtraData) =
            abi.decode(metadataData, (string, string, string, bytes));
        assertEq(description, parameters.metadata.description);
        assertEq(website, parameters.metadata.website);
        assertEq(image, parameters.metadata.image);
        assertEq(actualExtraData.length, expectedExtraData.length);
        assertEq(keccak256(actualExtraData), keccak256(expectedExtraData));
    }

    function test_acceptsEveryMetadataFieldAtItsExactUtf8ByteLimit() public {
        MemeLaunchV1.LaunchParameters memory parameters = _parameters();
        parameters.name = _asciiBytes(launcher.MAX_TOKEN_NAME_BYTES(), "n");
        parameters.symbol = _asciiBytes(launcher.MAX_TOKEN_SYMBOL_BYTES(), "S");
        parameters.metadata.description = _asciiBytes(launcher.MAX_TOKEN_DESCRIPTION_BYTES(), "d");
        parameters.metadata.website = _asciiBytes(launcher.MAX_METADATA_URL_BYTES(), "w");
        parameters.metadata.image = _asciiBytes(launcher.MAX_METADATA_URL_BYTES(), "i");
        parameters.metadata.extraData = bytes(_asciiBytes(launcher.MAX_SOCIAL_EXTRA_DATA_BYTES(), "x"));

        vm.prank(creator);
        MemeLaunchV1.LaunchResult memory result = launcher.launch{ value: MIN_INITIAL_BUY_WEI }(parameters);

        (string memory description, string memory website, string memory image, bytes memory extraData) =
            UERC20(result.token).metadata();
        assertEq(bytes(description).length, launcher.MAX_TOKEN_DESCRIPTION_BYTES());
        assertEq(bytes(website).length, launcher.MAX_METADATA_URL_BYTES());
        assertEq(bytes(image).length, launcher.MAX_METADATA_URL_BYTES());
        assertEq(extraData.length, launcher.MAX_SOCIAL_EXTRA_DATA_BYTES());
        assertTrue(launcher.launchHashOf(result.token) != bytes32(0));
    }

    function test_rejectsOverlongDirectCallMetadataBeforeRegistryWrite() public {
        MemeLaunchV1.LaunchParameters memory parameters = _parameters();

        parameters.name = _asciiBytes(launcher.MAX_TOKEN_NAME_BYTES() + 1, "n");
        _expectMetadataRevert(
            parameters,
            MemeLaunchV1.TokenNameTooLong.selector,
            launcher.MAX_TOKEN_NAME_BYTES() + 1,
            launcher.MAX_TOKEN_NAME_BYTES()
        );

        parameters = _parameters();
        parameters.symbol = _asciiBytes(launcher.MAX_TOKEN_SYMBOL_BYTES() + 1, "S");
        _expectMetadataRevert(
            parameters,
            MemeLaunchV1.TokenSymbolTooLong.selector,
            launcher.MAX_TOKEN_SYMBOL_BYTES() + 1,
            launcher.MAX_TOKEN_SYMBOL_BYTES()
        );

        parameters = _parameters();
        parameters.metadata.description = _asciiBytes(launcher.MAX_TOKEN_DESCRIPTION_BYTES() + 1, "d");
        _expectMetadataRevert(
            parameters,
            MemeLaunchV1.TokenDescriptionTooLong.selector,
            launcher.MAX_TOKEN_DESCRIPTION_BYTES() + 1,
            launcher.MAX_TOKEN_DESCRIPTION_BYTES()
        );

        parameters = _parameters();
        parameters.metadata.website = _asciiBytes(launcher.MAX_METADATA_URL_BYTES() + 1, "w");
        _expectMetadataRevert(
            parameters,
            MemeLaunchV1.MetadataWebsiteTooLong.selector,
            launcher.MAX_METADATA_URL_BYTES() + 1,
            launcher.MAX_METADATA_URL_BYTES()
        );

        parameters = _parameters();
        parameters.metadata.image = _asciiBytes(launcher.MAX_METADATA_URL_BYTES() + 1, "i");
        _expectMetadataRevert(
            parameters,
            MemeLaunchV1.MetadataImageTooLong.selector,
            launcher.MAX_METADATA_URL_BYTES() + 1,
            launcher.MAX_METADATA_URL_BYTES()
        );

        parameters = _parameters();
        parameters.metadata.extraData = bytes(_asciiBytes(launcher.MAX_SOCIAL_EXTRA_DATA_BYTES() + 1, "x"));
        _expectMetadataRevert(
            parameters,
            MemeLaunchV1.MetadataExtraDataTooLong.selector,
            launcher.MAX_SOCIAL_EXTRA_DATA_BYTES() + 1,
            launcher.MAX_SOCIAL_EXTRA_DATA_BYTES()
        );
    }

    function test_initialTickDefinesOnePointThreeFiveEthStartingFdv() public view {
        uint160 sqrtPriceX96 = TickMath.getSqrtPriceAtTick(launcher.INITIAL_TICK());
        uint256 priceDenominator = uint256(sqrtPriceX96) * sqrtPriceX96;
        uint256 startingFdvWei = FullMath.mulDiv(launcher.TOKEN_SUPPLY(), 1 << 192, priceDenominator);

        assertApproxEqAbs(startingFdvWei, 1_355_657_760_817_103_798, 1);
    }

    function test_buyAndSellAccrueOnlyEthFeesForCreatorAndLauncher() public {
        MemeLaunchV1.LaunchResult memory result = _launch();
        PoolKey memory key = launcher.poolKey(result.token);
        PoolSwapTest router = new PoolSwapTest(manager);
        PoolSwapTest.TestSettings memory settings =
            PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });
        address trader = makeAddr("memeTrader");
        vm.deal(trader, 10 ether);

        vm.prank(trader);
        router.swap{ value: 0.1 ether }(
            key,
            SwapParams({
                zeroForOne: true, amountSpecified: -int256(0.1 ether), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            settings,
            ""
        );

        uint256 traderTokens = IERC20(result.token).balanceOf(trader);
        assertGt(traderTokens, 0);
        vm.startPrank(trader);
        IERC20(result.token).approve(address(router), type(uint256).max);
        router.swap(
            key,
            SwapParams({
                zeroForOne: false,
                amountSpecified: -(traderTokens / 2).toInt256(),
                sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
            }),
            settings,
            ""
        );
        vm.stopPrank();

        (,,,, uint256 creatorFees) = feeHook.poolFeeConfig(result.poolId);
        uint256 launcherFees = feeHook.launcherFeesAccrued();
        assertGt(creatorFees, 0);
        assertGt(launcherFees, 0);
        assertEq(manager.balanceOf(address(feeHook), CurrencyLibrary.ADDRESS_ZERO.toId()), creatorFees + launcherFees);
        assertEq(manager.balanceOf(address(feeHook), Currency.wrap(result.token).toId()), 0);

        uint256 creatorBefore = creator.balance;
        uint256 treasuryBefore = launcherTreasury.balance;
        vm.prank(makeAddr("claimCaller"));
        feeHook.claimCreatorFees(result.poolId);
        feeHook.claimLauncherFees();
        assertEq(creator.balance, creatorBefore + creatorFees);
        assertEq(launcherTreasury.balance, treasuryBefore + launcherFees);
    }

    function test_supportsEveryIntegerTotalSwapFeeFromOneToTenPercent() public {
        for (uint16 percent = 1; percent <= 10; percent++) {
            address feeCreator = makeAddr(string.concat("creator", vm.toString(percent)));
            bytes32 salt = keccak256(abi.encode("fee-step", percent));
            vm.deal(feeCreator, MIN_INITIAL_BUY_WEI);
            vm.prank(feeCreator);
            MemeLaunchV1.LaunchResult memory result =
                launcher.launch{ value: MIN_INITIAL_BUY_WEI }(_parametersFor(percent * 100, salt));
            (,, uint16 storedFee, bool registered,) = feeHook.poolFeeConfig(result.poolId);
            assertTrue(registered);
            assertEq(storedFee, percent * 100);
        }
    }

    function test_rejectsNonIntegerAndOutOfRangeTotalSwapFeesBeforeTokenCreation() public {
        uint16[5] memory invalidFees = [uint16(0), uint16(50), uint16(150), uint16(1050), uint16(1100)];
        for (uint256 i; i < invalidFees.length; i++) {
            MemeLaunchV1.LaunchParameters memory parameters = _parameters();
            parameters.totalSwapFeeBps = invalidFees[i];
            parameters.creatorSalt = bytes32(i + 1);

            vm.expectRevert(abi.encodeWithSelector(MemeLaunchV1.InvalidTotalSwapFee.selector, invalidFees[i]));
            vm.prank(creator);
            launcher.launch(parameters);
        }
    }

    function test_rejectsDuplicateTokenLaunch() public {
        _launch();
        vm.expectRevert(abi.encodeWithSelector(MemeLaunchV1.TokenAlreadyExists.selector, tokenAddress));
        vm.prank(creator);
        launcher.launch{ value: MIN_INITIAL_BUY_WEI }(_parameters());
    }

    function test_reusesMatchingPredeployedPermanentPositionRecipient() public {
        bytes32 positionSalt = keccak256(abi.encode("launcher.meme-position.v1", tokenAddress, creator));
        address predicted = address(positionForwarderFactory.deploy(positionSalt, creator));

        MemeLaunchV1.LaunchResult memory result = _launch();
        assertEq(result.positionRecipient, predicted);
        assertEq(IERC721(address(positionManager)).ownerOf(result.positionTokenId), predicted);
    }

    function _deployHook() private returns (EthCreatorFeeHookV1 deployed) {
        (, bytes32 salt) = HookMiner.find(
            address(hookFactory),
            hookFactory.REQUIRED_HOOK_FLAGS(),
            type(EthCreatorFeeHookV1).creationCode,
            abi.encode(manager, launcherTreasury)
        );
        deployed = hookFactory.deploy(salt, manager, launcherTreasury);
    }

    function _launch() private returns (MemeLaunchV1.LaunchResult memory result) {
        vm.prank(creator);
        result = launcher.launch{ value: MIN_INITIAL_BUY_WEI }(_parameters());
    }

    function _parameters() private pure returns (MemeLaunchV1.LaunchParameters memory) {
        return _parametersFor(TOTAL_SWAP_FEE_BPS, CREATOR_SALT);
    }

    function _parametersFor(uint16 totalSwapFeeBps, bytes32 salt)
        private
        pure
        returns (MemeLaunchV1.LaunchParameters memory parameters)
    {
        parameters = MemeLaunchV1.LaunchParameters({
            name: "Meme Launch Token",
            symbol: "MEME",
            totalSwapFeeBps: totalSwapFeeBps,
            creatorSalt: salt,
            metadata: UERC20Metadata({
                description: "A fixed supply one-sided v4 launch", website: "", image: "", extraData: bytes("")
            })
        });
    }

    function _expectMetadataRevert(
        MemeLaunchV1.LaunchParameters memory parameters,
        bytes4 selector,
        uint256 actualBytes,
        uint256 maximumBytes
    ) private {
        (address predictedToken,) = launcher.predictTokenAddress(
            parameters.name, parameters.symbol, creator, parameters.creatorSalt
        );
        vm.expectRevert(abi.encodeWithSelector(selector, actualBytes, maximumBytes));
        vm.prank(creator);
        launcher.launch(parameters);
        assertEq(predictedToken.code.length, 0);
        assertEq(launcher.launchHashOf(predictedToken), bytes32(0));
    }

    function _asciiBytes(uint256 length, bytes1 character) private pure returns (string memory value) {
        bytes memory buffer = new bytes(length);
        for (uint256 i; i < length; i++) {
            buffer[i] = character;
        }
        value = string(buffer);
    }
}
