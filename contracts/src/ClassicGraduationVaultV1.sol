// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { PositionFeesForwarder } from "@uniswap/liquidity-launcher/src/periphery/PositionFeesForwarder.sol";
import { CurrencySettler } from "@openzeppelin/uniswap-hooks/src/utils/CurrencySettler.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { SqrtPriceMath } from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { Actions } from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import { PositionInfo, PositionInfoLibrary } from "@uniswap/v4-periphery/src/libraries/PositionInfoLibrary.sol";

import { LockedPositionFeeForwarderFactoryV1 } from "./LockedPositionFeeForwarderFactoryV1.sol";

/// @notice Minimal handshake required from the immutable Classic hook during one-shot graduation.
interface IClassicGraduationHookV1 {
    /// @return ready True only once the bonding curve reached its committed endpoint.
    /// @return completed True only after the hook accepted the final-position commitment.
    /// @return endpointSqrtPriceX96 The exact endpoint committed for this pool.
    function bondingState(bytes32 poolId)
        external
        view
        returns (bool ready, bool completed, uint160 endpointSqrtPriceX96);

    function bondingProgress(bytes32 poolId)
        external
        view
        returns (uint8 state, uint16 progressBps, uint256 tokenRemaining, uint256 nativeRemainingNet);

    function totalSwapFeeBpsFor(bytes32 poolId, bool isBuy) external view returns (uint16);

    function BASIS_POINTS() external view returns (uint16);

    /// @notice Opens the hook's tightly-scoped Migrating state for this controller transaction.
    function beginGraduation(PoolKey calldata key) external;

    /// @notice Atomically records the already-completed position replacement.
    /// @dev A conforming hook authenticates msg.sender as this pool's configured graduation controller, independently
    ///      recomputes the pool id from `key`, and only accepts this call from its Ready state.
    function completeGraduation(
        PoolKey calldata key,
        uint256 oldPositionTokenId,
        uint256 finalPositionTokenId,
        address finalPositionRecipient,
        uint256 nativeLiquidityAmount,
        uint256 tokenLiquidityAmount,
        int24 finalTickLower,
        int24 finalTickUpper
    ) external;
}

/// @notice Immutable economic configuration shared by the vault and its deterministic factory.
struct ClassicGraduationConfigV1 {
    PoolKey poolKey;
    uint256 bondingPositionTokenId;
    address finalPositionRecipient;
    int24 bondingTickLower;
    int24 bondingTickUpper;
    uint128 bondingLiquidity;
    uint128 finalLiquidity;
}

