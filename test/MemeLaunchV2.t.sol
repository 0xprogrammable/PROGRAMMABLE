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
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";
import { PositionManager } from "@uniswap/v4-periphery/src/PositionManager.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

import { ClassicCtoAuthorityV1 } from "../src/ClassicCtoAuthorityV1.sol";
import {
    ClassicInitialBuyCustodyConfig,
    ClassicInitialBuyCustodyMode,
    ClassicInitialBuyVestingWalletV1
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
import { IClassicCtoVaultV1 } from "../src/interfaces/IClassicCtoVaultV1.sol";
import { IClassicFeeHookV3 } from "../src/interfaces/IClassicFeeHookV3.sol";

contract MemeLaunchV2Test is Deployers {
    address internal constant CANONICAL_POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address internal constant CANONICAL_POSITION_MANAGER = 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e;
    uint256 internal constant MIN_INITIAL_BUY_WEI = 0.0006 ether;

    PositionManager internal positionManager;
    UERC20Factory internal tokenFactory;
    EthCreatorFeeHookFactoryV3 internal hookFactory;
    EthCreatorFeeHookV3 internal feeHook;
    ClassicCtoAuthorityV1 internal ctoAuthority;
    ClassicRewardVaultFactoryV1 internal vaultFactory;
    ClassicInitialBuyVestingWalletFactoryV1 internal initialBuyVestingWalletFactory;
    ClassicLaunchPolicyV1 internal launchPolicy;
    LockedPositionFeeForwarderFactoryV1 internal positionForwarderFactory;
    MemeLaunchV2 internal launcher;

    address internal deployer;
    address internal externalBeneficiary;
    address internal treasury;
    address internal ctoController;

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
        hookFactory = new EthCreatorFeeHookFactoryV3();
        ctoController = makeAddr("ctoController");
        ctoAuthority = new ClassicCtoAuthorityV1(ctoController);
        vaultFactory = new ClassicRewardVaultFactoryV1(ctoAuthority);
        initialBuyVestingWalletFactory = new ClassicInitialBuyVestingWalletFactoryV1();
        launchPolicy = new ClassicLaunchPolicyV1();
        positionForwarderFactory = new LockedPositionFeeForwarderFactoryV1(positionManager);
        treasury = makeAddr("programmableTreasury");
        feeHook = _deployHook();
        launcher = new MemeLaunchV2(
            manager,
            positionManager,
            tokenFactory,
            feeHook,
            vaultFactory,
            initialBuyVestingWalletFactory,
            launchPolicy,
            positionForwarderFactory
        );

        deployer = makeAddr("deployer");
        externalBeneficiary = makeAddr("externalBeneficiary");
        vm.deal(deployer, 10 ether);
    }

    function test_launchWalletAsSoleBeneficiaryPreservesLockedClassicLifecycle() public {
        MemeLaunchV2.LaunchResult memory result =
            _launch(_parameters(bytes32("deployer-only"), _addresses1(deployer), _shares1(10_000)));
        PoolKey memory key = launcher.poolKey(result.token);
        ClassicRewardVaultV1 vault = ClassicRewardVaultV1(payable(result.rewardVault));
        PositionFeesForwarder forwarder = PositionFeesForwarder(payable(result.positionRecipient));

        assertEq(result.poolId, PoolId.unwrap(key.toId()));
        assertEq(launcher.rewardVaultOf(result.token), result.rewardVault);
        assertEq(launcher.launchHashOf(result.token), result.launchHash);
        assertEq(vault.beneficiaryCount(), 1);
        assertEq(vault.beneficiaryAt(0), deployer);
        assertEq(vault.shareBpsOf(deployer), 10_000);

        assertEq(IERC20(result.token).totalSupply(), launcher.TOKEN_SUPPLY());
        assertEq(IERC20(result.token).balanceOf(deployer), result.initialBuyTokenAmount);
        assertEq(IERC20(result.token).balanceOf(address(launcher)), 0);
        assertEq(IERC20(result.token).balanceOf(address(positionManager)), 0);
        assertEq(result.tokenLiquidityAmount + result.lockedTokenDust, launcher.TOKEN_SUPPLY());
        assertEq(IERC721(address(positionManager)).ownerOf(result.positionTokenId), result.positionRecipient);
        assertEq(UERC20(result.token).creator(), address(launcher));

        assertEq(forwarder.operator(), address(0));
        assertEq(forwarder.timelockBlockNumber(), type(uint256).max);
        assertEq(forwarder.feeRecipient(), deployer);
        vm.expectRevert(ITimelockedPositionRecipient.Timelocked.selector);
        forwarder.approveOperator();
    }

    function test_externalBeneficiaryNeedsNoAcceptanceAndAloneCanClaim() public {
        MemeLaunchV2.LaunchResult memory result =
            _launch(_parameters(bytes32("external"), _addresses1(externalBeneficiary), _shares1(10_000)));
        ClassicRewardVaultV1 vault = ClassicRewardVaultV1(payable(result.rewardVault));
        uint256 accrued = _creatorAccrued(result.poolId);

        vm.prank(deployer);
        vm.expectRevert(abi.encodeWithSelector(ClassicRewardVaultV1.NoFeesToClaim.selector, deployer));
        vault.claim();

        uint256 beforeBalance = externalBeneficiary.balance;
        vm.prank(externalBeneficiary);
        assertEq(vault.claim(), accrued);
        assertEq(externalBeneficiary.balance, beforeBalance + accrued);
    }

    function test_splitLaunchStoresUniqueSharesAndDirectionalFees() public {
        address bob = makeAddr("bob");
        address carol = makeAddr("carol");
        MemeLaunchV2.LaunchParameters memory parameters =
            _parameters(bytes32("split"), _addresses3(externalBeneficiary, bob, carol), _shares3(2000, 3000, 5000));
        parameters.buySwapFeeBps = 300;
        parameters.sellSwapFeeBps = 900;
        MemeLaunchV2.LaunchResult memory result = _launch(parameters);
        ClassicRewardVaultV1 vault = ClassicRewardVaultV1(payable(result.rewardVault));

        assertEq(vault.shareBpsOf(externalBeneficiary), 2000);
        assertEq(vault.shareBpsOf(bob), 3000);
        assertEq(vault.shareBpsOf(carol), 5000);
        (,, uint16 buy, uint16 sell, bool registered,) = feeHook.poolFeeConfig(result.poolId);
        assertTrue(registered);
        assertEq(buy, 300);
        assertEq(sell, 900);
    }

    function test_supportsFiveBeneficiariesAtLaunch() public {
        address[] memory beneficiaries = new address[](5);
        uint16[] memory shares = new uint16[](5);
        for (uint256 index; index < 5; index++) {
            beneficiaries[index] = makeAddr(string.concat("beneficiary", vm.toString(index)));
            shares[index] = index == 4 ? 6000 : 1000;
        }

        MemeLaunchV2.LaunchResult memory result = _launch(_parameters(bytes32("five"), beneficiaries, shares));
        assertEq(ClassicRewardVaultV1(payable(result.rewardVault)).beneficiaryCount(), 5);
    }

    function test_rejectsInvalidRewardConfigurationsBeforeTokenCreation() public {
        MemeLaunchV2.LaunchParameters memory parameters = _parameters(
            bytes32("invalid"), _addresses2(externalBeneficiary, externalBeneficiary), _shares2(5000, 5000)
        );
        (address predicted,) =
            launcher.predictTokenAddress(parameters.name, parameters.symbol, deployer, parameters.creatorSalt);
        vm.prank(deployer);
        vm.expectRevert(
            abi.encodeWithSelector(ClassicLaunchPolicyV1.DuplicateRewardBeneficiary.selector, externalBeneficiary)
        );
        launcher.launch{ value: MIN_INITIAL_BUY_WEI }(parameters);
        assertEq(predicted.code.length, 0);

        parameters = _parameters(
            bytes32("bad-total"), _addresses2(externalBeneficiary, makeAddr("bob")), _shares2(4000, 5000)
        );
        vm.prank(deployer);
        vm.expectRevert(abi.encodeWithSelector(ClassicLaunchPolicyV1.InvalidRewardShareTotal.selector, 9000));
        launcher.launch{ value: MIN_INITIAL_BUY_WEI }(parameters);

        address[] memory sixBeneficiaries = new address[](6);
        uint16[] memory sixShares = new uint16[](6);
        for (uint256 index; index < 6; index++) {
            sixBeneficiaries[index] = makeAddr(string.concat("tooMany", vm.toString(index)));
            sixShares[index] = index == 5 ? 5000 : 1000;
        }
        parameters = _parameters(bytes32("too-many"), sixBeneficiaries, sixShares);
        vm.prank(deployer);
        vm.expectRevert(abi.encodeWithSelector(ClassicLaunchPolicyV1.InvalidBeneficiaryCount.selector, 6));
        launcher.launch{ value: MIN_INITIAL_BUY_WEI }(parameters);
    }

    function test_changePayoutWalletKeepsUnclaimedEthWithPreviousWallet() public {
        address replacement = makeAddr("replacement");
        MemeLaunchV2.LaunchResult memory result =
            _launch(_parameters(bytes32("payout-change"), _addresses1(externalBeneficiary), _shares1(10_000)));
        ClassicRewardVaultV1 vault = ClassicRewardVaultV1(payable(result.rewardVault));
        uint256 accruedBeforeChange = _creatorAccrued(result.poolId);
        assertGt(accruedBeforeChange, 0);

        vm.prank(externalBeneficiary);
        vault.changePayoutWallet(0, replacement);

        assertEq(vault.beneficiaryAt(0), replacement);
        assertEq(vault.claimable(externalBeneficiary), accruedBeforeChange);
        assertEq(vault.claimable(replacement), 0);

        vm.prank(externalBeneficiary);
        assertEq(vault.claim(), accruedBeforeChange);
        assertEq(externalBeneficiary.balance, accruedBeforeChange);
    }

    function test_approvedCtoChangesOnlyFutureRewardConfiguration() public {
        address bob = makeAddr("bob");
        address ctoRecipient = makeAddr("ctoRecipient");
        MemeLaunchV2.LaunchResult memory result =
            _launch(_parameters(bytes32("cto"), _addresses2(externalBeneficiary, bob), _shares2(3000, 7000)));
        ClassicRewardVaultV1 vault = ClassicRewardVaultV1(payable(result.rewardVault));
        uint256 accruedBeforeCto = _creatorAccrued(result.poolId);
        assertGt(accruedBeforeCto, 0);

        vm.prank(ctoController);
        ctoAuthority.executeCto(
            IClassicCtoVaultV1(address(vault)), _addresses1(ctoRecipient), _shares1(10_000), keccak256("approved-cto")
        );

        assertEq(vault.beneficiaryCount(), 1);
        assertEq(vault.beneficiaryAt(0), ctoRecipient);
        assertEq(vault.claimable(externalBeneficiary) + vault.claimable(bob), accruedBeforeCto);
        assertEq(vault.claimable(ctoRecipient), 0);
    }

    function test_rejectsInvalidDirectionalFeesAtomically() public {
        MemeLaunchV2.LaunchParameters memory parameters =
            _parameters(bytes32("bad-fee"), _addresses1(deployer), _shares1(10_000));
        parameters.buySwapFeeBps = 150;
        (address predicted,) =
            launcher.predictTokenAddress(parameters.name, parameters.symbol, deployer, parameters.creatorSalt);

        vm.prank(deployer);
        vm.expectRevert(abi.encodeWithSelector(EthCreatorFeeHookV3.InvalidTotalSwapFee.selector, 150));
        launcher.launch{ value: MIN_INITIAL_BUY_WEI }(parameters);
        assertEq(predicted.code.length, 0);
    }

    function test_creatorCanChooseLargerInitialBuy() public {
        uint256 largerBuy = 0.002 ether;
        MemeLaunchV2.LaunchParameters memory parameters =
            _parameters(bytes32("large-buy"), _addresses1(deployer), _shares1(10_000));
        vm.prank(deployer);
        MemeLaunchV2.LaunchResult memory result = launcher.launch{ value: largerBuy }(parameters);
        assertEq(result.initialBuyNativeAmount, largerBuy);
        assertGt(result.initialBuyTokenAmount, 0);
    }

    function test_fixedLockRoutesTheEntireInitialBuyDirectlyIntoAuthenticatedCustody() public {
        MemeLaunchV2.LaunchParameters memory parameters =
            _parameters(bytes32("fixed-lock"), _addresses1(deployer), _shares1(10_000));
        parameters.initialBuyCustody = ClassicInitialBuyCustodyConfig({
            mode: ClassicInitialBuyCustodyMode.FixedLock, durationDays: 30, cliffDays: 0
        });

        MemeLaunchV2.LaunchResult memory result = _launch(parameters);
        ClassicInitialBuyVestingWalletV1 custody = ClassicInitialBuyVestingWalletV1(payable(result.initialBuyCustody));

        assertEq(launcher.initialBuyCustodyOf(result.token), address(custody));
        assertEq(IERC20(result.token).balanceOf(deployer), 0);
        assertEq(IERC20(result.token).balanceOf(address(custody)), result.initialBuyTokenAmount);
        assertEq(custody.owner(), deployer);
        assertEq(address(custody.initialBuyToken()), result.token);
        assertEq(custody.start(), block.timestamp + 30 days);

        vm.warp(block.timestamp + 30 days);
        vm.prank(deployer);
        custody.release(result.token);
        assertEq(IERC20(result.token).balanceOf(deployer), result.initialBuyTokenAmount);
    }

    function test_cliffLinearVestingStartsAtZeroAndUsesTheLaunchWalletForever() public {
        uint64 launchTimestamp = uint64(block.timestamp);
        MemeLaunchV2.LaunchParameters memory parameters =
            _parameters(bytes32("cliff-linear"), _addresses1(deployer), _shares1(10_000));
        parameters.initialBuyCustody = ClassicInitialBuyCustodyConfig({
            mode: ClassicInitialBuyCustodyMode.CliffLinearVesting, durationDays: 100, cliffDays: 20
        });

        MemeLaunchV2.LaunchResult memory result = _launch(parameters);
        ClassicInitialBuyVestingWalletV1 custody = ClassicInitialBuyVestingWalletV1(payable(result.initialBuyCustody));
        assertEq(custody.owner(), deployer);
        assertEq(custody.start(), uint256(launchTimestamp) + 20 days);
        assertEq(custody.end(), uint256(launchTimestamp) + 100 days);
        assertEq(custody.releasable(result.token), 0);

        vm.warp(uint256(launchTimestamp) + 60 days);
        assertEq(custody.releasable(result.token), result.initialBuyTokenAmount / 2);
    }

    function test_invalidInitialBuyCustodyRevertsBeforeTokenCreation() public {
        MemeLaunchV2.LaunchParameters memory parameters =
            _parameters(bytes32("invalid-custody"), _addresses1(deployer), _shares1(10_000));
        parameters.initialBuyCustody = ClassicInitialBuyCustodyConfig({
            mode: ClassicInitialBuyCustodyMode.FixedLock, durationDays: 0, cliffDays: 0
        });
        (address predicted,) =
            launcher.predictTokenAddress(parameters.name, parameters.symbol, deployer, parameters.creatorSalt);

        vm.prank(deployer);
        vm.expectRevert();
        launcher.launch{ value: MIN_INITIAL_BUY_WEI }(parameters);
        assertEq(predicted.code.length, 0);
    }

    function test_onlyPoolManagerCanCallInitialBuyUnlockCallback() public {
        vm.expectRevert(abi.encodeWithSelector(MemeLaunchV2.UnauthorizedUnlockCallback.selector, address(this)));
        launcher.unlockCallback("");
    }

    function test_forcedEthCannotBlockFutureLaunchesOrSubsidizeInitialBuy() public {
        uint256 forcedBalance = 1 wei;
        // Models native ETH forced in via SELFDESTRUCT without introducing deprecated test bytecode.
        vm.deal(address(launcher), forcedBalance);
        assertEq(address(launcher).balance, forcedBalance);

        MemeLaunchV2.LaunchResult memory result =
            _launch(_parameters(bytes32("forced-eth"), _addresses1(deployer), _shares1(10_000)));

        assertEq(result.initialBuyNativeAmount, MIN_INITIAL_BUY_WEI);
        assertGt(result.initialBuyTokenAmount, 0);
        assertEq(address(launcher).balance, forcedBalance);
    }

    function test_reusesMatchingPredeployedRewardVaultInsteadOfAllowingMempoolGriefing() public {
        MemeLaunchV2.LaunchParameters memory parameters =
            _parameters(bytes32("predeployed-vault"), _addresses1(externalBeneficiary), _shares1(10_000));
        (address token,) =
            launcher.predictTokenAddress(parameters.name, parameters.symbol, deployer, parameters.creatorSalt);
        PoolKey memory key = launcher.poolKey(token);
        bytes32 poolId = PoolId.unwrap(key.toId());
        bytes32 vaultSalt = keccak256(abi.encode("programmable.classic-reward-vault.v1", token, deployer));
        ClassicRewardVaultV1 predeployed = vaultFactory.deploy(
            vaultSalt,
            IClassicFeeHookV3(address(feeHook)),
            poolId,
            parameters.rewardBeneficiaries,
            parameters.rewardSharesBps
        );

        MemeLaunchV2.LaunchResult memory result = _launch(parameters);
        assertEq(result.rewardVault, address(predeployed));
    }

    function _deployHook() private returns (EthCreatorFeeHookV3 deployed) {
        (, bytes32 salt) = HookMiner.find(
            address(hookFactory),
            hookFactory.REQUIRED_HOOK_FLAGS(),
            type(EthCreatorFeeHookV3).creationCode,
            abi.encode(manager, treasury, FeeSplitVaultFactoryV1(address(vaultFactory)))
        );
        deployed = hookFactory.deploy(salt, manager, treasury, FeeSplitVaultFactoryV1(address(vaultFactory)));
    }

    function _launch(MemeLaunchV2.LaunchParameters memory parameters)
        private
        returns (MemeLaunchV2.LaunchResult memory result)
    {
        vm.prank(deployer);
        result = launcher.launch{ value: MIN_INITIAL_BUY_WEI }(parameters);
    }

    function _parameters(bytes32 salt, address[] memory beneficiaries, uint16[] memory shares)
        private
        pure
        returns (MemeLaunchV2.LaunchParameters memory parameters)
    {
        parameters = MemeLaunchV2.LaunchParameters({
            name: string.concat("Classic ", _hexNibble(uint8(uint256(salt) & 0xf))),
            symbol: string.concat("CV", _hexNibble(uint8(uint256(salt) & 0xf))),
            buySwapFeeBps: 200,
            sellSwapFeeBps: 700,
            creatorSalt: salt,
            metadata: UERC20Metadata({
                description: "Classic lifecycle fixture",
                website: "https://programmable.family",
                image: "ipfs://classic",
                extraData: bytes("")
            }),
            rewardBeneficiaries: beneficiaries,
            rewardSharesBps: shares,
            initialBuyCustody: ClassicInitialBuyCustodyConfig({
                mode: ClassicInitialBuyCustodyMode.Unlocked, durationDays: 0, cliffDays: 0
            })
        });
    }

    function _creatorAccrued(bytes32 id) private view returns (uint256 accrued) {
        (,,,,, accrued) = feeHook.poolFeeConfig(id);
    }

    function _hexNibble(uint8 value) private pure returns (string memory) {
        bytes memory alphabet = "0123456789abcdef";
        bytes memory output = new bytes(1);
        output[0] = alphabet[value];
        return string(output);
    }

    function _addresses1(address a) private pure returns (address[] memory values) {
        values = new address[](1);
        values[0] = a;
    }

    function _shares1(uint16 a) private pure returns (uint16[] memory values) {
        values = new uint16[](1);
        values[0] = a;
    }

    function _addresses2(address a, address b) private pure returns (address[] memory values) {
        values = new address[](2);
        values[0] = a;
        values[1] = b;
    }

    function _shares2(uint16 a, uint16 b) private pure returns (uint16[] memory values) {
        values = new uint16[](2);
        values[0] = a;
        values[1] = b;
    }

    function _addresses3(address a, address b, address c) private pure returns (address[] memory values) {
        values = new address[](3);
        values[0] = a;
        values[1] = b;
        values[2] = c;
    }

    function _shares3(uint16 a, uint16 b, uint16 c) private pure returns (uint16[] memory values) {
        values = new uint16[](3);
        values[0] = a;
        values[1] = b;
        values[2] = c;
    }
}
