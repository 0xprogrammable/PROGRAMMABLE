// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { Position } from "@uniswap/liquidity-launcher/src/types/PositionPlannerTypes.sol";
import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";
import { PositionManager } from "@uniswap/v4-periphery/src/PositionManager.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { PositionInfo, PositionInfoLibrary } from "@uniswap/v4-periphery/src/libraries/PositionInfoLibrary.sol";
import { Vm } from "forge-std/Vm.sol";

import { ClassicCtoAuthorityV1 } from "../src/ClassicCtoAuthorityV1.sol";
import {
    ClassicInitialBuyCustodyConfig,
    ClassicInitialBuyCustodyMode
} from "../src/ClassicInitialBuyVestingWalletV1.sol";
import { ClassicInitialBuyVestingWalletFactoryV1 } from "../src/ClassicInitialBuyVestingWalletFactoryV1.sol";
import { ClassicLaunchPolicyV1 } from "../src/ClassicLaunchPolicyV1.sol";
import { ClassicPositionPlannerV1 } from "../src/ClassicPositionPlannerV1.sol";
import { ClassicRewardVaultFactoryV1 } from "../src/ClassicRewardVaultFactoryV1.sol";
import { EthCreatorFeeHookFactoryV4 } from "../src/EthCreatorFeeHookFactoryV4.sol";
import { EthCreatorFeeHookV4 } from "../src/EthCreatorFeeHookV4.sol";
import { FeeSplitVaultFactoryV1 } from "../src/FeeSplitVaultFactoryV1.sol";
import { LockedPositionFeeForwarderFactoryV1 } from "../src/LockedPositionFeeForwarderFactoryV1.sol";
import { MemeLaunchV3 } from "../src/MemeLaunchV3.sol";
import { MemeLaunchV4 } from "../src/MemeLaunchV4.sol";

