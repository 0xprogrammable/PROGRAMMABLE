// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { CurrencySettler } from "@openzeppelin/uniswap-hooks/src/utils/CurrencySettler.sol";
import { PositionFeesForwarder } from "@uniswap/liquidity-launcher/src/periphery/PositionFeesForwarder.sol";
import { Plan, Position } from "@uniswap/liquidity-launcher/src/types/PositionPlannerTypes.sol";
import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { PositionInfo } from "@uniswap/v4-periphery/src/libraries/PositionInfoLibrary.sol";

import { ClassicInitialBuyCustodyConfig, ClassicInitialBuyCustodyMode } from "./ClassicInitialBuyVestingWalletV1.sol";
import { ClassicInitialBuyVestingWalletFactoryV1 } from "./ClassicInitialBuyVestingWalletFactoryV1.sol";
import { ClassicLaunchPolicyV1 } from "./ClassicLaunchPolicyV1.sol";
import { ClassicPositionPlannerV1 } from "./ClassicPositionPlannerV1.sol";
import { ClassicRewardVaultFactoryV1 } from "./ClassicRewardVaultFactoryV1.sol";
import { EthCreatorFeeHookV4 } from "./EthCreatorFeeHookV4.sol";
import { LockedPositionFeeForwarderFactoryV1 } from "./LockedPositionFeeForwarderFactoryV1.sol";
import { IClassicFeeHookV3 } from "./interfaces/IClassicFeeHookV3.sol";

