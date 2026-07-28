// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";
import { PositionManager } from "@uniswap/v4-periphery/src/PositionManager.sol";
import { IPositionDescriptor } from "@uniswap/v4-periphery/src/interfaces/IPositionDescriptor.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { IWETH9 } from "@uniswap/v4-periphery/src/interfaces/external/IWETH9.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { IAllowanceTransfer } from "permit2/src/interfaces/IAllowanceTransfer.sol";

import { FeeSplitVaultFactoryV1 } from "../../src/FeeSplitVaultFactoryV1.sol";
import { LiquidityGrowthFeeOracleHookFactoryV1 } from "../../src/LiquidityGrowthFeeOracleHookFactoryV1.sol";
import { LiquidityGrowthFeeOracleHookV1 } from "../../src/LiquidityGrowthFeeOracleHookV1.sol";
import { LiquidityGrowthFullRangeAutomationV1 } from "../../src/LiquidityGrowthFullRangeAutomationV1.sol";
import { LiquidityGrowthFullRangeLaunchV1 } from "../../src/LiquidityGrowthFullRangeLaunchV1.sol";
import { LiquidityGrowthFullRangeVaultFactoryV1 } from "../../src/LiquidityGrowthFullRangeVaultFactoryV1.sol";
import { LiquidityGrowthFullRangeVaultV1 } from "../../src/LiquidityGrowthFullRangeVaultV1.sol";
import { LiquidityGrowthRangeSourceFactoryV1 } from "../../src/LiquidityGrowthRangeSourceFactoryV1.sol";
import { LockedPositionFeeForwarderFactoryV1 } from "../../src/LockedPositionFeeForwarderFactoryV1.sol";
import { ILiquidityGrowthFullRangeOracleHookV1 } from "../../src/interfaces/ILiquidityGrowthFullRangeOracleHookV1.sol";

