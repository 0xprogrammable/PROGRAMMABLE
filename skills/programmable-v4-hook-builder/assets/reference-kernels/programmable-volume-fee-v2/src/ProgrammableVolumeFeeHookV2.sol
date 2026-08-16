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

/// @title ProgrammableVolumeFeeHookV2
/// @notice Reference kernel for the v2 `standard-amm` Programmable volume-fee collection profile.
/// @dev This is an unaudited, undeployed, one-pool reference accelerator. It deliberately reverts when an atomic
///      standard-AMM swap cannot fully fund both fee components. Batch, sponsored, custom-accounting and collateral
///      settlement require their own reviewed profile implementation; this contract does not pretend to implement them.
contract ProgrammableVolumeFeeHookV2 is BaseHook, IUnlockCallback, ReentrancyGuardTransient {
    using BeforeSwapDeltaLibrary for BeforeSwapDelta;
    using CurrencySettler for Currency;
    using LPFeeLibrary for uint24;
    using SafeCast for *;

    uint256 public constant RATE_DENOMINATOR = 1_000_000;
    uint32 public constant PROGRAMMABLE_HUNDREDTHS_OF_BIP = 1000;
    uint32 public constant MINIMUM_EFFECTIVE_HUNDREDTHS_OF_BIP = 1000;
    uint32 public constant MAX_SELECTED_HUNDREDTHS_OF_BIP = 999_999;
    uint24 public constant MAX_EXACT_OUTPUT_COMPATIBLE_LP_FEE = 999_999;
    bool public constant SAME_POOL_SWAP_FORBIDDEN = true;
    address public constant PROGRAMMABLE_FEE_OWNER = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    bytes32 public constant PROGRAMMABLE_FEE_POLICY_HASH = keccak256("programmable-volume-fee-v2@2.0.0");
    bytes32 public constant COLLECTION_PROFILE_HASH = keccak256("standard-amm");
    bytes32 public constant RUNTIME_CONFIGURATION_DOMAIN =
        keccak256("ProgrammableVolumeFeeHookV2.runtime-configuration.v1");

    bytes4 private constant CLAIM_UNLOCK_MAGIC = bytes4(keccak256("PROGRAMMABLE_VOLUME_FEE_V2_CLAIM"));

    address public immutable registrar;
    address public immutable quoteCurrencyAddress;

    bytes32 public canonicalPoolId;
    bool public canonicalPoolRegistered;
    bool public runtimeConfigurationFinalized;
    bool public quoteIsCurrency0;
    address public canonicalCurrency0Address;
    address public canonicalCurrency1Address;
    uint24 public canonicalPoolLpFeePips;
    int24 public canonicalPoolTickSpacing;
    uint160 public canonicalPoolInitialSqrtPriceX96;
    int24 public canonicalPoolInitialTick;
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
    error AlternativeSettlementRequired(uint256 grossQuoteAmount, uint256 totalFee, bytes32 collectionProfileHash);
    error CurrenciesOutOfOrderOrEqual(address currency0, address currency1);
    error FeeDeltaOutOfRange(uint256 amount);
    error InvalidExactOutputWitness(uint256 netQuoteAmount, uint256 grossQuoteWitness);
    error InvalidHook(address actual, address expected);
    error InvalidHookDataLength(uint256 actualLength, uint256 expectedLength);
    error InvalidLpFee(uint24 fee);
    error InvalidProjectFeeOwner(address owner);
    error InvalidQuoteCurrency(address currency0, address currency1, address expectedQuoteCurrency);
    error InvalidSelectedTotalFee(uint32 selectedHundredthsOfBip);
    error InvalidTickSpacing(int24 tickSpacing);
    error LiabilityInvariantBroken(uint256 total, uint256 project, uint256 programmable);
    error ClaimNotInProgress();
    error NoFeesToClaim();
    error PartialFillUnsupported(uint256 expectedQuotePoolAmount, uint256 actualQuotePoolAmount);
    error PendingSpecifiedQuoteCallback();
    error PoolNotRegistered();
    error RuntimeConfigurationNotFinalized();
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
        uint24 lpFeePips,
        bytes32 collectionProfileHash,
        bytes32 runtimeConfigurationHash
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
        // address(0) is Uniswap v4 native currency, not an absent configuration.
        // slither-disable-next-line missing-zero-check
        quoteCurrencyAddress = quoteCurrencyAddress_;
        registrar = registrar_;
    }

    /// @notice Atomically binds and initializes the one supported pool and its immutable fee rates.
    function registerCanonicalPool(
        PoolKey calldata key,
        address projectFeeOwner_,
        uint32 selectedBuyHundredthsOfBip_,
        uint32 selectedSellHundredthsOfBip_,
        uint160 sqrtPriceX96
    ) external nonReentrant returns (bytes32 poolId, int24 initialTick) {
        if (msg.sender != registrar) revert UnauthorizedRegistrar(msg.sender, registrar);
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
        canonicalCurrency0Address = Currency.unwrap(key.currency0);
        canonicalCurrency1Address = Currency.unwrap(key.currency1);
        canonicalPoolLpFeePips = key.fee;
        canonicalPoolTickSpacing = key.tickSpacing;
        canonicalPoolInitialSqrtPriceX96 = sqrtPriceX96;
        projectFeeOwner = projectFeeOwner_;
        selectedBuyHundredthsOfBip = selectedBuyHundredthsOfBip_;
        selectedSellHundredthsOfBip = selectedSellHundredthsOfBip_;

        // Registration is non-reentrant, and initialization can only enter this hook through the authenticated,
        // view-only `beforeInitialize` callback. The returned tick cannot be committed before this call completes.
        // slither-disable-next-line reentrancy-benign
        initialTick = poolManager.initialize(key, sqrtPriceX96);
        canonicalPoolInitialTick = initialTick;
        runtimeConfigurationFinalized = true;
        emit CanonicalPoolRegistered(
            poolId,
            quoteCurrencyAddress,
            projectFeeOwner_,
            selectedBuyHundredthsOfBip_,
            selectedSellHundredthsOfBip_,
            effectiveTotalHundredthsOfBip(selectedBuyHundredthsOfBip_),
            effectiveTotalHundredthsOfBip(selectedSellHundredthsOfBip_),
            PROGRAMMABLE_HUNDREDTHS_OF_BIP,
            key.fee,
            COLLECTION_PROFILE_HASH,
            runtimeConfigurationHash()
        );
    }

    /// @notice Complete, immutable post-registration configuration receipt for this one-pool kernel.
    /// @dev Unlike the factory's deployment hash, this binds the exact PoolKey, initialization, owners and rates.
    function runtimeConfigurationHash() public view returns (bytes32) {
        if (!runtimeConfigurationFinalized) revert RuntimeConfigurationNotFinalized();
        return keccak256(
            abi.encode(
                RUNTIME_CONFIGURATION_DOMAIN,
                block.chainid,
                address(this),
                address(poolManager),
                registrar,
                quoteCurrencyAddress,
                PROGRAMMABLE_FEE_OWNER,
                PROGRAMMABLE_HUNDREDTHS_OF_BIP,
                PROGRAMMABLE_FEE_POLICY_HASH,
                COLLECTION_PROFILE_HASH,
                canonicalPoolId,
                canonicalCurrency0Address,
                canonicalCurrency1Address,
                quoteIsCurrency0,
                canonicalPoolLpFeePips,
                canonicalPoolTickSpacing,
                canonicalPoolInitialSqrtPriceX96,
                canonicalPoolInitialTick,
                projectFeeOwner,
                selectedBuyHundredthsOfBip,
                selectedSellHundredthsOfBip,
                effectiveTotalHundredthsOfBip(selectedBuyHundredthsOfBip),
                effectiveTotalHundredthsOfBip(selectedSellHundredthsOfBip)
            )
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

    /// @notice Pure policy math with explicit carried remainders for offchain simulation and property testing.
    function previewGrossFees(
        uint256 grossQuoteAmount,
        uint32 selectedHundredthsOfBip,
        uint256 carriedProgrammableRemainder,
        uint256 carriedProjectRemainder
    )
        public
        pure
        returns (
            uint256 totalFee,
            uint256 projectFee,
            uint256 programmableFee,
            uint256 nextProjectRemainder,
            uint256 nextProgrammableRemainder,
            bool atomicStandardAmmReady
        )
    {
        if (carriedProgrammableRemainder >= RATE_DENOMINATOR || carriedProjectRemainder >= RATE_DENOMINATOR) {
            revert InvalidExactOutputWitness(0, grossQuoteAmount);
        }
        uint32 effective = effectiveTotalHundredthsOfBip(selectedHundredthsOfBip);
        (programmableFee, nextProgrammableRemainder) =
            _accumulateRate(grossQuoteAmount, PROGRAMMABLE_HUNDREDTHS_OF_BIP, carriedProgrammableRemainder);
        (projectFee, nextProjectRemainder) =
            _accumulateRate(grossQuoteAmount, effective - PROGRAMMABLE_HUNDREDTHS_OF_BIP, carriedProjectRemainder);
        totalFee = projectFee + programmableFee;
        atomicStandardAmmReady = grossQuoteAmount == 0 ? totalFee == 0 : totalFee < grossQuoteAmount;
    }

    function quoteGrossFees(uint256 grossQuoteAmount, uint32 selectedHundredthsOfBip)
        external
        view
        returns (
            uint256 totalFee,
            uint256 projectFee,
            uint256 programmableFee,
            uint256 nextProjectRemainder,
            uint256 nextProgrammableRemainder,
            bool atomicStandardAmmReady
        )
    {
        return previewGrossFees(
            grossQuoteAmount, selectedHundredthsOfBip, programmableFeeRemainder, projectFeeRemainder
        );
    }

    /// @notice Verifies an offchain-provided exact-output witness against the current onchain remainders.
    function quoteExactOutputWitness(uint256 netQuoteAmount, uint256 grossQuoteWitness, uint32 selectedHundredthsOfBip)
        external
        view
        returns (
            bool valid,
            uint256 totalFee,
            uint256 projectFee,
            uint256 programmableFee,
            uint256 nextProjectRemainder,
            uint256 nextProgrammableRemainder
        )
    {
        bool ready;
        (totalFee, projectFee, programmableFee, nextProjectRemainder, nextProgrammableRemainder, ready) =
            previewGrossFees(grossQuoteWitness, selectedHundredthsOfBip, programmableFeeRemainder, projectFeeRemainder);
        valid = ready && grossQuoteWitness - totalFee == netQuoteAmount;
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

    function claimProgrammableFees(address recipient) external nonReentrant returns (uint256 amount) {
        if (msg.sender != PROGRAMMABLE_FEE_OWNER) revert UnauthorizedClaim(msg.sender, PROGRAMMABLE_FEE_OWNER);
        amount = _prepareClaim(recipient, PROGRAMMABLE_FEE_OWNER);
        _redeemQuote(recipient, amount);
        emit ProgrammableFeesClaimed(canonicalPoolId, quoteCurrencyAddress, PROGRAMMABLE_FEE_OWNER, recipient, amount);
    }

    function claimProjectFees(address recipient) external nonReentrant returns (uint256 amount) {
        if (msg.sender != projectFeeOwner) revert UnauthorizedClaim(msg.sender, projectFeeOwner);
        amount = _prepareClaim(recipient, projectFeeOwner);
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

    function _beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        internal
        override
        nonReentrant
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        _requireCanonicalPool(key);
        bool exactInput = params.amountSpecified < 0;
        bool specifiedIsCurrency0 = params.zeroForOne == exactInput;
        bool quoteIsSpecified = specifiedIsCurrency0 == quoteIsCurrency0;
        if (!quoteIsSpecified) return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);

        bool isBuy = params.zeroForOne == quoteIsCurrency0;
        uint32 selected = isBuy ? selectedBuyHundredthsOfBip : selectedSellHundredthsOfBip;
        uint256 specifiedQuoteAmount = _absolute(params.amountSpecified);
        if (_pendingSpecifiedQuotePoolAmountPlusOne != 0) revert PendingSpecifiedQuoteCallback();

        uint256 grossQuoteAmount = exactInput ? specifiedQuoteAmount : _decodeGrossWitness(hookData);
        uint256 totalFee = exactInput
            ? _chargeGross(sender, isBuy, grossQuoteAmount, selected)
            : _chargeWitness(sender, isBuy, specifiedQuoteAmount, grossQuoteAmount, selected);
        uint256 expectedQuotePoolAmount = exactInput ? grossQuoteAmount - totalFee : grossQuoteAmount;
        _pendingSpecifiedQuotePoolAmountPlusOne = expectedQuotePoolAmount + 1;
        if (totalFee == 0) return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(_feeDelta(totalFee), 0), 0);
    }

    function _afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData
    ) internal override nonReentrant returns (bytes4, int128) {
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

        uint256 executedPoolQuoteAmount = _absolute(_quoteDelta(delta));
        uint256 totalFee;
        if (exactInput) {
            totalFee = _chargeGross(sender, isBuy, executedPoolQuoteAmount, selected);
        } else {
            totalFee = _chargeWitness(sender, isBuy, executedPoolQuoteAmount, _decodeGrossWitness(hookData), selected);
        }
        if (totalFee == 0) return (IHooks.afterSwap.selector, 0);
        return (IHooks.afterSwap.selector, _feeDelta(totalFee));
    }

    function unlockCallback(bytes calldata data) external onlyPoolManager returns (bytes memory) {
        // The callback is valid only inside one of the owner-authenticated, non-reentrant claim entrypoints.
        // This also fails closed if a future code path accidentally asks PoolManager to unlock this hook.
        if (!_reentrancyGuardEntered()) revert ClaimNotInProgress();
        (bytes4 magic, address recipient, uint256 amount) = abi.decode(data, (bytes4, address, uint256));
        if (magic != CLAIM_UNLOCK_MAGIC || recipient == address(0) || amount == 0) revert UnexpectedUnlockData();

        Currency quote = Currency.wrap(quoteCurrencyAddress);
        quote.settle(poolManager, address(this), amount, true);
        quote.take(poolManager, recipient, amount, false);
        return "";
    }

    function _chargeGross(address sender, bool isBuy, uint256 grossQuoteAmount, uint32 selected)
        private
        returns (uint256 totalFee)
    {
        uint256 projectFee;
        uint256 programmableFee;
        uint256 nextProjectRemainder;
        uint256 nextProgrammableRemainder;
        bool ready;
        (totalFee, projectFee, programmableFee, nextProjectRemainder, nextProgrammableRemainder, ready) =
            previewGrossFees(grossQuoteAmount, selected, programmableFeeRemainder, projectFeeRemainder);
        if (!ready) revert AlternativeSettlementRequired(grossQuoteAmount, totalFee, COLLECTION_PROFILE_HASH);
        _accrue(
            sender,
            isBuy,
            selected,
            grossQuoteAmount,
            totalFee,
            projectFee,
            programmableFee,
            nextProjectRemainder,
            nextProgrammableRemainder
        );
    }

    function _chargeWitness(
        address sender,
        bool isBuy,
        uint256 netQuoteAmount,
        uint256 grossQuoteWitness,
        uint32 selected
    ) private returns (uint256 totalFee) {
        uint256 projectFee;
        uint256 programmableFee;
        uint256 nextProjectRemainder;
        uint256 nextProgrammableRemainder;
        bool ready;
        (totalFee, projectFee, programmableFee, nextProjectRemainder, nextProgrammableRemainder, ready) =
            previewGrossFees(grossQuoteWitness, selected, programmableFeeRemainder, projectFeeRemainder);
        if (!ready || grossQuoteWitness - totalFee != netQuoteAmount) {
            revert InvalidExactOutputWitness(netQuoteAmount, grossQuoteWitness);
        }
        _accrue(
            sender,
            isBuy,
            selected,
            grossQuoteWitness,
            totalFee,
            projectFee,
            programmableFee,
            nextProjectRemainder,
            nextProgrammableRemainder
        );
    }

    function _accrue(
        address sender,
        bool isBuy,
        uint32 selected,
        uint256 grossQuoteAmount,
        uint256 totalFee,
        uint256 projectFee,
        uint256 programmableFee,
        uint256 nextProjectRemainder,
        uint256 nextProgrammableRemainder
    ) private {
        if (grossQuoteAmount == 0) return;
        if (totalFee > uint256(uint128(type(int128).max))) revert FeeDeltaOutOfRange(totalFee);

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
            selected,
            effectiveTotalHundredthsOfBip(selected),
            grossQuoteAmount,
            projectFee,
            programmableFee,
            nextProjectRemainder,
            nextProgrammableRemainder
        );
        if (totalFee != 0) Currency.wrap(quoteCurrencyAddress).take(poolManager, address(this), totalFee, true);
    }

    function _prepareClaim(address recipient, address owner) private returns (uint256 amount) {
        if (recipient == address(0)) revert ZeroAddress();
        if (!canonicalPoolRegistered) revert PoolNotRegistered();
        amount = _claimableLiability[canonicalPoolId][quoteCurrencyAddress][owner];
        if (amount == 0) revert NoFeesToClaim();
        _claimableLiability[canonicalPoolId][quoteCurrencyAddress][owner] = 0;
        totalQuoteFeesAccrued -= amount;
    }

    function _redeemQuote(address recipient, uint256 amount) private {
        bytes memory result = poolManager.unlock(abi.encode(CLAIM_UNLOCK_MAGIC, recipient, amount));
        if (result.length != 0) revert UnexpectedUnlockResult();
    }

    function _decodeGrossWitness(bytes calldata hookData) private pure returns (uint256 grossQuoteWitness) {
        if (hookData.length != 32) revert InvalidHookDataLength(hookData.length, 32);
        grossQuoteWitness = abi.decode(hookData, (uint256));
    }

    function _feeDelta(uint256 amount) private pure returns (int128) {
        if (amount > uint256(uint128(type(int128).max))) revert FeeDeltaOutOfRange(amount);
        return amount.toInt256().toInt128();
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