/// @title MemeLaunchV4
/// @notice Launches a fixed-supply Classic token with a stable Router V1 authorization envelope.
/// @dev Preserves the exact V2 event surface, single permanently locked LP NFT and reward-vault lifecycle. V4 fixes
///      initial-buy custody to Unlocked. The actual LP token ID remains in events and authenticated storage, while the
///      returned result uses an explicit zero sentinel for that globally volatile value. The stable launch hash binds
///      the complete economics and unlocked-custody policy, but not the global token ID.
contract MemeLaunchV4 is IUnlockCallback, ReentrancyGuardTransient {
    using CurrencySettler for Currency;
    using SafeCast for *;

    uint8 public constant TOKEN_DECIMALS = 18;
    uint256 public constant TOKEN_SUPPLY = 1_000_000_000 ether;
    uint256 public constant MIN_INITIAL_BUY_WEI = 0.0006 ether;
    uint256 public constant MAX_REWARD_BENEFICIARIES = 5;
    uint16 public constant REWARD_SHARE_BASIS_POINTS = 10_000;
    int24 public constant INITIAL_TICK = 204_200;
    int24 public constant TICK_SPACING = 200;
    uint24 public constant LP_FEE_PIPS = 0;
    // Slither 0.11.5 cannot build IR for unlockCallback and consequently misses the native settlement use.
    // slither-disable-next-line unused-state
    Currency private constant NATIVE = Currency.wrap(address(0));

    IPoolManager public immutable poolManager;
    IPositionManager public immutable positionManager;
    UERC20Factory public immutable tokenFactory;
    EthCreatorFeeHookV4 public immutable feeHook;
    ClassicPositionPlannerV1 public immutable positionPlanner;
    ClassicRewardVaultFactoryV1 public immutable rewardVaultFactory;
    ClassicInitialBuyVestingWalletFactoryV1 public immutable initialBuyVestingWalletFactory;
    ClassicLaunchPolicyV1 public immutable launchPolicy;
    LockedPositionFeeForwarderFactoryV1 public immutable positionForwarderFactory;
    // Canonical Mainnet Launch Stamp Router. Classic launches are intentionally router-only.
    // slither-disable-next-line naming-convention
    address public constant ROUTER = 0x8622DD5bAb44185f2A458ac90384Ac99248f8d56;

    mapping(address token => bytes32 launchHash) public launchHashOf;
    mapping(address token => address rewardVault) public rewardVaultOf;
    mapping(address token => address custody) public initialBuyCustodyOf;
    mapping(address token => uint256 positionTokenId) public positionTokenIdOf;

    struct LaunchParameters {
        string name;
        string symbol;
        uint16 buySwapFeeBps;
        uint16 sellSwapFeeBps;
        bytes32 creatorSalt;
        UERC20Metadata metadata;
        address[] rewardBeneficiaries;
        uint16[] rewardSharesBps;
        ClassicInitialBuyCustodyConfig initialBuyCustody;
    }

    struct LaunchResult {
        address token;
        address rewardVault;
        address positionRecipient;
        uint256 positionTokenId;
        uint256 tokenLiquidityAmount;
        uint256 lockedTokenDust;
        uint256 initialBuyNativeAmount;
        uint256 initialBuyTokenAmount;
        address initialBuyCustody;
        bytes32 poolId;
        bytes32 launchHash;
    }

    struct InitialBuyCallbackData {
        PoolKey key;
        address recipient;
        uint256 nativeAmount;
    }

    error InitialBuyBelowMinimum(uint256 actual, uint256 minimum);
    error InvalidDependency(address dependency);
    error InvalidInitialBuyDelta(int128 nativeDelta, int128 tokenDelta);
    error InvalidInitialBuyRecipientBalance(uint256 actual, uint256 expected);
    error InvalidInitialBuyResult(uint256 tokenAmount, uint256 residualNativeBalance);
    error InvalidInitialBuySettlement(uint256 actual, uint256 expected);
    error InvalidInitialTick(int24 actual, int24 expected);
    error InvalidPositionManager(address expectedPoolManager, address actualPoolManager);
    error InvalidPositionManagerFactory(address expectedPositionManager, address actualPositionManager);
    error InvalidPositionLiquidity(uint256 positionTokenId, uint128 actualLiquidity, uint128 expectedLiquidity);
    error InvalidPositionOwner(uint256 positionTokenId, address actualOwner, address expectedOwner);
    error InvalidPositionPool(uint256 positionTokenId, bytes32 actualPoolId, bytes32 expectedPoolId);
    error InvalidPositionPlanner(address planner, bytes32 actualCodeHash, bytes32 expectedCodeHash);
    error InvalidPositionTicks(
        uint256 positionTokenId,
        int24 actualTickLower,
        int24 actualTickUpper,
        int24 expectedTickLower,
        int24 expectedTickUpper
    );
    error InvalidPositionTokenId(uint256 actualNextTokenId, uint256 expectedNextTokenId);
    error InvalidSharedHook(address expectedPoolManager, uint24 lpFeePips, int24 tickSpacing);
    error InvalidVaultFactory(address expected, address actual);
    error TokenAddressMismatch(address actual, address predicted);
    error TokenAlreadyExists(address token);
    error TokenCustodyMismatch(uint256 launcherBalance, uint256 positionManagerBalance);
    error UnauthorizedRouter(address caller, address expectedRouter);
    error UnauthorizedUnlockCallback(address caller);
    error UnsupportedInitialBuyCustody(ClassicInitialBuyCustodyMode mode, uint16 durationDays, uint16 cliffDays);
    error ZeroLaunchWallet();
    error UnrecognizedFactoryDeployment(address deployment);

    event MemeTokenLaunchedV2(
        address indexed deployer,
        address indexed token,
        bytes32 indexed poolId,
        address feeHook,
        address rewardVault,
        address positionRecipient,
        uint256 positionTokenId,
        uint16 buySwapFeeBps,
        uint16 sellSwapFeeBps,
        bytes32 rewardConfigurationHash,
        bytes32 launchHash
    );
    event MemeLiquidityConfiguredV2(
        address indexed token,
        uint256 totalSupply,
        uint256 tokenLiquidityAmount,
        uint256 lockedTokenDust,
        int24 initialTick,
        int24 tickLower,
        int24 tickUpper,
        uint24 lpFeePips,
        bytes32 launchHash
    );
    event MemeCreatorInitialBuyV2(
        address indexed deployer,
        address indexed token,
        bytes32 indexed poolId,
        uint256 nativeAmount,
        uint256 tokenAmount,
        bytes32 launchHash
    );
    event MemeCreatorInitialBuyCustodyV2(
        address indexed deployer,
        address indexed token,
        address indexed custody,
        ClassicInitialBuyCustodyMode mode,
        uint16 durationDays,
        uint16 cliffDays,
        bytes32 configurationHash,
        bytes32 launchHash
    );

    constructor(
        IPoolManager poolManager_,
        IPositionManager positionManager_,
        UERC20Factory tokenFactory_,
        EthCreatorFeeHookV4 feeHook_,
        ClassicPositionPlannerV1 positionPlanner_,
        ClassicRewardVaultFactoryV1 rewardVaultFactory_,
        ClassicInitialBuyVestingWalletFactoryV1 initialBuyVestingWalletFactory_,
        ClassicLaunchPolicyV1 launchPolicy_,
        LockedPositionFeeForwarderFactoryV1 positionForwarderFactory_
    ) {
        _requireContract(address(poolManager_));
        _requireContract(address(positionManager_));
        _requireContract(address(tokenFactory_));
        _requireContract(address(feeHook_));
        _requireContract(address(positionPlanner_));
        _requireContract(address(rewardVaultFactory_));
        _requireContract(address(initialBuyVestingWalletFactory_));
        _requireContract(address(launchPolicy_));
        _requireContract(address(positionForwarderFactory_));

        bytes32 expectedPlannerCodeHash = keccak256(type(ClassicPositionPlannerV1).runtimeCode);
        bytes32 actualPlannerCodeHash = address(positionPlanner_).codehash;
        if (actualPlannerCodeHash != expectedPlannerCodeHash) {
            revert InvalidPositionPlanner(address(positionPlanner_), actualPlannerCodeHash, expectedPlannerCodeHash);
        }

        address positionManagerPoolManager = address(positionManager_.poolManager());
        if (positionManagerPoolManager != address(poolManager_)) {
            revert InvalidPositionManager(address(poolManager_), positionManagerPoolManager);
        }
        address factoryPositionManager = address(positionForwarderFactory_.positionManager());
        if (factoryPositionManager != address(positionManager_)) {
            revert InvalidPositionManagerFactory(address(positionManager_), factoryPositionManager);
        }
        if (
            address(feeHook_.poolManager()) != address(poolManager_) || feeHook_.LP_FEE_PIPS() != LP_FEE_PIPS
                || feeHook_.TICK_SPACING() != TICK_SPACING
        ) {
            revert InvalidSharedHook(address(poolManager_), feeHook_.LP_FEE_PIPS(), feeHook_.TICK_SPACING());
        }
        address configuredVaultFactory = address(feeHook_.feeSplitVaultFactory());
        if (configuredVaultFactory != address(rewardVaultFactory_)) {
            revert InvalidVaultFactory(address(rewardVaultFactory_), configuredVaultFactory);
        }

        poolManager = poolManager_;
        positionManager = positionManager_;
        tokenFactory = tokenFactory_;
        feeHook = feeHook_;
        positionPlanner = positionPlanner_;
        rewardVaultFactory = rewardVaultFactory_;
        initialBuyVestingWalletFactory = initialBuyVestingWalletFactory_;
        launchPolicy = launchPolicy_;
        positionForwarderFactory = positionForwarderFactory_;
    }

    function predictTokenAddress(string calldata name, string calldata symbol, address deployer, bytes32 creatorSalt)
        external
        view
        returns (address token, bytes32 effectiveGraffiti)
    {
        effectiveGraffiti = _effectiveGraffiti(deployer, creatorSalt);
        token = tokenFactory.getUERC20Address(name, symbol, TOKEN_DECIMALS, address(this), effectiveGraffiti);
    }

    function predictRewardVault(
        address token,
        address deployer,
        address[] calldata beneficiaries,
        uint16[] calldata sharesBps
    ) external view returns (address) {
        PoolKey memory key = _poolKey(token);
        bytes32 poolId = PoolId.unwrap(key.toId());
        return rewardVaultFactory.predict(
            _rewardVaultSalt(token, deployer), IClassicFeeHookV3(address(feeHook)), poolId, beneficiaries, sharesBps
        );
    }

    /// @notice Creates, registers, initializes and permanently positions a Classic launch atomically.
    /// @dev Only the canonical Launch Stamp Router may call; `launchWallet` remains the creator in every binding.
    ///      The returned position token ID is a zero authorization sentinel. Read the actual ID from
    ///      `positionTokenIdOf` or from the unchanged V2 launch event. Custody is always Unlocked and therefore zero.
    function launchFor(address launchWallet, LaunchParameters calldata parameters)
        external
        payable
        nonReentrant
        returns (LaunchResult memory result)
    {
        if (msg.sender != ROUTER) revert UnauthorizedRouter(msg.sender, ROUTER);
        if (launchWallet == address(0)) revert ZeroLaunchWallet();
        _validateLaunch(parameters);
        if (msg.value < MIN_INITIAL_BUY_WEI) {
            revert InitialBuyBelowMinimum(msg.value, MIN_INITIAL_BUY_WEI);
        }
        result.initialBuyNativeAmount = msg.value;

        bytes32 effectiveGraffiti = _effectiveGraffiti(launchWallet, parameters.creatorSalt);
        result.token = tokenFactory.getUERC20Address(
            parameters.name, parameters.symbol, TOKEN_DECIMALS, address(this), effectiveGraffiti
        );
        if (result.token.code.length != 0) revert TokenAlreadyExists(result.token);

        PoolKey memory key = _poolKey(result.token);
        result.poolId = PoolId.unwrap(key.toId());
        result.rewardVault = _deployOrReuseRewardVault(
            result.token, launchWallet, result.poolId, parameters.rewardBeneficiaries, parameters.rewardSharesBps
        );
        result.positionRecipient = _deployOrReusePositionRecipient(result.token, launchWallet);
        _createToken(parameters, effectiveGraffiti, result.token);

        bytes32 registeredPoolId =
            feeHook.registerPool(key, result.rewardVault, parameters.buySwapFeeBps, parameters.sellSwapFeeBps);
        assert(registeredPoolId == result.poolId);

        uint160 initialSqrtPriceX96 = TickMath.getSqrtPriceAtTick(INITIAL_TICK);
        int24 initializedTick = poolManager.initialize(key, initialSqrtPriceX96);
        if (initializedTick != INITIAL_TICK) revert InvalidInitialTick(initializedTick, INITIAL_TICK);

        Position memory position;
        (result, position) = _mintAndVerifyPosition(key, result);

        result = _completeLaunch(launchWallet, parameters, key, position, result);
        result.positionTokenId = 0;
        result.initialBuyCustody = address(0);
        return result;
    }

    function _mintAndVerifyPosition(PoolKey memory key, LaunchResult memory result)
        private
        returns (LaunchResult memory, Position memory position)
    {
        (Plan memory plan, Position memory plannedPosition, uint256 lockedTokenDust) =
            positionPlanner.buildOneSidedPlan(key, result.positionRecipient);
        uint256 nextTokenIdBefore = positionManager.nextTokenId();
        if (nextTokenIdBefore == 0) revert InvalidPositionTokenId(nextTokenIdBefore, 1);
        result.tokenLiquidityAmount = plannedPosition.amount1;
        result.lockedTokenDust = lockedTokenDust;

        Currency.wrap(result.token).transfer(address(positionManager), TOKEN_SUPPLY);
        positionManager.modifyLiquidities(abi.encode(plan.actions, plan.params), block.timestamp);

        uint256 nextTokenIdAfter = positionManager.nextTokenId();
        uint256 expectedNextTokenId = nextTokenIdBefore + 1;
        if (nextTokenIdAfter != expectedNextTokenId) {
            revert InvalidPositionTokenId(nextTokenIdAfter, expectedNextTokenId);
        }
        result.positionTokenId = nextTokenIdAfter - 1;

        uint256 launcherTokenBalance = IERC20(result.token).balanceOf(address(this));
        uint256 positionManagerTokenBalance = IERC20(result.token).balanceOf(address(positionManager));
        if (launcherTokenBalance != 0 || positionManagerTokenBalance != 0) {
            revert TokenCustodyMismatch(launcherTokenBalance, positionManagerTokenBalance);
        }

        _verifyMintedPosition(result, plannedPosition);
        return (result, plannedPosition);
    }

    function _completeLaunch(
        address launchWallet,
        LaunchParameters calldata parameters,
        PoolKey memory key,
        Position memory position,
        LaunchResult memory result
    ) private returns (LaunchResult memory) {
        result.initialBuyCustody = address(0);
        result.initialBuyTokenAmount = _executeInitialBuy(key, launchWallet, result.initialBuyNativeAmount);
        // ReentrancyGuardTransient protects the complete launch; Slither does not model its transient lock.
        // slither-disable-next-line reentrancy-benign
        result.launchHash = _recordLaunch(parameters, result, position, launchWallet);
        return result;
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert UnauthorizedUnlockCallback(msg.sender);

        InitialBuyCallbackData memory callback = abi.decode(data, (InitialBuyCallbackData));
        BalanceDelta delta = poolManager.swap(
            callback.key,
            SwapParams({
                zeroForOne: true,
                amountSpecified: -callback.nativeAmount.toInt256(),
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            ""
        );

        int128 nativeDelta = delta.amount0();
        int128 tokenDelta = delta.amount1();
        if (nativeDelta >= 0 || tokenDelta <= 0) revert InvalidInitialBuyDelta(nativeDelta, tokenDelta);

        uint256 nativeSettlement = (-int256(nativeDelta)).toUint256();
        if (nativeSettlement != callback.nativeAmount) {
            revert InvalidInitialBuySettlement(nativeSettlement, callback.nativeAmount);
        }
        uint256 tokenAmount = int256(tokenDelta).toUint256();

        NATIVE.settle(poolManager, address(this), nativeSettlement, false);
        callback.key.currency1.take(poolManager, callback.recipient, tokenAmount, false);
        return abi.encode(tokenAmount);
    }

    function poolKey(address token) external view returns (PoolKey memory) {
        return _poolKey(token);
    }

    function _executeInitialBuy(PoolKey memory key, address recipient, uint256 nativeAmount)
        private
        returns (uint256 tokenAmount)
    {
        // Native ETH can be forced into any contract. Preserve that unrelated balance instead of allowing it to
        // permanently block launches, while still proving that this launch spent exactly `nativeAmount`.
        uint256 residualNativeBalance = address(this).balance - nativeAmount;
        address token = Currency.unwrap(key.currency1);
        uint256 recipientBalanceBefore = IERC20(token).balanceOf(recipient);
        bytes memory result = poolManager.unlock(
            abi.encode(InitialBuyCallbackData({ key: key, recipient: recipient, nativeAmount: nativeAmount }))
        );
        tokenAmount = abi.decode(result, (uint256));
        if (tokenAmount == 0 || address(this).balance != residualNativeBalance) {
            revert InvalidInitialBuyResult(tokenAmount, address(this).balance);
        }
        uint256 recipientBalanceIncrease = IERC20(token).balanceOf(recipient) - recipientBalanceBefore;
        if (recipientBalanceIncrease != tokenAmount) {
            revert InvalidInitialBuyRecipientBalance(recipientBalanceIncrease, tokenAmount);
        }
    }

    function _recordLaunch(
        LaunchParameters calldata parameters,
        LaunchResult memory result,
        Position memory position,
        address deployer
    ) private returns (bytes32 launchHash) {
        bytes32 rewardConfigurationHash = rewardVaultFactory.configurationHashOf(result.rewardVault);
        bytes32 custodyConfigurationHash = _initialBuyCustodyConfigurationHash(parameters, result, deployer);
        bytes32 infrastructureHash =
            _infrastructureHash(result, deployer, rewardConfigurationHash, custodyConfigurationHash);
        bytes32 economicsHash = _economicsHash(parameters, result, position, custodyConfigurationHash);
        launchHash = keccak256(abi.encode(block.chainid, address(this), infrastructureHash, economicsHash));
        launchHashOf[result.token] = launchHash;
        rewardVaultOf[result.token] = result.rewardVault;
        initialBuyCustodyOf[result.token] = result.initialBuyCustody;
        positionTokenIdOf[result.token] = result.positionTokenId;

        _emitLaunchEvents(
            parameters, result, position, deployer, rewardConfigurationHash, custodyConfigurationHash, launchHash
        );
    }

    function _emitLaunchEvents(
        LaunchParameters calldata parameters,
        LaunchResult memory result,
        Position memory position,
        address deployer,
        bytes32 rewardConfigurationHash,
        bytes32 custodyConfigurationHash,
        bytes32 launchHash
    ) private {
        _emitTokenLaunched(parameters, result, deployer, rewardConfigurationHash, launchHash);
        emit MemeLiquidityConfiguredV2(
            result.token,
            TOKEN_SUPPLY,
            result.tokenLiquidityAmount,
            result.lockedTokenDust,
            INITIAL_TICK,
            position.tickLower,
            position.tickUpper,
            LP_FEE_PIPS,
            launchHash
        );
        emit MemeCreatorInitialBuyV2(
            deployer,
            result.token,
            result.poolId,
            result.initialBuyNativeAmount,
            result.initialBuyTokenAmount,
            launchHash
        );
        emit MemeCreatorInitialBuyCustodyV2(
            deployer,
            result.token,
            result.initialBuyCustody,
            parameters.initialBuyCustody.mode,
            parameters.initialBuyCustody.durationDays,
            parameters.initialBuyCustody.cliffDays,
            custodyConfigurationHash,
            launchHash
        );
    }

    function _emitTokenLaunched(
        LaunchParameters calldata parameters,
        LaunchResult memory result,
        address deployer,
        bytes32 rewardConfigurationHash,
        bytes32 launchHash
    ) private {
        emit MemeTokenLaunchedV2(
            deployer,
            result.token,
            result.poolId,
            address(feeHook),
            result.rewardVault,
            result.positionRecipient,
            result.positionTokenId,
            parameters.buySwapFeeBps,
            parameters.sellSwapFeeBps,
            rewardConfigurationHash,
            launchHash
        );
    }

    function _infrastructureHash(
        LaunchResult memory result,
        address deployer,
        bytes32 rewardConfigurationHash,
        bytes32 custodyConfigurationHash
    ) private view returns (bytes32) {
        // The globally allocated PositionManager token ID is deliberately excluded. The canonical launcher runtime,
        // post-mint proof, actual-value storage and unchanged events authenticate that realized value.
        return keccak256(
            abi.encode(
                deployer,
                result.token,
                address(feeHook),
                result.rewardVault,
                rewardConfigurationHash,
                address(initialBuyVestingWalletFactory),
                result.initialBuyCustody,
                custodyConfigurationHash,
                result.positionRecipient,
                result.poolId
            )
        );
    }

    function _economicsHash(
        LaunchParameters calldata parameters,
        LaunchResult memory result,
        Position memory position,
        bytes32 custodyConfigurationHash
    ) private view returns (bytes32) {
        // The resolved ticks bind the one canonical complete-supply Classic liquidity design.
        bytes32 liquidityHash = keccak256(
            abi.encode(
                TOKEN_SUPPLY,
                result.tokenLiquidityAmount,
                result.lockedTokenDust,
                INITIAL_TICK,
                position.tickLower,
                position.tickUpper,
                LP_FEE_PIPS
            )
        );
        bytes32 tradeHash = keccak256(
            abi.encode(
                MIN_INITIAL_BUY_WEI,
                result.initialBuyNativeAmount,
                result.initialBuyTokenAmount,
                parameters.buySwapFeeBps,
                parameters.sellSwapFeeBps,
                feeHook.LAUNCHER_FEE_BPS(),
                parameters.initialBuyCustody.mode,
                parameters.initialBuyCustody.durationDays,
                parameters.initialBuyCustody.cliffDays,
                custodyConfigurationHash
            )
        );
        return keccak256(abi.encode(liquidityHash, tradeHash));
    }

    function _deployOrReusePositionRecipient(address token, address deployer) private returns (address recipient) {
        recipient = positionForwarderFactory.predict(_positionSalt(token, deployer), deployer);
        if (recipient.code.length == 0) {
            return address(positionForwarderFactory.deploy(_positionSalt(token, deployer), deployer));
        }

        PositionFeesForwarder forwarder = PositionFeesForwarder(payable(recipient));
        if (
            positionForwarderFactory.configurationHashOf(recipient) == bytes32(0)
                || address(forwarder.positionManager()) != address(positionManager)
                || forwarder.operator() != address(0) || forwarder.timelockBlockNumber() != type(uint256).max
                || forwarder.feeRecipient() != deployer
        ) {
            revert UnrecognizedFactoryDeployment(recipient);
        }
    }

    function _deployOrReuseRewardVault(
        address token,
        address deployer,
        bytes32 poolId,
        address[] calldata beneficiaries,
        uint16[] calldata sharesBps
    ) private returns (address rewardVault) {
        return address(
            rewardVaultFactory.deployOrGet(
                _rewardVaultSalt(token, deployer), IClassicFeeHookV3(address(feeHook)), poolId, beneficiaries, sharesBps
            )
        );
    }

    function _initialBuyCustodyConfigurationHash(
        LaunchParameters calldata parameters,
        LaunchResult memory result,
        address deployer
    ) private view returns (bytes32) {
        if (result.initialBuyCustody != address(0)) {
            return initialBuyVestingWalletFactory.configurationHashOf(result.initialBuyCustody);
        }
        return keccak256(
            abi.encode(
                block.chainid,
                address(this),
                result.token,
                deployer,
                parameters.initialBuyCustody.mode,
                parameters.initialBuyCustody.durationDays,
                parameters.initialBuyCustody.cliffDays
            )
        );
    }

    function _createToken(LaunchParameters calldata parameters, bytes32 effectiveGraffiti, address predictedToken)
        private
    {
        address token = tokenFactory.createToken(
            parameters.name,
            parameters.symbol,
            TOKEN_DECIMALS,
            TOKEN_SUPPLY,
            address(this),
            abi.encode(parameters.metadata),
            effectiveGraffiti
        );
        if (token != predictedToken) revert TokenAddressMismatch(token, predictedToken);
    }

    function _poolKey(address token) private view returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(token),
            fee: LP_FEE_PIPS,
            tickSpacing: TICK_SPACING,
            hooks: feeHook
        });
    }

    function _validateLaunch(LaunchParameters calldata parameters) private view {
        if (
            parameters.initialBuyCustody.mode != ClassicInitialBuyCustodyMode.Unlocked
                || parameters.initialBuyCustody.durationDays != 0 || parameters.initialBuyCustody.cliffDays != 0
        ) {
            revert UnsupportedInitialBuyCustody(
                parameters.initialBuyCustody.mode,
                parameters.initialBuyCustody.durationDays,
                parameters.initialBuyCustody.cliffDays
            );
        }
        // Reuse the hook's canonical fee validation before any token, vault, position or pool work.
        feeHook.quoteGrossFees(0, parameters.buySwapFeeBps);
        feeHook.quoteGrossFees(0, parameters.sellSwapFeeBps);
        launchPolicy.validate(
            parameters.name,
            parameters.symbol,
            parameters.metadata,
            parameters.rewardBeneficiaries,
            parameters.rewardSharesBps
        );
        initialBuyVestingWalletFactory.validateConfig(parameters.initialBuyCustody);
    }

    function _effectiveGraffiti(address deployer, bytes32 creatorSalt) private pure returns (bytes32) {
        return keccak256(abi.encode(deployer, creatorSalt));
    }

    function _positionSalt(address token, address deployer) private pure returns (bytes32) {
        return keccak256(abi.encode("launcher.meme-position.v1", token, deployer));
    }

    function _rewardVaultSalt(address token, address deployer) private pure returns (bytes32) {
        return keccak256(abi.encode("programmable.classic-reward-vault.v1", token, deployer));
    }

    function _requireContract(address dependency) private view {
        if (dependency == address(0) || dependency.code.length == 0) revert InvalidDependency(dependency);
    }

    function _verifyMintedPosition(LaunchResult memory result, Position memory expectedPosition) private view {
        uint256 positionTokenId = result.positionTokenId;
        address actualOwner = IERC721(address(positionManager)).ownerOf(positionTokenId);
        if (actualOwner != result.positionRecipient) {
            revert InvalidPositionOwner(positionTokenId, actualOwner, result.positionRecipient);
        }

        (PoolKey memory actualKey, PositionInfo actualInfo) = positionManager.getPoolAndPositionInfo(positionTokenId);
        bytes32 actualPoolId = PoolId.unwrap(actualKey.toId());
        if (actualPoolId != result.poolId) {
            revert InvalidPositionPool(positionTokenId, actualPoolId, result.poolId);
        }

        int24 actualTickLower = actualInfo.tickLower();
        int24 actualTickUpper = actualInfo.tickUpper();
        if (actualTickLower != expectedPosition.tickLower || actualTickUpper != expectedPosition.tickUpper) {
            revert InvalidPositionTicks(
                positionTokenId,
                actualTickLower,
                actualTickUpper,
                expectedPosition.tickLower,
                expectedPosition.tickUpper
            );
        }

        uint128 actualLiquidity = positionManager.getPositionLiquidity(positionTokenId);
        uint128 expectedLiquidity = expectedPosition.liquidity.toUint128();
        if (actualLiquidity != expectedLiquidity) {
            revert InvalidPositionLiquidity(positionTokenId, actualLiquidity, expectedLiquidity);
        }
    }
}