contract MemeLaunchV4Test is Deployers {
    using PositionInfoLibrary for PositionInfo;
    using StateLibrary for IPoolManager;

    address internal constant CANONICAL_POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address internal constant CANONICAL_POSITION_MANAGER = 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e;
    uint256 internal constant MIN_INITIAL_BUY_WEI = 0.0006 ether;

    bytes32 private constant TOKEN_LAUNCHED_EVENT = keccak256(
        "MemeTokenLaunchedV2(address,address,bytes32,address,address,address,uint256,uint16,uint16,bytes32,bytes32)"
    );
    bytes32 private constant INITIAL_BUY_CUSTODY_EVENT =
        keccak256("MemeCreatorInitialBuyCustodyV2(address,address,address,uint8,uint16,uint16,bytes32,bytes32)");

    struct TokenLaunchEventData {
        address deployer;
        address token;
        bytes32 poolId;
        address feeHook;
        address rewardVault;
        address positionRecipient;
        uint256 positionTokenId;
        uint16 buySwapFeeBps;
        uint16 sellSwapFeeBps;
        bytes32 rewardConfigurationHash;
        bytes32 launchHash;
    }

    struct TokenLaunchEventBody {
        address feeHook;
        address rewardVault;
        address positionRecipient;
        uint256 positionTokenId;
        uint16 buySwapFeeBps;
        uint16 sellSwapFeeBps;
        bytes32 rewardConfigurationHash;
        bytes32 launchHash;
    }

    struct CustodyEventData {
        address deployer;
        address token;
        address custody;
        uint8 mode;
        uint16 durationDays;
        uint16 cliffDays;
        bytes32 configurationHash;
        bytes32 launchHash;
    }

    struct BranchOutcome {
        address token;
        address positionRecipient;
        bytes32 launchHash;
        bytes32 resultHash;
        uint256 actualPositionTokenId;
        address actualCustody;
        uint256 initialBuyTokenAmount;
    }

    struct PositionEconomics {
        bytes32 poolId;
        uint256 liquidity;
        int24 tickLower;
        int24 tickUpper;
        uint160 sqrtPriceX96;
    }

    struct FeeDisclosure {
        uint16 buySwapFeeBps;
        uint16 sellSwapFeeBps;
        uint16 buyCreatorFeeBps;
        uint16 sellCreatorFeeBps;
        uint16 launcherFeeBps;
        uint16 transferTaxBps;
        uint24 lpFeePips;
        address rewardVault;
    }

    PositionManager internal positionManager;
    UERC20Factory internal tokenFactory;
    EthCreatorFeeHookFactoryV4 internal hookFactory;
    EthCreatorFeeHookV4 internal feeHook;
    ClassicPositionPlannerV1 internal positionPlanner;
    ClassicRewardVaultFactoryV1 internal vaultFactory;
    ClassicInitialBuyVestingWalletFactoryV1 internal initialBuyVestingWalletFactory;
    ClassicLaunchPolicyV1 internal launchPolicy;
    LockedPositionFeeForwarderFactoryV1 internal positionForwarderFactory;
    MemeLaunchV3 internal legacyLauncher;
    MemeLaunchV4 internal launcher;

    address internal deployer;
    address internal treasury;

    error ExpectedEventMissing(bytes32 signature);

    function setUp() public {
        deployCodeTo("PoolManager.sol:PoolManager", abi.encode(address(this)), CANONICAL_POOL_MANAGER);
        manager = IPoolManager(CANONICAL_POOL_MANAGER);
        deployCodeTo(
            "PositionManager.sol:PositionManager",
            abi.encode(manager, address(0), uint256(0), address(0), address(0)),
            CANONICAL_POSITION_MANAGER
        );
        positionManager = PositionManager(payable(CANONICAL_POSITION_MANAGER));

        tokenFactory = new UERC20Factory();
        hookFactory = new EthCreatorFeeHookFactoryV4();
        ClassicCtoAuthorityV1 ctoAuthority = new ClassicCtoAuthorityV1(makeAddr("ctoController"));
        vaultFactory = new ClassicRewardVaultFactoryV1(ctoAuthority);
        initialBuyVestingWalletFactory = new ClassicInitialBuyVestingWalletFactoryV1();
        launchPolicy = new ClassicLaunchPolicyV1();
        positionPlanner = new ClassicPositionPlannerV1();
        positionForwarderFactory = new LockedPositionFeeForwarderFactoryV1(positionManager);
        treasury = makeAddr("programmableTreasury");
        feeHook = _deployHook();
        legacyLauncher = new MemeLaunchV3(
            manager,
            positionManager,
            tokenFactory,
            feeHook,
            positionPlanner,
            vaultFactory,
            initialBuyVestingWalletFactory,
            launchPolicy,
            positionForwarderFactory
        );
        launcher = new MemeLaunchV4(
            manager,
            positionManager,
            tokenFactory,
            feeHook,
            positionPlanner,
            vaultFactory,
            initialBuyVestingWalletFactory,
            launchPolicy,
            positionForwarderFactory
        );

        deployer = makeAddr("deployer");
        vm.deal(deployer, 30 ether);
        vm.warp(1_800_000_000);
    }

    function test_returnSentinelsPreserveActualEventStorageAndNftOwnership() public {
        MemeLaunchV4.LaunchParameters memory parameters = _v4Parameters(bytes32("truthful-values"));
        uint256 nextTokenIdBefore = positionManager.nextTokenId();

        vm.recordLogs();
        MemeLaunchV4.LaunchResult memory result = _launchV4(parameters, MIN_INITIAL_BUY_WEI);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        uint256 actualPositionTokenId = launcher.positionTokenIdOf(result.token);
        address actualCustody = launcher.initialBuyCustodyOf(result.token);
        TokenLaunchEventData memory tokenEvent = _tokenLaunchEvent(logs);
        CustodyEventData memory custodyEvent = _custodyEvent(logs);

        assertEq(result.positionTokenId, 0);
        assertEq(result.initialBuyCustody, address(0));
        assertGt(actualPositionTokenId, 0);
        assertEq(actualPositionTokenId, nextTokenIdBefore);
        assertEq(positionManager.nextTokenId(), nextTokenIdBefore + 1);
        assertEq(actualCustody, address(0));
        assertEq(launcher.launchHashOf(result.token), result.launchHash);
        assertEq(launcher.rewardVaultOf(result.token), result.rewardVault);
        assertEq(IERC721(address(positionManager)).ownerOf(actualPositionTokenId), result.positionRecipient);
        assertEq(IERC20(result.token).balanceOf(deployer), result.initialBuyTokenAmount);

        assertEq(tokenEvent.deployer, deployer);
        assertEq(tokenEvent.token, result.token);
        assertEq(tokenEvent.poolId, result.poolId);
        assertEq(tokenEvent.feeHook, address(feeHook));
        assertEq(tokenEvent.rewardVault, result.rewardVault);
        assertEq(tokenEvent.positionRecipient, result.positionRecipient);
        assertEq(tokenEvent.positionTokenId, actualPositionTokenId);
        assertEq(tokenEvent.buySwapFeeBps, parameters.buySwapFeeBps);
        assertEq(tokenEvent.sellSwapFeeBps, parameters.sellSwapFeeBps);
        assertEq(tokenEvent.rewardConfigurationHash, vaultFactory.configurationHashOf(result.rewardVault));
        assertEq(tokenEvent.launchHash, result.launchHash);

        assertEq(custodyEvent.deployer, deployer);
        assertEq(custodyEvent.token, result.token);
        assertEq(custodyEvent.custody, actualCustody);
        assertEq(custodyEvent.mode, uint8(parameters.initialBuyCustody.mode));
        assertEq(custodyEvent.durationDays, parameters.initialBuyCustody.durationDays);
        assertEq(custodyEvent.cliffDays, parameters.initialBuyCustody.cliffDays);
        assertTrue(custodyEvent.configurationHash != bytes32(0));
        assertEq(custodyEvent.launchHash, result.launchHash);
    }

    function test_launchHashIsStableAcrossTimestampAndNextTokenIdDrift() public {
        MemeLaunchV4.LaunchParameters memory parameters = _v4Parameters(bytes32("stable-authorization"));
        uint256 baselineTimestamp = block.timestamp;
        uint256 baseline = vm.snapshotState();

        BranchOutcome memory direct = _launchAndCaptureBranch(parameters);

        assertTrue(vm.revertToState(baseline));
        vm.warp(baselineTimestamp + 7 days);
        _launchV3(_v3Parameters(bytes32("unrelated-v3-launch")), MIN_INITIAL_BUY_WEI);
        BranchOutcome memory drifted = _launchAndCaptureBranch(parameters);

        assertEq(direct.token, drifted.token);
        assertEq(direct.positionRecipient, drifted.positionRecipient);
        assertEq(direct.launchHash, drifted.launchHash);
        assertEq(direct.resultHash, drifted.resultHash);
        assertEq(direct.initialBuyTokenAmount, drifted.initialBuyTokenAmount);
        assertEq(drifted.actualPositionTokenId, direct.actualPositionTokenId + 1);
        assertEq(direct.actualCustody, address(0));
        assertEq(drifted.actualCustody, address(0));
    }

    function test_rejectsLockedCustodyBeforeTokenPoolOrPositionCreation() public {
        MemeLaunchV4.LaunchParameters memory parameters = _v4Parameters(bytes32("locked-custody"));
        parameters.initialBuyCustody = ClassicInitialBuyCustodyConfig({
            mode: ClassicInitialBuyCustodyMode.FixedLock, durationDays: 30, cliffDays: 0
        });
        _assertCustodyPreflightRejects(parameters);
    }

    function test_rejectsNonzeroUnlockedScheduleBeforeTokenPoolOrPositionCreation() public {
        MemeLaunchV4.LaunchParameters memory parameters = _v4Parameters(bytes32("invalid-unlocked-custody"));
        parameters.initialBuyCustody = ClassicInitialBuyCustodyConfig({
            mode: ClassicInitialBuyCustodyMode.Unlocked, durationDays: 1, cliffDays: 1
        });
        _assertCustodyPreflightRejects(parameters);
    }

    function test_postMintProofRejectsWrongPositionOwnerAtomically() public {
        MemeLaunchV4.LaunchParameters memory parameters = _v4Parameters(bytes32("wrong-owner"));
        (address predictedToken,) =
            launcher.predictTokenAddress(parameters.name, parameters.symbol, deployer, parameters.creatorSalt);
        uint256 positionTokenId = positionManager.nextTokenId();
        address expectedOwner = _predictedPositionRecipient(predictedToken);
        address wrongOwner = makeAddr("wrongPositionOwner");
        vm.mockCall(
            address(positionManager),
            abi.encodeWithSelector(IERC721.ownerOf.selector, positionTokenId),
            abi.encode(wrongOwner)
        );

        _assertPostMintProofRejects(
            parameters,
            abi.encodeWithSelector(
                MemeLaunchV4.InvalidPositionOwner.selector, positionTokenId, wrongOwner, expectedOwner
            )
        );
    }

    function test_postMintProofRejectsWrongPositionPoolAtomically() public {
        MemeLaunchV4.LaunchParameters memory parameters = _v4Parameters(bytes32("wrong-pool"));
        (address predictedToken,) =
            launcher.predictTokenAddress(parameters.name, parameters.symbol, deployer, parameters.creatorSalt);
        uint256 positionTokenId = positionManager.nextTokenId();
        PoolKey memory expectedKey = launcher.poolKey(predictedToken);
        bytes32 expectedPoolId = PoolId.unwrap(expectedKey.toId());
        PoolKey memory wrongKey = expectedKey;
        wrongKey.tickSpacing = expectedKey.tickSpacing + 200;
        PositionInfo wrongInfo =
            PositionInfoLibrary.initialize(wrongKey, positionPlanner.LIQUIDITY_TICK_LOWER(), launcher.INITIAL_TICK());
        vm.mockCall(
            address(positionManager),
            abi.encodeWithSelector(PositionManager.getPoolAndPositionInfo.selector, positionTokenId),
            abi.encode(wrongKey, wrongInfo)
        );

        _assertPostMintProofRejects(
            parameters,
            abi.encodeWithSelector(
                MemeLaunchV4.InvalidPositionPool.selector,
                positionTokenId,
                PoolId.unwrap(wrongKey.toId()),
                expectedPoolId
            )
        );
    }

    function test_postMintProofRejectsWrongPositionTicksAtomically() public {
        MemeLaunchV4.LaunchParameters memory parameters = _v4Parameters(bytes32("wrong-ticks"));
        (address predictedToken,) =
            launcher.predictTokenAddress(parameters.name, parameters.symbol, deployer, parameters.creatorSalt);
        uint256 positionTokenId = positionManager.nextTokenId();
        PoolKey memory expectedKey = launcher.poolKey(predictedToken);
        int24 expectedTickLower = positionPlanner.LIQUIDITY_TICK_LOWER();
        int24 expectedTickUpper = launcher.INITIAL_TICK();
        int24 wrongTickLower = expectedTickLower - 200;
        PositionInfo wrongInfo = PositionInfoLibrary.initialize(expectedKey, wrongTickLower, expectedTickUpper);
        vm.mockCall(
            address(positionManager),
            abi.encodeWithSelector(PositionManager.getPoolAndPositionInfo.selector, positionTokenId),
            abi.encode(expectedKey, wrongInfo)
        );

        _assertPostMintProofRejects(
            parameters,
            abi.encodeWithSelector(
                MemeLaunchV4.InvalidPositionTicks.selector,
                positionTokenId,
                wrongTickLower,
                expectedTickUpper,
                expectedTickLower,
                expectedTickUpper
            )
        );
    }

    function test_postMintProofRejectsWrongPositionLiquidityAtomically() public {
        MemeLaunchV4.LaunchParameters memory parameters = _v4Parameters(bytes32("wrong-liquidity"));
        (address predictedToken,) =
            launcher.predictTokenAddress(parameters.name, parameters.symbol, deployer, parameters.creatorSalt);
        uint256 positionTokenId = positionManager.nextTokenId();
        PoolKey memory expectedKey = launcher.poolKey(predictedToken);
        (, Position memory expectedPosition,) =
            positionPlanner.buildOneSidedPlan(expectedKey, _predictedPositionRecipient(predictedToken));
        uint128 expectedLiquidity = uint128(expectedPosition.liquidity);
        uint128 wrongLiquidity = expectedLiquidity - 1;
        vm.mockCall(
            address(positionManager),
            abi.encodeWithSelector(PositionManager.getPositionLiquidity.selector, positionTokenId),
            abi.encode(wrongLiquidity)
        );

        _assertPostMintProofRejects(
            parameters,
            abi.encodeWithSelector(
                MemeLaunchV4.InvalidPositionLiquidity.selector, positionTokenId, wrongLiquidity, expectedLiquidity
            )
        );
    }

    function test_v4PreservesV3FeesAndLiquidityEconomics() public {
        uint256 launchValue = 0.2 ether;
        uint256 baseline = vm.snapshotState();
        MemeLaunchV3.LaunchParameters memory v3Parameters = _v3Parameters(bytes32("economics"));
        v3Parameters.buySwapFeeBps = 250;
        v3Parameters.sellSwapFeeBps = 500;

        MemeLaunchV3.LaunchResult memory v3Result = _launchV3(v3Parameters, launchValue);
        PositionEconomics memory v3Position = _positionEconomics(v3Result.positionTokenId, v3Result.poolId);
        FeeDisclosure memory v3Fees = _feeDisclosure(v3Result.poolId);
        uint256 v3LauncherFees = feeHook.launcherFeesAccrued();
        uint256 v3TotalNativeFees = feeHook.totalNativeFeesAccrued();

        assertTrue(vm.revertToState(baseline));
        MemeLaunchV4.LaunchParameters memory v4Parameters = _v4Parameters(bytes32("economics"));
        v4Parameters.buySwapFeeBps = v3Parameters.buySwapFeeBps;
        v4Parameters.sellSwapFeeBps = v3Parameters.sellSwapFeeBps;

        MemeLaunchV4.LaunchResult memory v4Result = _launchV4(v4Parameters, launchValue);
        uint256 v4PositionTokenId = launcher.positionTokenIdOf(v4Result.token);
        PositionEconomics memory v4Position = _positionEconomics(v4PositionTokenId, v4Result.poolId);
        FeeDisclosure memory v4Fees = _feeDisclosure(v4Result.poolId);

        assertEq(v4Result.tokenLiquidityAmount, v3Result.tokenLiquidityAmount);
        assertEq(v4Result.lockedTokenDust, v3Result.lockedTokenDust);
        assertEq(v4Result.initialBuyNativeAmount, v3Result.initialBuyNativeAmount);
        assertEq(v4Result.initialBuyTokenAmount, v3Result.initialBuyTokenAmount);
        assertEq(v4Result.tokenLiquidityAmount + v4Result.lockedTokenDust, launcher.TOKEN_SUPPLY());
        assertEq(v3Result.tokenLiquidityAmount + v3Result.lockedTokenDust, legacyLauncher.TOKEN_SUPPLY());

        assertEq(v4Position.liquidity, v3Position.liquidity);
        assertEq(v4Position.tickLower, v3Position.tickLower);
        assertEq(v4Position.tickUpper, v3Position.tickUpper);
        assertEq(v4Position.sqrtPriceX96, v3Position.sqrtPriceX96);
        assertEq(v4Position.tickLower, positionPlanner.LIQUIDITY_TICK_LOWER());
        assertEq(v4Position.tickUpper, launcher.INITIAL_TICK());

        assertEq(v4Fees.buySwapFeeBps, v3Fees.buySwapFeeBps);
        assertEq(v4Fees.sellSwapFeeBps, v3Fees.sellSwapFeeBps);
        assertEq(v4Fees.buyCreatorFeeBps, v3Fees.buyCreatorFeeBps);
        assertEq(v4Fees.sellCreatorFeeBps, v3Fees.sellCreatorFeeBps);
        assertEq(v4Fees.launcherFeeBps, v3Fees.launcherFeeBps);
        assertEq(v4Fees.transferTaxBps, v3Fees.transferTaxBps);
        assertEq(v4Fees.lpFeePips, v3Fees.lpFeePips);
        assertEq(v4Fees.rewardVault, v4Result.rewardVault);
        assertEq(v3Fees.rewardVault, v3Result.rewardVault);
        assertEq(v4Fees.buyCreatorFeeBps, 240);
        assertEq(v4Fees.sellCreatorFeeBps, 490);
        assertEq(v4Fees.launcherFeeBps, 10);
        assertEq(v4Fees.transferTaxBps, 0);
        assertEq(v4Fees.lpFeePips, 0);
        assertEq(feeHook.launcherFeesAccrued(), v3LauncherFees);
        assertEq(feeHook.totalNativeFeesAccrued(), v3TotalNativeFees);
        assertGt(v3LauncherFees, 0);
        assertGt(v3TotalNativeFees, 0);
    }

    function _launchAndCaptureBranch(MemeLaunchV4.LaunchParameters memory parameters)
        private
        returns (BranchOutcome memory outcome)
    {
        MemeLaunchV4.LaunchResult memory result = _launchV4(parameters, MIN_INITIAL_BUY_WEI);
        outcome.token = result.token;
        outcome.positionRecipient = result.positionRecipient;
        outcome.launchHash = result.launchHash;
        outcome.resultHash = keccak256(abi.encode(result));
        outcome.actualPositionTokenId = launcher.positionTokenIdOf(result.token);
        outcome.actualCustody = launcher.initialBuyCustodyOf(result.token);
        outcome.initialBuyTokenAmount = result.initialBuyTokenAmount;
        assertEq(result.positionTokenId, 0);
        assertEq(result.initialBuyCustody, address(0));
    }

    function _assertCustodyPreflightRejects(MemeLaunchV4.LaunchParameters memory parameters) private {
        (address predictedToken,) =
            launcher.predictTokenAddress(parameters.name, parameters.symbol, deployer, parameters.creatorSalt);
        uint256 nextTokenIdBefore = positionManager.nextTokenId();
        uint256 launcherFeesBefore = feeHook.launcherFeesAccrued();
        uint256 nativeFeesBefore = feeHook.totalNativeFeesAccrued();

        vm.deal(launcher.ROUTER(), MIN_INITIAL_BUY_WEI);
        vm.prank(launcher.ROUTER());
        vm.expectRevert(
            abi.encodeWithSelector(
                MemeLaunchV4.UnsupportedInitialBuyCustody.selector,
                parameters.initialBuyCustody.mode,
                parameters.initialBuyCustody.durationDays,
                parameters.initialBuyCustody.cliffDays
            )
        );
        launcher.launchFor{ value: MIN_INITIAL_BUY_WEI }(deployer, parameters);

        assertEq(predictedToken.code.length, 0);
        assertEq(positionManager.nextTokenId(), nextTokenIdBefore);
        assertEq(feeHook.launcherFeesAccrued(), launcherFeesBefore);
        assertEq(feeHook.totalNativeFeesAccrued(), nativeFeesBefore);
    }

    function _assertPostMintProofRejects(MemeLaunchV4.LaunchParameters memory parameters, bytes memory expectedRevert)
        private
    {
        (address predictedToken,) =
            launcher.predictTokenAddress(parameters.name, parameters.symbol, deployer, parameters.creatorSalt);
        address predictedRewardVault = launcher.predictRewardVault(
            predictedToken, deployer, parameters.rewardBeneficiaries, parameters.rewardSharesBps
        );
        address predictedPositionRecipient = _predictedPositionRecipient(predictedToken);
        bytes32 predictedPoolId = PoolId.unwrap(launcher.poolKey(predictedToken).toId());
        uint256 nextTokenIdBefore = positionManager.nextTokenId();
        uint256 launcherFeesBefore = feeHook.launcherFeesAccrued();
        uint256 nativeFeesBefore = feeHook.totalNativeFeesAccrued();

        vm.deal(launcher.ROUTER(), MIN_INITIAL_BUY_WEI);
        vm.prank(launcher.ROUTER());
        vm.expectRevert(expectedRevert);
        launcher.launchFor{ value: MIN_INITIAL_BUY_WEI }(deployer, parameters);
        vm.clearMockedCalls();

        (,,,, bool registered,) = feeHook.poolFeeConfig(predictedPoolId);
        assertEq(predictedToken.code.length, 0);
        assertEq(predictedRewardVault.code.length, 0);
        assertEq(predictedPositionRecipient.code.length, 0);
        assertEq(positionManager.nextTokenId(), nextTokenIdBefore);
        assertFalse(registered);
        assertEq(launcher.launchHashOf(predictedToken), bytes32(0));
        assertEq(launcher.positionTokenIdOf(predictedToken), 0);
        assertEq(feeHook.launcherFeesAccrued(), launcherFeesBefore);
        assertEq(feeHook.totalNativeFeesAccrued(), nativeFeesBefore);
    }

    function _predictedPositionRecipient(address token) private view returns (address) {
        bytes32 salt = keccak256(abi.encode("launcher.meme-position.v1", token, deployer));
        return positionForwarderFactory.predict(salt, deployer);
    }

    function _positionEconomics(uint256 positionTokenId, bytes32 expectedPoolId)
        private
        view
        returns (PositionEconomics memory economics)
    {
        (PoolKey memory key, PositionInfo info) = positionManager.getPoolAndPositionInfo(positionTokenId);
        (uint160 sqrtPriceX96,,,) = manager.getSlot0(PoolId.wrap(expectedPoolId));
        economics = PositionEconomics({
            poolId: PoolId.unwrap(key.toId()),
            liquidity: positionManager.getPositionLiquidity(positionTokenId),
            tickLower: info.tickLower(),
            tickUpper: info.tickUpper(),
            sqrtPriceX96: sqrtPriceX96
        });
        assertEq(economics.poolId, expectedPoolId);
    }

    function _feeDisclosure(bytes32 poolId) private view returns (FeeDisclosure memory disclosure) {
        (
            disclosure.buySwapFeeBps,
            disclosure.sellSwapFeeBps,
            disclosure.buyCreatorFeeBps,
            disclosure.sellCreatorFeeBps,
            disclosure.launcherFeeBps,
            disclosure.transferTaxBps,
            disclosure.lpFeePips,
            disclosure.rewardVault
        ) = feeHook.feeDisclosure(poolId);
    }

    function _tokenLaunchEvent(Vm.Log[] memory logs) private view returns (TokenLaunchEventData memory eventData) {
        for (uint256 index; index < logs.length; index++) {
            Vm.Log memory entry = logs[index];
            if (
                entry.emitter != address(launcher) || entry.topics.length != 4
                    || entry.topics[0] != TOKEN_LAUNCHED_EVENT
            ) continue;

            eventData.deployer = _topicAddress(entry.topics[1]);
            eventData.token = _topicAddress(entry.topics[2]);
            eventData.poolId = entry.topics[3];
            TokenLaunchEventBody memory body = abi.decode(entry.data, (TokenLaunchEventBody));
            eventData.feeHook = body.feeHook;
            eventData.rewardVault = body.rewardVault;
            eventData.positionRecipient = body.positionRecipient;
            eventData.positionTokenId = body.positionTokenId;
            eventData.buySwapFeeBps = body.buySwapFeeBps;
            eventData.sellSwapFeeBps = body.sellSwapFeeBps;
            eventData.rewardConfigurationHash = body.rewardConfigurationHash;
            eventData.launchHash = body.launchHash;
            return eventData;
        }
        revert ExpectedEventMissing(TOKEN_LAUNCHED_EVENT);
    }

    function _custodyEvent(Vm.Log[] memory logs) private view returns (CustodyEventData memory eventData) {
        for (uint256 index; index < logs.length; index++) {
            Vm.Log memory entry = logs[index];
            if (
                entry.emitter != address(launcher) || entry.topics.length != 4
                    || entry.topics[0] != INITIAL_BUY_CUSTODY_EVENT
            ) continue;

            eventData.deployer = _topicAddress(entry.topics[1]);
            eventData.token = _topicAddress(entry.topics[2]);
            eventData.custody = _topicAddress(entry.topics[3]);
            (
                eventData.mode,
                eventData.durationDays,
                eventData.cliffDays,
                eventData.configurationHash,
                eventData.launchHash
            ) = abi.decode(entry.data, (uint8, uint16, uint16, bytes32, bytes32));
            return eventData;
        }
        revert ExpectedEventMissing(INITIAL_BUY_CUSTODY_EVENT);
    }

    function _deployHook() private returns (EthCreatorFeeHookV4 deployed) {
        (, bytes32 salt) = HookMiner.find(
            address(hookFactory),
            hookFactory.REQUIRED_HOOK_FLAGS(),
            type(EthCreatorFeeHookV4).creationCode,
            abi.encode(manager, treasury, FeeSplitVaultFactoryV1(address(vaultFactory)))
        );
        deployed = hookFactory.deploy(salt, manager, treasury, FeeSplitVaultFactoryV1(address(vaultFactory)));
    }

    function _launchV4(MemeLaunchV4.LaunchParameters memory parameters, uint256 value)
        private
        returns (MemeLaunchV4.LaunchResult memory result)
    {
        vm.deal(launcher.ROUTER(), value);
        vm.prank(launcher.ROUTER());
        result = launcher.launchFor{ value: value }(deployer, parameters);
    }

    function _launchV3(MemeLaunchV3.LaunchParameters memory parameters, uint256 value)
        private
        returns (MemeLaunchV3.LaunchResult memory result)
    {
        vm.deal(legacyLauncher.ROUTER(), value);
        vm.prank(legacyLauncher.ROUTER());
        result = legacyLauncher.launchFor{ value: value }(deployer, parameters);
    }

    function _v4Parameters(bytes32 salt) private view returns (MemeLaunchV4.LaunchParameters memory parameters) {
        address[] memory beneficiaries = new address[](1);
        beneficiaries[0] = deployer;
        uint16[] memory shares = new uint16[](1);
        shares[0] = 10_000;
        parameters = MemeLaunchV4.LaunchParameters({
            name: "Classic V4 Stability",
            symbol: "C4S",
            buySwapFeeBps: 10,
            sellSwapFeeBps: 10,
            creatorSalt: salt,
            metadata: _metadata(),
            rewardBeneficiaries: beneficiaries,
            rewardSharesBps: shares,
            initialBuyCustody: _unlockedCustody()
        });
    }

    function _v3Parameters(bytes32 salt) private view returns (MemeLaunchV3.LaunchParameters memory parameters) {
        address[] memory beneficiaries = new address[](1);
        beneficiaries[0] = deployer;
        uint16[] memory shares = new uint16[](1);
        shares[0] = 10_000;
        parameters = MemeLaunchV3.LaunchParameters({
            name: "Classic V3 Interference",
            symbol: "C3I",
            buySwapFeeBps: 10,
            sellSwapFeeBps: 10,
            creatorSalt: salt,
            metadata: _metadata(),
            rewardBeneficiaries: beneficiaries,
            rewardSharesBps: shares,
            initialBuyCustody: _unlockedCustody()
        });
    }

    function _metadata() private pure returns (UERC20Metadata memory) {
        return UERC20Metadata({
            description: "Classic launcher stability fixture",
            website: "https://programmable.family",
            image: "ipfs://classic-launcher-stability",
            extraData: bytes("")
        });
    }

    function _unlockedCustody() private pure returns (ClassicInitialBuyCustodyConfig memory) {
        return
            ClassicInitialBuyCustodyConfig({
                mode: ClassicInitialBuyCustodyMode.Unlocked, durationDays: 0, cliffDays: 0
            });
    }

    function _topicAddress(bytes32 topic) private pure returns (address) {
        return address(uint160(uint256(topic)));
    }
}