/// @notice Shared end-to-end fixture for Full-Range V1 unit, adversarial and gas tests.
abstract contract LiquidityGrowthFullRangeFixture is Deployers {
    using StateLibrary for IPoolManager;

    uint256 internal constant INITIAL_BUY = 0.0006 ether;
    int24 internal constant MAX_ABS_TICK_DELTA = 400;
    uint32 internal constant TWAP_WINDOW = 30 minutes;

    IPositionManager internal positionManager;
    UERC20Factory internal tokenFactory;
    FeeSplitVaultFactoryV1 internal splitFactory;
    LiquidityGrowthRangeSourceFactoryV1 internal rangeSourceFactory;
    LockedPositionFeeForwarderFactoryV1 internal positionForwarderFactory;
    LiquidityGrowthFeeOracleHookFactoryV1 internal hookFactory;
    LiquidityGrowthFeeOracleHookV1 internal hook;
    LiquidityGrowthFullRangeVaultFactoryV1 internal fullRangeVaultFactory;
    LiquidityGrowthFullRangeLaunchV1 internal fullRangeLauncher;
    LiquidityGrowthFullRangeAutomationV1 internal fullRangeAutomation;

    address internal creator;
    address internal beneficiary;
    address internal treasury;

    function setUp() public virtual {
        deployFreshManagerAndRouters();
        positionManager = IPositionManager(
            address(
                new PositionManager(
                    manager,
                    IAllowanceTransfer(address(0)),
                    uint256(0),
                    IPositionDescriptor(address(0)),
                    IWETH9(address(0))
                )
            )
        );

        tokenFactory = new UERC20Factory();
        splitFactory = new FeeSplitVaultFactoryV1();
        rangeSourceFactory = new LiquidityGrowthRangeSourceFactoryV1();
        positionForwarderFactory = new LockedPositionFeeForwarderFactoryV1(positionManager);
        hookFactory = new LiquidityGrowthFeeOracleHookFactoryV1();
        treasury = makeAddr("fullRangeTreasury");
        hook = _deployFullRangeHook();
        fullRangeVaultFactory = new LiquidityGrowthFullRangeVaultFactoryV1(
            hookFactory, splitFactory, positionManager, positionForwarderFactory, rangeSourceFactory
        );
        fullRangeLauncher = new LiquidityGrowthFullRangeLaunchV1(
            manager,
            positionManager,
            tokenFactory,
            ILiquidityGrowthFullRangeOracleHookV1(address(hook)),
            splitFactory,
            rangeSourceFactory,
            fullRangeVaultFactory,
            positionForwarderFactory
        );
        fullRangeAutomation = fullRangeLauncher.automation();

        creator = makeAddr("fullRangeCreator");
        beneficiary = makeAddr("fullRangeBeneficiary");
        vm.deal(creator, 100 ether);
        vm.deal(address(this), 100 ether);
    }

    function _launchFullRange(bytes32 salt)
        internal
        returns (
            LiquidityGrowthFullRangeLaunchV1.LaunchResult memory result,
            PoolKey memory key,
            LiquidityGrowthFullRangeVaultV1 vault
        )
    {
        LiquidityGrowthFullRangeLaunchV1.LaunchParameters memory parameters = _fullRangeParameters(salt);
        vm.prank(creator);
        result = fullRangeLauncher.launch{ value: INITIAL_BUY }(parameters);
        key = _fullRangePoolKey(result.token);
        vault = LiquidityGrowthFullRangeVaultV1(payable(result.growthVault));
    }

    function _fullRangeParameters(bytes32 salt)
        internal
        view
        returns (LiquidityGrowthFullRangeLaunchV1.LaunchParameters memory parameters)
    {
        address[] memory beneficiaries = new address[](2);
        beneficiaries[0] = creator;
        beneficiaries[1] = beneficiary;
        uint16[] memory shares = new uint16[](2);
        shares[0] = 7000;
        shares[1] = 3000;
        parameters = LiquidityGrowthFullRangeLaunchV1.LaunchParameters({
            name: "Full Range Growth",
            symbol: "FULL",
            buySwapFeeBps: 200,
            sellSwapFeeBps: 500,
            creatorSalt: salt,
            metadata: UERC20Metadata({
                description: "Full Range V1 test fixture",
                website: "https://programmable.family",
                image: "ipfs://full-range",
                extraData: abi.encode("https://x.com/0xprogrammable")
            }),
            rewardBeneficiaries: beneficiaries,
            rewardSharesBps: shares
        });
    }

    function _fullRangePoolKey(address token) internal view returns (PoolKey memory key) {
        key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(token),
            fee: fullRangeLauncher.LP_FEE_PIPS(),
            tickSpacing: fullRangeLauncher.TICK_SPACING(),
            hooks: hook
        });
    }

    function _stageFullRangeOracle(address vaultAddress) internal {
        uint16 target = fullRangeAutomation.OBSERVATION_CARDINALITY_TARGET();
        bytes32 id = LiquidityGrowthFullRangeVaultV1(payable(vaultAddress)).poolId();
        (,, uint16 next) = hook.stateById(PoolId.wrap(id));
        for (uint256 stage; stage < 16 && next < target; stage++) {
            (bool grew,, uint16 stagedNext) = fullRangeAutomation.stageOracle(vaultAddress);
            assertTrue(grew);
            next = stagedNext;
        }
        assertEq(next, target);
    }

    function _matureFullRangeOracle(PoolKey memory key) internal {
        // The shared oracle deliberately truncates each recorded movement to 400 ticks. Give it enough real writes
        // to converge after the fixture's fee-seeding swap before starting the full 30-minute history window.
        for (uint256 write; write < 16; write++) {
            vm.warp(block.timestamp + 1);
            vm.roll(block.number + 1);
            swap(key, true, -int256(0.000_001 ether), "");
        }
        vm.warp(block.timestamp + TWAP_WINDOW);
        vm.roll(block.number + 150);
    }

    function _seedFullRangeCreatorFees(PoolKey memory key, uint256 nativeIn) internal {
        swap(key, true, -int256(nativeIn), "");
    }

    function _deployFullRangeHook() internal returns (LiquidityGrowthFeeOracleHookV1 deployed) {
        (, bytes32 salt) = HookMiner.find(
            address(hookFactory),
            hookFactory.REQUIRED_HOOK_FLAGS(),
            type(LiquidityGrowthFeeOracleHookV1).creationCode,
            abi.encode(manager, treasury, splitFactory, MAX_ABS_TICK_DELTA)
        );
        deployed = hookFactory.deploy(salt, manager, treasury, splitFactory, MAX_ABS_TICK_DELTA);
    }

    function _reserveAccounting(LiquidityGrowthFullRangeVaultV1 vault)
        internal
        view
        returns (uint256 remaining, uint256 consumed)
    {
        remaining = IERC20(vault.token()).balanceOf(address(vault));
        consumed = vault.totalTokenAddedToLiquidity();
    }
}