/// @title ClassicGraduationVaultV1
/// @notice Ownerless one-shot custody that replaces one completed Classic bonding NFT with the final locked NFT.
/// @dev There is deliberately no owner, upgrade path, approval method, rescue method, arbitrary call, caller reward or
///      caller-supplied economic input. The existing position, endpoint, final range, final liquidity and recipient are
///      all committed at construction. Any failure in the hook's final acknowledgement reverts the entire migration.
contract ClassicGraduationVaultV1 is IUnlockCallback, ReentrancyGuardTransient {
    using PositionInfoLibrary for PositionInfo;
    using SafeCast for uint256;
    using SafeCast for int256;
    using SafeERC20 for IERC20;
    using StateLibrary for IPoolManager;
    using CurrencySettler for Currency;

    uint256 public constant RESERVE_TOKEN_AMOUNT = 200_000_000 ether;
    int24 public constant FINAL_TICK_LOWER = 9800;
    int24 public constant FINAL_TICK_UPPER = 225_200;
    int24 public constant TICK_SPACING = 200;
    uint24 public constant LP_FEE_PIPS = 0;
    uint8 public constant BONDING_STATE = 2;

    Currency private constant NATIVE = Currency.wrap(address(0));

    address public immutable factory;
    IPositionManager public immutable positionManager;
    IPoolManager public immutable poolManager;
    LockedPositionFeeForwarderFactoryV1 public immutable positionForwarderFactory;
    IClassicGraduationHookV1 public immutable graduationHook;
    IERC20 public immutable token;

    bytes32 public immutable poolId;
    uint256 public immutable bondingPositionTokenId;
    address public immutable finalPositionRecipient;
    int24 public immutable bondingTickLower;
    int24 public immutable bondingTickUpper;
    uint128 public immutable bondingLiquidity;
    uint128 public immutable finalLiquidity;
    uint160 public immutable endpointSqrtPriceX96;

    /// @notice Minimum native principal that burning the committed bonding NFT must return at the endpoint.
    uint256 public immutable bondingNativePrincipal;
    /// @notice Exact native amount required by the explicit final-position mint at the endpoint.
    uint256 public immutable finalNativeLiquidityAmount;
    /// @notice Exact token amount settled for the explicit final-position mint; always bounded by the 200M reserve.
    uint256 public immutable finalTokenLiquidityAmount;

    address private immutable currency0Address;
    uint24 private immutable poolFee;
    int24 private immutable poolTickSpacing;

    bool public graduated;
    uint256 public finalPositionTokenId;

    error AlreadyGraduated();
    error BondingNotActive(uint8 state);
    error BondingPositionDoesNotExist(uint256 tokenId);
    error BondingPositionLiquidityMismatch(uint128 actual, uint128 expected);
    error BondingPositionOwnerMismatch(address actual, address expected);
    error BondingPositionPoolMismatch(bytes32 actual, bytes32 expected);
    error BondingPositionRangeMismatch(int24 actualLower, int24 actualUpper, int24 expectedLower, int24 expectedUpper);
    error BondingPositionSubscribed(uint256 tokenId);
    error EndpointCommitmentMismatch(uint160 actual, uint160 expected);
    error FinalPositionLiquidityMismatch(uint128 actual, uint128 expected);
    error FinalPositionOwnerMismatch(address actual, address expected);
    error FinalPositionPoolMismatch(bytes32 actual, bytes32 expected);
    error FinalPositionRangeMismatch(int24 actualLower, int24 actualUpper, int24 expectedLower, int24 expectedUpper);
    error HookDidNotComplete();
    error HookNotReady(bool ready, bool completed);
    error InsufficientBondingPrincipal(uint256 available, uint256 required);
    error InsufficientGraduationReserve(uint256 actual, uint256 required);
    error InvalidBondingLiquidity();
    error InvalidBondingRange(int24 tickLower, int24 tickUpper);
    error InvalidDependency(address dependency);
    error InvalidFinalLiquidity();
    error InvalidFinalPositionRecipient(address recipient);
    error InvalidBuyRecipient(address recipient);
    error IncorrectMaxBuyValue(uint256 actual, uint256 expected);
    error InvalidMaxBuyDelta(int128 nativeDelta, int128 tokenDelta);
    error InvalidMaxBuyResult(uint256 tokenAmount, uint256 residualNativeBalance);
    error InvalidMaxBuyRecipientBalance(uint256 actual, uint256 expected);
    error InvalidMaxBuySettlement(uint256 actual, uint256 expected);
    error InvalidForwarderConfiguration(address forwarder);
    error InvalidLpFee(uint24 actual, uint24 expected);
    error InvalidPoolCurrency(address currency0, address currency1);
    error InvalidPoolHook(address actual);
    error InvalidPositionManager(address expectedPoolManager, address actualPoolManager);
    error InvalidPositionManagerFactory(address expectedPositionManager, address actualPositionManager);
    error InvalidTickSpacing(int24 actual, int24 expected);
    error PositionManagerTokenBalanceMismatch(uint256 actual, uint256 expected);
    error ReserveTransferMismatch(uint256 actual, uint256 expected);
    error TokenReserveExceeded(uint256 required, uint256 reserve);
    error UnexpectedFinalPositionTokenId(uint256 actual, uint256 expected);
    error UnauthorizedUnlockCallback(address caller);

    event ClassicGraduationExecuted(
        bytes32 indexed poolId,
        address indexed token,
        uint256 indexed oldPositionTokenId,
        uint256 finalPositionTokenId,
        address finalPositionRecipient,
        uint128 finalLiquidity,
        uint256 nativeLiquidityAmount,
        uint256 tokenLiquidityAmount,
        uint256 residualNativeAmount,
        uint256 residualTokenAmount,
        address caller
    );
    event ClassicBondingMaxBuyExecuted(
        bytes32 indexed poolId,
        address indexed token,
        address indexed buyer,
        address recipient,
        uint256 nativeAmount,
        uint256 tokenAmount,
        uint256 finalPositionTokenId
    );

    constructor(
        IPositionManager positionManager_,
        LockedPositionFeeForwarderFactoryV1 positionForwarderFactory_,
        ClassicGraduationConfigV1 memory config
    ) {
        _validateDependencies(positionManager_, positionForwarderFactory_);
        _validateConfig(positionManager_, positionForwarderFactory_, config);

        factory = msg.sender;
        positionManager = positionManager_;
        poolManager = positionManager_.poolManager();
        positionForwarderFactory = positionForwarderFactory_;
        graduationHook = IClassicGraduationHookV1(address(config.poolKey.hooks));
        token = IERC20(Currency.unwrap(config.poolKey.currency1));

        poolId = PoolId.unwrap(config.poolKey.toId());
        bondingPositionTokenId = config.bondingPositionTokenId;
        finalPositionRecipient = config.finalPositionRecipient;
        bondingTickLower = config.bondingTickLower;
        bondingTickUpper = config.bondingTickUpper;
        bondingLiquidity = config.bondingLiquidity;
        finalLiquidity = config.finalLiquidity;
        endpointSqrtPriceX96 = TickMath.getSqrtPriceAtTick(config.bondingTickLower);

        currency0Address = Currency.unwrap(config.poolKey.currency0);
        poolFee = config.poolKey.fee;
        poolTickSpacing = config.poolKey.tickSpacing;

        (uint256 availableNative, uint256 requiredNative, uint256 requiredToken) = _graduationAmounts(config);

        if (availableNative < requiredNative) revert InsufficientBondingPrincipal(availableNative, requiredNative);
        if (requiredToken > RESERVE_TOKEN_AMOUNT) revert TokenReserveExceeded(requiredToken, RESERVE_TOKEN_AMOUNT);

        bondingNativePrincipal = availableNative;
        finalNativeLiquidityAmount = requiredNative;
        finalTokenLiquidityAmount = requiredToken;
    }

    /// @notice Replaces the completed bonding NFT with the exact final NFT and acknowledges completion in the hook.
    /// @dev Permissionless and parameterless. Residual currency from the batched burn/mint is returned only to this
    ///      ownerless vault and can never be redirected by the caller.
    function graduate() external nonReentrant {
        _graduate();
    }

    /// @notice Quotes the exact gross native input that consumes all remaining curve liquidity without a partial fill.
    function bondingMaxBuyQuote() public view returns (uint256 grossNativeAmount, uint256 netNativeAmount) {
        (uint8 state,,, uint256 nativeRemainingNet) = graduationHook.bondingProgress(poolId);
        if (state != BONDING_STATE) revert BondingNotActive(state);
        netNativeAmount = nativeRemainingNet;
        uint16 buyFeeBps = graduationHook.totalSwapFeeBpsFor(poolId, true);
        uint16 basisPoints = graduationHook.BASIS_POINTS();
        grossNativeAmount = FullMath.mulDivRoundingUp(netNativeAmount, basisPoints, basisPoints - buyFeeBps);
        while (_netFromGross(grossNativeAmount, buyFeeBps, basisPoints) > netNativeAmount) --grossNativeAmount;
        while (_netFromGross(grossNativeAmount, buyFeeBps, basisPoints) < netNativeAmount) ++grossNativeAmount;
    }

    /// @notice Buys the exact remaining curve and completes graduation in one permissionless transaction.
    function maxBuyAndGraduate(address recipient)
        external
        payable
        nonReentrant
        returns (uint256 tokenAmount, uint256 mintedFinalPositionTokenId)
    {
        if (recipient == address(0)) revert InvalidBuyRecipient(recipient);
        (uint256 requiredNativeAmount,) = bondingMaxBuyQuote();
        if (msg.value != requiredNativeAmount) revert IncorrectMaxBuyValue(msg.value, requiredNativeAmount);

        uint256 residualNativeBalance = address(this).balance - requiredNativeAmount;
        uint256 recipientBalanceBefore = token.balanceOf(recipient);
        bytes memory result = poolManager.unlock(abi.encode(recipient, requiredNativeAmount));
        tokenAmount = abi.decode(result, (uint256));
        if (tokenAmount == 0 || address(this).balance != residualNativeBalance) {
            revert InvalidMaxBuyResult(tokenAmount, address(this).balance);
        }
        uint256 recipientBalanceIncrease = token.balanceOf(recipient) - recipientBalanceBefore;
        if (recipientBalanceIncrease != tokenAmount) {
            revert InvalidMaxBuyRecipientBalance(recipientBalanceIncrease, tokenAmount);
        }

        _graduate();
        mintedFinalPositionTokenId = finalPositionTokenId;
        emit ClassicBondingMaxBuyExecuted(
            poolId, address(token), msg.sender, recipient, requiredNativeAmount, tokenAmount, mintedFinalPositionTokenId
        );
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert UnauthorizedUnlockCallback(msg.sender);
        (address recipient, uint256 nativeAmount) = abi.decode(data, (address, uint256));
        PoolKey memory key = poolKey();
        BalanceDelta delta = poolManager.swap(
            key,
            SwapParams({
                zeroForOne: true,
                amountSpecified: -nativeAmount.toInt256(),
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            ""
        );
        int128 nativeDelta = delta.amount0();
        int128 tokenDelta = delta.amount1();
        if (nativeDelta >= 0 || tokenDelta <= 0) revert InvalidMaxBuyDelta(nativeDelta, tokenDelta);

        uint256 nativeSettlement = (-int256(nativeDelta)).toUint256();
        if (nativeSettlement != nativeAmount) revert InvalidMaxBuySettlement(nativeSettlement, nativeAmount);
        uint256 tokenAmount = int256(tokenDelta).toUint256();
        NATIVE.settle(poolManager, address(this), nativeSettlement, false);
        key.currency1.take(poolManager, recipient, tokenAmount, false);
        return abi.encode(tokenAmount);
    }

    function _graduate() private {
        if (graduated) revert AlreadyGraduated();

        PoolKey memory key = poolKey();
        (bool ready, bool completed, uint160 hookEndpointSqrtPriceX96) = graduationHook.bondingState(poolId);
        if (!ready || completed) revert HookNotReady(ready, completed);
        if (hookEndpointSqrtPriceX96 != endpointSqrtPriceX96) {
            revert EndpointCommitmentMismatch(hookEndpointSqrtPriceX96, endpointSqrtPriceX96);
        }
        _assertPoolEndpoint();
        _assertBondingPosition(key);

        uint256 vaultTokenBalanceBefore = token.balanceOf(address(this));
        if (vaultTokenBalanceBefore < RESERVE_TOKEN_AMOUNT) {
            revert InsufficientGraduationReserve(vaultTokenBalanceBefore, RESERVE_TOKEN_AMOUNT);
        }
        uint256 vaultNativeBalanceBefore = address(this).balance;
        uint256 positionManagerTokenBalanceBefore = token.balanceOf(address(positionManager));
        uint256 expectedFinalPositionTokenId = positionManager.nextTokenId();

        graduated = true;
        finalPositionTokenId = expectedFinalPositionTokenId;

        // The hook blocks all bonding-position liquidity changes until its configured controller opens the atomic
        // Migrating phase. A later revert, including a failed completion acknowledgement, rolls this state back.
        graduationHook.beginGraduation(key);

        token.safeTransfer(address(positionManager), finalTokenLiquidityAmount);
        uint256 positionManagerTokenBalanceAfterTransfer = token.balanceOf(address(positionManager));
        uint256 expectedPositionManagerBalance = positionManagerTokenBalanceBefore + finalTokenLiquidityAmount;
        if (positionManagerTokenBalanceAfterTransfer != expectedPositionManagerBalance) {
            revert ReserveTransferMismatch(positionManagerTokenBalanceAfterTransfer, expectedPositionManagerBalance);
        }

        positionManager.modifyLiquidities(_graduationPlan(key), block.timestamp);

        uint256 actualPositionManagerTokenBalance = token.balanceOf(address(positionManager));
        if (actualPositionManagerTokenBalance != positionManagerTokenBalanceBefore) {
            revert PositionManagerTokenBalanceMismatch(
                actualPositionManagerTokenBalance, positionManagerTokenBalanceBefore
            );
        }
        if (finalPositionTokenId != expectedFinalPositionTokenId) {
            revert UnexpectedFinalPositionTokenId(finalPositionTokenId, expectedFinalPositionTokenId);
        }

        _assertFinalPosition(key, expectedFinalPositionTokenId);
        _assertPoolEndpoint();

        graduationHook.completeGraduation(
            key,
            bondingPositionTokenId,
            expectedFinalPositionTokenId,
            finalPositionRecipient,
            finalNativeLiquidityAmount,
            finalTokenLiquidityAmount,
            FINAL_TICK_LOWER,
            FINAL_TICK_UPPER
        );

        (, bool completedAfter, uint160 hookEndpointAfter) = graduationHook.bondingState(poolId);
        if (!completedAfter) revert HookDidNotComplete();
        if (hookEndpointAfter != endpointSqrtPriceX96) {
            revert EndpointCommitmentMismatch(hookEndpointAfter, endpointSqrtPriceX96);
        }

        uint256 vaultTokenBalanceAfter = token.balanceOf(address(this));
        uint256 residualTokenAmount = vaultTokenBalanceAfter + finalTokenLiquidityAmount - vaultTokenBalanceBefore;
        uint256 residualNativeAmount = address(this).balance - vaultNativeBalanceBefore;

        emit ClassicGraduationExecuted(
            poolId,
            address(token),
            bondingPositionTokenId,
            expectedFinalPositionTokenId,
            finalPositionRecipient,
            finalLiquidity,
            finalNativeLiquidityAmount,
            finalTokenLiquidityAmount,
            residualNativeAmount,
            residualTokenAmount,
            msg.sender
        );
    }

    /// @notice Reconstructs the fully committed pool key.
    function poolKey() public view returns (PoolKey memory key) {
        key = PoolKey({
            currency0: Currency.wrap(currency0Address),
            currency1: Currency.wrap(address(token)),
            fee: poolFee,
            tickSpacing: poolTickSpacing,
            hooks: IHooks(address(graduationHook))
        });
    }

    /// @notice Stable commitment to all custody and economic inputs.
    function configurationHash() external view returns (bytes32) {
        bytes32 dependencyHash = keccak256(
            abi.encode(
                address(positionManager),
                address(poolManager),
                address(positionForwarderFactory),
                address(graduationHook),
                poolId,
                address(token)
            )
        );
        bytes32 positionHash = keccak256(
            abi.encode(
                bondingPositionTokenId,
                finalPositionRecipient,
                bondingTickLower,
                bondingTickUpper,
                bondingLiquidity,
                endpointSqrtPriceX96,
                FINAL_TICK_LOWER,
                FINAL_TICK_UPPER,
                finalLiquidity
            )
        );
        bytes32 amountHash = keccak256(
            abi.encode(
                bondingNativePrincipal, finalNativeLiquidityAmount, finalTokenLiquidityAmount, RESERVE_TOKEN_AMOUNT
            )
        );
        return keccak256(abi.encode(block.chainid, factory, address(this), dependencyHash, positionHash, amountHash));
    }

    function _graduationAmounts(ClassicGraduationConfigV1 memory config)
        private
        pure
        returns (uint256 availableNative, uint256 requiredNative, uint256 requiredToken)
    {
        uint160 endpoint = TickMath.getSqrtPriceAtTick(config.bondingTickLower);
        availableNative = SqrtPriceMath.getAmount0Delta(
            endpoint, TickMath.getSqrtPriceAtTick(config.bondingTickUpper), config.bondingLiquidity, false
        );
        requiredNative = SqrtPriceMath.getAmount0Delta(
            endpoint, TickMath.getSqrtPriceAtTick(FINAL_TICK_UPPER), config.finalLiquidity, true
        );
        requiredToken = SqrtPriceMath.getAmount1Delta(
            TickMath.getSqrtPriceAtTick(FINAL_TICK_LOWER), endpoint, config.finalLiquidity, true
        );
    }

    function _netFromGross(uint256 grossNativeAmount, uint16 feeBps, uint16 basisPoints)
        private
        pure
        returns (uint256)
    {
        return grossNativeAmount - FullMath.mulDiv(grossNativeAmount, feeBps, basisPoints);
    }

    function _graduationPlan(PoolKey memory key) private view returns (bytes memory unlockData) {
        bytes memory actions = abi.encodePacked(
            uint8(Actions.BURN_POSITION), uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE), uint8(Actions.TAKE_PAIR)
        );
        bytes[] memory params = new bytes[](4);
        params[0] = abi.encode(bondingPositionTokenId, bondingNativePrincipal.toUint128(), uint128(0), bytes(""));
        params[1] = abi.encode(
            key,
            FINAL_TICK_LOWER,
            FINAL_TICK_UPPER,
            uint256(finalLiquidity),
            finalNativeLiquidityAmount.toUint128(),
            finalTokenLiquidityAmount.toUint128(),
            finalPositionRecipient,
            bytes("")
        );
        params[2] = abi.encode(key.currency1, finalTokenLiquidityAmount, false);
        params[3] = abi.encode(key.currency0, key.currency1, address(this));
        unlockData = abi.encode(actions, params);
    }

    function _assertBondingPosition(PoolKey memory expectedKey) private view {
        address owner;
        try IERC721(address(positionManager)).ownerOf(bondingPositionTokenId) returns (address owner_) {
            owner = owner_;
        } catch {
            revert BondingPositionDoesNotExist(bondingPositionTokenId);
        }
        if (owner != address(this)) revert BondingPositionOwnerMismatch(owner, address(this));

        (PoolKey memory actualKey, PositionInfo info) = positionManager.getPoolAndPositionInfo(bondingPositionTokenId);
        bytes32 actualPoolId = PoolId.unwrap(actualKey.toId());
        bytes32 expectedPoolId = PoolId.unwrap(expectedKey.toId());
        if (actualPoolId != expectedPoolId) revert BondingPositionPoolMismatch(actualPoolId, expectedPoolId);
        if (info.tickLower() != bondingTickLower || info.tickUpper() != bondingTickUpper) {
            revert BondingPositionRangeMismatch(info.tickLower(), info.tickUpper(), bondingTickLower, bondingTickUpper);
        }
        if (info.hasSubscriber()) revert BondingPositionSubscribed(bondingPositionTokenId);

        uint128 actualLiquidity = positionManager.getPositionLiquidity(bondingPositionTokenId);
        if (actualLiquidity != bondingLiquidity) {
            revert BondingPositionLiquidityMismatch(actualLiquidity, bondingLiquidity);
        }
    }

    function _assertFinalPosition(PoolKey memory expectedKey, uint256 tokenId) private view {
        address owner = IERC721(address(positionManager)).ownerOf(tokenId);
        if (owner != finalPositionRecipient) revert FinalPositionOwnerMismatch(owner, finalPositionRecipient);

        (PoolKey memory actualKey, PositionInfo info) = positionManager.getPoolAndPositionInfo(tokenId);
        bytes32 actualPoolId = PoolId.unwrap(actualKey.toId());
        bytes32 expectedPoolId = PoolId.unwrap(expectedKey.toId());
        if (actualPoolId != expectedPoolId) revert FinalPositionPoolMismatch(actualPoolId, expectedPoolId);
        if (info.tickLower() != FINAL_TICK_LOWER || info.tickUpper() != FINAL_TICK_UPPER) {
            revert FinalPositionRangeMismatch(info.tickLower(), info.tickUpper(), FINAL_TICK_LOWER, FINAL_TICK_UPPER);
        }

        uint128 actualLiquidity = positionManager.getPositionLiquidity(tokenId);
        if (actualLiquidity != finalLiquidity) revert FinalPositionLiquidityMismatch(actualLiquidity, finalLiquidity);
    }

    function _assertPoolEndpoint() private view {
        (uint160 actualSqrtPriceX96,,,) = poolManager.getSlot0(PoolId.wrap(poolId));
        if (actualSqrtPriceX96 != endpointSqrtPriceX96) {
            revert EndpointCommitmentMismatch(actualSqrtPriceX96, endpointSqrtPriceX96);
        }
    }

    function _validateDependencies(
        IPositionManager positionManager_,
        LockedPositionFeeForwarderFactoryV1 positionForwarderFactory_
    ) private view {
        if (address(positionManager_) == address(0) || address(positionManager_).code.length == 0) {
            revert InvalidDependency(address(positionManager_));
        }
        IPoolManager poolManager_ = positionManager_.poolManager();
        if (address(poolManager_) == address(0) || address(poolManager_).code.length == 0) {
            revert InvalidPositionManager(address(0), address(poolManager_));
        }
        if (address(positionForwarderFactory_) == address(0) || address(positionForwarderFactory_).code.length == 0) {
            revert InvalidDependency(address(positionForwarderFactory_));
        }
        if (address(positionForwarderFactory_.positionManager()) != address(positionManager_)) {
            revert InvalidPositionManagerFactory(
                address(positionManager_), address(positionForwarderFactory_.positionManager())
            );
        }
    }

    function _validateConfig(
        IPositionManager positionManager_,
        LockedPositionFeeForwarderFactoryV1 positionForwarderFactory_,
        ClassicGraduationConfigV1 memory config
    ) private view {
        address currency0 = Currency.unwrap(config.poolKey.currency0);
        address currency1 = Currency.unwrap(config.poolKey.currency1);
        if (currency0 != address(0) || currency1 == address(0) || currency1.code.length == 0) {
            revert InvalidPoolCurrency(currency0, currency1);
        }
        address hook = address(config.poolKey.hooks);
        if (hook == address(0) || hook.code.length == 0) revert InvalidPoolHook(hook);
        if (config.poolKey.fee != LP_FEE_PIPS) revert InvalidLpFee(config.poolKey.fee, LP_FEE_PIPS);
        if (config.poolKey.tickSpacing != TICK_SPACING) {
            revert InvalidTickSpacing(config.poolKey.tickSpacing, TICK_SPACING);
        }
        if (
            config.bondingTickLower <= FINAL_TICK_LOWER || config.bondingTickUpper >= FINAL_TICK_UPPER
                || config.bondingTickLower >= config.bondingTickUpper || config.bondingTickLower % TICK_SPACING != 0
                || config.bondingTickUpper % TICK_SPACING != 0
        ) {
            revert InvalidBondingRange(config.bondingTickLower, config.bondingTickUpper);
        }
        if (config.bondingLiquidity == 0) revert InvalidBondingLiquidity();
        if (config.finalLiquidity == 0) revert InvalidFinalLiquidity();

        address recipient = config.finalPositionRecipient;
        if (recipient == address(0) || recipient.code.length == 0) revert InvalidFinalPositionRecipient(recipient);
        if (positionForwarderFactory_.configurationHashOf(recipient) == bytes32(0)) {
            revert InvalidForwarderConfiguration(recipient);
        }

        PositionFeesForwarder forwarder = PositionFeesForwarder(payable(recipient));
        if (
            address(forwarder.positionManager()) != address(positionManager_) || forwarder.operator() != address(0)
                || forwarder.timelockBlockNumber() != type(uint256).max
        ) {
            revert InvalidForwarderConfiguration(recipient);
        }
    }

    /// @notice Accepts only native dust returned by PositionManager's fixed TAKE_PAIR recipient.
    receive() external payable { }
}
