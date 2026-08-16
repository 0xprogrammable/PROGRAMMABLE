// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { SignedMath } from "@openzeppelin/contracts/utils/math/SignedMath.sol";
import { BaseHook } from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import { CurrencySettler } from "@openzeppelin/uniswap-hooks/src/utils/CurrencySettler.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { LPFeeLibrary } from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {
    BeforeSwapDelta,
    BeforeSwapDeltaLibrary,
    toBeforeSwapDelta
} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";

/// @title ProgrammableVolumeFeeHookV1
/// @notice Reference candidate for the Programmable volume-fee policy.
/// @dev This contract is not independently audited or deployed. It is a one-pool starter that must be adapted,
///      rebuilt, tested, reviewed and deployed through the full launch process before it can collect live fees.
contract ProgrammableVolumeFeeHookV1 is BaseHook, IUnlockCallback, ReentrancyGuardTransient {
    using BeforeSwapDeltaLibrary for BeforeSwapDelta;
    using CurrencySettler for Currency;
    using LPFeeLibrary for uint24;
    using SafeCast for *;

    uint256 public constant RATE_DENOMINATOR = 1_000_000;
    uint32 public constant PROGRAMMABLE_HUNDREDTHS_OF_BIP = 1000;
    uint32 public constant MINIMUM_EFFECTIVE_HUNDREDTHS_OF_BIP = 1000;
    uint32 public constant MAX_SELECTED_HUNDREDTHS_OF_BIP = 100_000;
    uint24 public constant MAX_EXACT_OUTPUT_COMPATIBLE_LP_FEE = 999_998;
    uint256 public constant MIN_GROSS_QUOTE_AMOUNT = 1000;
    bool public constant SAME_POOL_SWAP_FORBIDDEN = true;
    address public constant PROGRAMMABLE_FEE_OWNER = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    bytes32 public constant PROGRAMMABLE_FEE_POLICY_HASH = keccak256("programmable-volume-fee-v1");

    bytes4 private constant CLAIM_UNLOCK_MAGIC = bytes4(keccak256("PROGRAMMABLE_VOLUME_FEE_V1_CLAIM"));

    address public immutable registrar;
    address public immutable quoteCurrencyAddress;

    bytes32 public canonicalPoolId;
    bool public canonicalPoolRegistered;
    bool public quoteIsCurrency0;
    address public projectFeeOwner;
    uint32 public selectedBuyHundredthsOfBip;
    uint32 public selectedSellHundredthsOfBip;
    uint256 public totalQuoteFeesAccrued;
    uint256 public programmableFeeRemainder;
    uint256 public projectFeeRemainder;
    uint256 private _pendingSpecifiedQuotePoolAmountPlusOne;
    mapping(bytes32 poolId => mapping(address currency => mapping(address owner => uint256 amount))) private
        _claimableLiability;

    error AlreadyRegistered(bytes32 poolId);
    error CurrenciesOutOfOrderOrEqual(address currency0, address currency1);
    error ExactOutputRoundingUnsupported(uint256 netQuoteAmount, uint32 effectiveHundredthsOfBip);
    error InvalidHook(address actual, address expected);
    error InvalidLpFee(uint24 fee);
    error InvalidProjectFeeOwner(address owner);
    error InvalidQuoteCurrency(address currency0, address currency1, address expectedQuoteCurrency);
    error InvalidSelectedTotalFee(uint32 selectedHundredthsOfBip);
    error InvalidTickSpacing(int24 tickSpacing);
    error LiabilityInvariantBroken(uint256 total, uint256 project, uint256 programmable);
    error NoFeesToClaim();
    error PartialFillUnsupported(uint256 expectedQuotePoolAmount, uint256 actualQuotePoolAmount);
    error PendingSpecifiedQuoteCallback();
    error PoolNotRegistered();
    error QuoteAmountBelowFeeQuantum(uint256 grossQuoteAmount, uint256 minimumGrossQuoteAmount);
    error UnauthorizedClaim(address caller, address expected);
    error UnauthorizedInitializer(address caller, address expected);
    error UnauthorizedRegistrar(address caller, address expected);
    error UnexpectedPool(bytes32 actual, bytes32 expected);
    error UnexpectedUnlockData();
    error UnexpectedUnlockResult();
    error ZeroAddress();

    event CanonicalPoolRegistered(
        bytes32 indexed poolId,
        address indexed quoteCurrency,
        address indexed projectFeeOwner,
        uint32 selectedBuyHundredthsOfBip,
        uint32 selectedSellHundredthsOfBip,
        uint32 effectiveBuyHundredthsOfBip,
        uint32 effectiveSellHundredthsOfBip,
        uint32 programmableHundredthsOfBip,
        uint24 lpFeePips
    );
    event QuoteFeesAccrued(
        bytes32 indexed poolId,
        address indexed quoteCurrency,
        address indexed swapSender,
        bool isBuy,
        uint32 selectedHundredthsOfBip,
        uint32 effectiveHundredthsOfBip,
        uint256 grossQuoteAmount,
        uint256 projectFee,
        uint256 programmableFee,
        uint256 projectRemainder,
        uint256 programmableRemainder
    );
    event ProgrammableFeesClaimed(
        bytes32 indexed poolId, address indexed quoteCurrency, address indexed owner, address recipient, uint256 amount
    );
    event ProjectFeesClaimed(
        bytes32 indexed poolId, address indexed quoteCurrency, address indexed owner, address recipient, uint256 amount
    );

    constructor(IPoolManager poolManager_, address registrar_, address quoteCurrencyAddress_) BaseHook(poolManager_) {
        if (address(poolManager_) == address(0) || registrar_ == address(0)) revert ZeroAddress();
        registrar = registrar_;
        // address(0) is the canonical Uniswap v4 representation of native currency, not a missing configuration.
        // slither-disable-next-line missing-zero-check
        quoteCurrencyAddress = quoteCurrencyAddress_;
    }

    /// @notice One-time binding of this hook to its sole canonical PoolKey and immutable fee configuration.
    function registerCanonicalPool(
        PoolKey calldata key,
        address projectFeeOwner_,
        uint32 selectedBuyHundredthsOfBip_,
        uint32 selectedSellHundredthsOfBip_,
        uint160 sqrtPriceX96
    ) external nonReentrant returns (bytes32 poolId, int24 initialTick) {
        if (msg.sender != registrar) {
            revert UnauthorizedRegistrar(msg.sender, registrar);
        }
        if (canonicalPoolRegistered) revert AlreadyRegistered(canonicalPoolId);
        if (projectFeeOwner_ == address(0) || projectFeeOwner_ == PROGRAMMABLE_FEE_OWNER) {
            revert InvalidProjectFeeOwner(projectFeeOwner_);
        }
        _validateSelectedTotalFee(selectedBuyHundredthsOfBip_);
        _validateSelectedTotalFee(selectedSellHundredthsOfBip_);
        _validatePoolShape(key);

        poolId = PoolId.unwrap(key.toId());
        canonicalPoolId = poolId;
        canonicalPoolRegistered = true;
        quoteIsCurrency0 = Currency.unwrap(key.currency0) == quoteCurrencyAddress;
        projectFeeOwner = projectFeeOwner_;
        selectedBuyHundredthsOfBip = selectedBuyHundredthsOfBip_;
        selectedSellHundredthsOfBip = selectedSellHundredthsOfBip_;

        // Registration and initialization are one transaction. A bad initial price or any PoolManager rejection
        // reverts the one-time binding as well, so the hook cannot be permanently bricked by a partial setup.
        initialTick = poolManager.initialize(key, sqrtPriceX96);

        emit CanonicalPoolRegistered(
            poolId,
            quoteCurrencyAddress,
            projectFeeOwner_,
            selectedBuyHundredthsOfBip_,
            selectedSellHundredthsOfBip_,
            effectiveTotalHundredthsOfBip(selectedBuyHundredthsOfBip_),
            effectiveTotalHundredthsOfBip(selectedSellHundredthsOfBip_),
            PROGRAMMABLE_HUNDREDTHS_OF_BIP,
            key.fee
        );
    }

    function effectiveTotalHundredthsOfBip(uint32 selectedHundredthsOfBip) public pure returns (uint32) {
        _validateSelectedTotalFee(selectedHundredthsOfBip);
        return selectedHundredthsOfBip < MINIMUM_EFFECTIVE_HUNDREDTHS_OF_BIP
            ? MINIMUM_EFFECTIVE_HUNDREDTHS_OF_BIP
            : selectedHundredthsOfBip;
    }

    function feeRates(bool isBuy)
        external
        view
        returns (
            uint32 selectedHundredthsOfBip,
            uint32 effectiveHundredthsOfBip,
            uint32 projectHundredthsOfBip,
            uint32 programmableHundredthsOfBip
        )
    {
        if (!canonicalPoolRegistered) revert PoolNotRegistered();
        selectedHundredthsOfBip = isBuy ? selectedBuyHundredthsOfBip : selectedSellHundredthsOfBip;
        effectiveHundredthsOfBip = effectiveTotalHundredthsOfBip(selectedHundredthsOfBip);
        projectHundredthsOfBip = effectiveHundredthsOfBip - PROGRAMMABLE_HUNDREDTHS_OF_BIP;
        programmableHundredthsOfBip = PROGRAMMABLE_HUNDREDTHS_OF_BIP;
    }

    function quoteGrossFees(uint256 grossQuoteAmount, uint32 selectedHundredthsOfBip)
        external
        view
        returns (uint256 totalFee, uint256 projectFee, uint256 programmableFee)
    {
        (totalFee, projectFee, programmableFee,,) = _feesForGross(grossQuoteAmount, selectedHundredthsOfBip);
    }

    function quoteExactOutputFees(uint256 netQuoteAmount, uint32 selectedHundredthsOfBip)
        external
        view
        returns (uint256 grossQuoteAmount, uint256 totalFee, uint256 projectFee, uint256 programmableFee)
    {
        (grossQuoteAmount, totalFee, projectFee, programmableFee,,) =
            _feesForNet(netQuoteAmount, selectedHundredthsOfBip);
    }

    function claimableLiability(bytes32 poolId, address currency, address owner) external view returns (uint256) {
        return _claimableLiability[poolId][currency][owner];
    }

    function programmableFeesAccrued() public view returns (uint256) {
        return _claimableLiability[canonicalPoolId][quoteCurrencyAddress][PROGRAMMABLE_FEE_OWNER];
    }

    function projectFeesAccrued() public view returns (uint256) {
        return _claimableLiability[canonicalPoolId][quoteCurrencyAddress][projectFeeOwner];
    }

    /// @notice Only the exact immutable Programmable owner may initiate a claim and choose its destination.
    function claimProgrammableFees(address recipient) external nonReentrant returns (uint256 amount) {
        if (msg.sender != PROGRAMMABLE_FEE_OWNER) revert UnauthorizedClaim(msg.sender, PROGRAMMABLE_FEE_OWNER);
        if (recipient == address(0)) revert ZeroAddress();
        if (!canonicalPoolRegistered) revert PoolNotRegistered();
        amount = programmableFeesAccrued();
        if (amount == 0) revert NoFeesToClaim();

        _claimableLiability[canonicalPoolId][quoteCurrencyAddress][PROGRAMMABLE_FEE_OWNER] = 0;
        totalQuoteFeesAccrued -= amount;
        _redeemQuote(recipient, amount);
        emit ProgrammableFeesClaimed(canonicalPoolId, quoteCurrencyAddress, PROGRAMMABLE_FEE_OWNER, recipient, amount);
    }

    function claimProjectFees(address recipient) external nonReentrant returns (uint256 amount) {
        if (msg.sender != projectFeeOwner) revert UnauthorizedClaim(msg.sender, projectFeeOwner);
        if (recipient == address(0)) revert ZeroAddress();
        if (!canonicalPoolRegistered) revert PoolNotRegistered();
        amount = projectFeesAccrued();
        if (amount == 0) revert NoFeesToClaim();

        _claimableLiability[canonicalPoolId][quoteCurrencyAddress][projectFeeOwner] = 0;
        totalQuoteFeesAccrued -= amount;
        _redeemQuote(recipient, amount);
        emit ProjectFeesClaimed(canonicalPoolId, quoteCurrencyAddress, projectFeeOwner, recipient, amount);
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory permissions) {
        return Hooks.Permissions({
            beforeInitialize: true,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: true,
            afterSwapReturnDelta: true,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    function _beforeInitialize(address sender, PoolKey calldata key, uint160) internal view override returns (bytes4) {
        _requireCanonicalPool(key);
        if (sender != address(this)) revert UnauthorizedInitializer(sender, address(this));
        return IHooks.beforeInitialize.selector;
    }

    function _beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        _requireCanonicalPool(key);
        bool exactInput = params.amountSpecified < 0;
        bool specifiedIsCurrency0 = params.zeroForOne == exactInput;
        bool quoteIsSpecified = specifiedIsCurrency0 == quoteIsCurrency0;
        if (!quoteIsSpecified) return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);

        bool isBuy = params.zeroForOne == quoteIsCurrency0;
        uint32 selected = isBuy ? selectedBuyHundredthsOfBip : selectedSellHundredthsOfBip;
        uint256 quoteAmount = _absolute(params.amountSpecified);
        if (_pendingSpecifiedQuotePoolAmountPlusOne != 0) revert PendingSpecifiedQuoteCallback();
        uint256 totalFee = _chargeQuote(sender, isBuy, quoteAmount, !exactInput, selected);
        uint256 expectedQuotePoolAmount = exactInput ? quoteAmount - totalFee : quoteAmount + totalFee;
        _pendingSpecifiedQuotePoolAmountPlusOne = expectedQuotePoolAmount + 1;
        if (totalFee == 0) return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(totalFee.toInt256().toInt128(), 0), 0);
    }

    function _afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata
    ) internal override returns (bytes4, int128) {
        _requireCanonicalPool(key);
        bool exactInput = params.amountSpecified < 0;
        bool specifiedIsCurrency0 = params.zeroForOne == exactInput;
        bool quoteIsSpecified = specifiedIsCurrency0 == quoteIsCurrency0;
        bool isBuy = params.zeroForOne == quoteIsCurrency0;
        uint32 selected = isBuy ? selectedBuyHundredthsOfBip : selectedSellHundredthsOfBip;

        if (quoteIsSpecified) {
            uint256 pendingPlusOne = _pendingSpecifiedQuotePoolAmountPlusOne;
            if (pendingPlusOne == 0) revert PendingSpecifiedQuoteCallback();
            uint256 expectedQuotePoolAmount = pendingPlusOne - 1;
            _pendingSpecifiedQuotePoolAmountPlusOne = 0;
            uint256 actualQuotePoolAmount = _absolute(_quoteDelta(delta));
            if (actualQuotePoolAmount != expectedQuotePoolAmount) {
                revert PartialFillUnsupported(expectedQuotePoolAmount, actualQuotePoolAmount);
            }
            return (IHooks.afterSwap.selector, 0);
        }

        uint256 executedQuoteAmount = _absolute(_quoteDelta(delta));
        uint256 executedTotalFee = _chargeQuote(sender, isBuy, executedQuoteAmount, !exactInput, selected);
        if (executedTotalFee == 0) return (IHooks.afterSwap.selector, 0);
        return (IHooks.afterSwap.selector, executedTotalFee.toInt256().toInt128());
    }

    function unlockCallback(bytes calldata data) external onlyPoolManager returns (bytes memory) {
        (bytes4 magic, address recipient, uint256 amount) = abi.decode(data, (bytes4, address, uint256));
        if (magic != CLAIM_UNLOCK_MAGIC || recipient == address(0) || amount == 0) revert UnexpectedUnlockData();

        Currency quote = Currency.wrap(quoteCurrencyAddress);
        quote.settle(poolManager, address(this), amount, true);
        quote.take(poolManager, recipient, amount, false);
        return "";
    }

    function _chargeQuote(
        address sender,
        bool isBuy,
        uint256 quoteAmount,
        bool amountIsNet,
        uint32 selectedHundredthsOfBip
    ) private returns (uint256 totalFee) {
        uint256 grossQuoteAmount;
        uint256 projectFee;
        uint256 programmableFee;
        uint256 nextProjectRemainder;
        uint256 nextProgrammableRemainder;
        if (amountIsNet) {
            (grossQuoteAmount, totalFee, projectFee, programmableFee, nextProjectRemainder, nextProgrammableRemainder) =
                _feesForNet(quoteAmount, selectedHundredthsOfBip);
        } else {
            grossQuoteAmount = quoteAmount;
            (totalFee, projectFee, programmableFee, nextProjectRemainder, nextProgrammableRemainder) =
                _feesForGross(grossQuoteAmount, selectedHundredthsOfBip);
        }
        if (grossQuoteAmount == 0) return 0;

        projectFeeRemainder = nextProjectRemainder;
        programmableFeeRemainder = nextProgrammableRemainder;

        _claimableLiability[canonicalPoolId][quoteCurrencyAddress][projectFeeOwner] += projectFee;
        _claimableLiability[canonicalPoolId][quoteCurrencyAddress][PROGRAMMABLE_FEE_OWNER] += programmableFee;
        totalQuoteFeesAccrued += totalFee;
        uint256 projectLiability = projectFeesAccrued();
        uint256 programmableLiability = programmableFeesAccrued();
        if (totalQuoteFeesAccrued != projectLiability + programmableLiability) {
            revert LiabilityInvariantBroken(totalQuoteFeesAccrued, projectLiability, programmableLiability);
        }

        emit QuoteFeesAccrued(
            canonicalPoolId,
            quoteCurrencyAddress,
            sender,
            isBuy,
            selectedHundredthsOfBip,
            effectiveTotalHundredthsOfBip(selectedHundredthsOfBip),
            grossQuoteAmount,
            projectFee,
            programmableFee,
            nextProjectRemainder,
            nextProgrammableRemainder
        );
        if (totalFee != 0) Currency.wrap(quoteCurrencyAddress).take(poolManager, address(this), totalFee, true);
    }

    function _feesForGross(uint256 grossQuoteAmount, uint32 selectedHundredthsOfBip)
        private
        view
        returns (
            uint256 totalFee,
            uint256 projectFee,
            uint256 programmableFee,
            uint256 nextProjectRemainder,
            uint256 nextProgrammableRemainder
        )
    {
        uint32 effective = effectiveTotalHundredthsOfBip(selectedHundredthsOfBip);
        if (grossQuoteAmount != 0 && grossQuoteAmount < MIN_GROSS_QUOTE_AMOUNT) {
            revert QuoteAmountBelowFeeQuantum(grossQuoteAmount, MIN_GROSS_QUOTE_AMOUNT);
        }
        (programmableFee, nextProgrammableRemainder) =
            _accumulateRate(grossQuoteAmount, PROGRAMMABLE_HUNDREDTHS_OF_BIP, programmableFeeRemainder);
        (projectFee, nextProjectRemainder) =
            _accumulateRate(grossQuoteAmount, effective - PROGRAMMABLE_HUNDREDTHS_OF_BIP, projectFeeRemainder);
        totalFee = projectFee + programmableFee;
    }

    function _feesForNet(uint256 netQuoteAmount, uint32 selectedHundredthsOfBip)
        private
        view
        returns (
            uint256 grossQuoteAmount,
            uint256 totalFee,
            uint256 projectFee,
            uint256 programmableFee,
            uint256 nextProjectRemainder,
            uint256 nextProgrammableRemainder
        )
    {
        uint32 effective = effectiveTotalHundredthsOfBip(selectedHundredthsOfBip);
        if (netQuoteAmount == 0) {
            return (0, 0, 0, 0, projectFeeRemainder, programmableFeeRemainder);
        }

        uint256 estimate = FullMath.mulDivRoundingUp(netQuoteAmount, RATE_DENOMINATOR, RATE_DENOMINATOR - effective);
        uint256 candidate = estimate > 8 ? estimate - 8 : MIN_GROSS_QUOTE_AMOUNT;
        if (candidate < MIN_GROSS_QUOTE_AMOUNT) candidate = MIN_GROSS_QUOTE_AMOUNT;
        for (uint256 index; index < 17; ++index) {
            (
                uint256 candidateTotal,
                uint256 candidateProject,
                uint256 candidateProgrammable,
                uint256 candidateProjectRemainder,
                uint256 candidateProgrammableRemainder
            ) = _feesForGross(candidate, selectedHundredthsOfBip);
            if (candidateTotal <= candidate && candidate - candidateTotal == netQuoteAmount) {
                return (
                    candidate,
                    candidateTotal,
                    candidateProject,
                    candidateProgrammable,
                    candidateProjectRemainder,
                    candidateProgrammableRemainder
                );
            }
            ++candidate;
        }
        revert ExactOutputRoundingUnsupported(netQuoteAmount, effective);
    }

    function _accumulateRate(uint256 grossQuoteAmount, uint32 rate, uint256 carriedRemainder)
        private
        pure
        returns (uint256 fee, uint256 nextRemainder)
    {
        fee = FullMath.mulDiv(grossQuoteAmount, rate, RATE_DENOMINATOR);
        uint256 fractional = mulmod(grossQuoteAmount, rate, RATE_DENOMINATOR);
        uint256 combinedRemainder = fractional + carriedRemainder;
        fee += combinedRemainder / RATE_DENOMINATOR;
        nextRemainder = combinedRemainder % RATE_DENOMINATOR;
    }

    function _redeemQuote(address recipient, uint256 amount) private {
        bytes memory result = poolManager.unlock(abi.encode(CLAIM_UNLOCK_MAGIC, recipient, amount));
        if (result.length != 0) revert UnexpectedUnlockResult();
    }

    function _requireCanonicalPool(PoolKey calldata key) private view returns (bytes32 poolId) {
        if (!canonicalPoolRegistered) revert PoolNotRegistered();
        _validatePoolShape(key);
        poolId = PoolId.unwrap(key.toId());
        if (poolId != canonicalPoolId) revert UnexpectedPool(poolId, canonicalPoolId);
    }

    function _validatePoolShape(PoolKey calldata key) private view {
        if (address(key.hooks) != address(this)) revert InvalidHook(address(key.hooks), address(this));
        address currency0 = Currency.unwrap(key.currency0);
        address currency1 = Currency.unwrap(key.currency1);
        if (currency0 >= currency1) revert CurrenciesOutOfOrderOrEqual(currency0, currency1);
        if (key.tickSpacing < TickMath.MIN_TICK_SPACING || key.tickSpacing > TickMath.MAX_TICK_SPACING) {
            revert InvalidTickSpacing(key.tickSpacing);
        }
        // This small reference kernel intentionally supports static LP fees only. A dynamic LP fee needs custom
        // update logic in the same hook and belongs in the custom-hook path.
        if (!key.fee.isValid() || key.fee > MAX_EXACT_OUTPUT_COMPATIBLE_LP_FEE) revert InvalidLpFee(key.fee);
        if (currency0 != quoteCurrencyAddress && currency1 != quoteCurrencyAddress) {
            revert InvalidQuoteCurrency(currency0, currency1, quoteCurrencyAddress);
        }
    }

    function _validateSelectedTotalFee(uint32 selectedHundredthsOfBip) private pure {
        if (selectedHundredthsOfBip > MAX_SELECTED_HUNDREDTHS_OF_BIP) {
            revert InvalidSelectedTotalFee(selectedHundredthsOfBip);
        }
    }

    function _quoteDelta(BalanceDelta delta) private view returns (int256) {
        return quoteIsCurrency0 ? int256(delta.amount0()) : int256(delta.amount1());
    }

    function _absolute(int256 value) private pure returns (uint256) {
        return SignedMath.abs(value);
    }
}
