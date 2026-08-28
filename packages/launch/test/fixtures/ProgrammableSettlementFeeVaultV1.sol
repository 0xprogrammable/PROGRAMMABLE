// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IProgrammableSettlementFeeRouteV1 {
    function settlementFeeVault() external view returns (address);
}

/// @title ProgrammableSettlementFeeVaultV1
/// @notice Route-independent custody and accounting for Programmable's fixed 0.10% settlement fee.
/// @dev The one-time bound route supplies the authenticated gross qualifying amount and a canonical path id. The
///      admission analyzer must prove that those values come from the complete settlement dataflow, that every
///      qualifying path reaches exactly one of the two settlement functions, and that path ids are stable rather than
///      caller-grindable. This vault independently fixes the rate and recipient, carries fractional dust, requires
///      exact funding, and gives the route no claim, sweep, redirect, or administrative authority.
contract ProgrammableSettlementFeeVaultV1 is ReentrancyGuard {
    using Address for address payable;
    using SafeERC20 for IERC20;

    uint24 public constant PLATFORM_FEE_PPM = 1000;
    uint24 public constant FEE_DENOMINATOR_PPM = 1_000_000;
    address public constant PLATFORM_FEE_RECIPIENT = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;

    bytes32 private constant ROUTE_BINDING_DOMAIN = keccak256("programmable.settlement-fee-route-binding.v1");
    bytes32 private constant SETTLEMENT_KEY_DOMAIN = keccak256("programmable.settlement-fee-obligation.v1");

    enum SettlementFeeState {
        None,
        Pending,
        Funded,
        Accounted
    }

    struct SettlementFeeRecord {
        bytes32 pathId;
        address currency;
        uint256 grossBasisAmount;
        uint256 platformFeeAmount;
        uint32 previousRemainderPpm;
        uint32 nextRemainderPpm;
        SettlementFeeState state;
    }

    address public bindingAuthority;
    address public authorizedRoute;
    bytes32 public authorizedRouteCodeHash;
    bytes32 public routeBindingHash;
    bool private bindingInProgress;

    mapping(address route => mapping(bytes32 pathId => mapping(address currency => uint32 remainderPpm))) public
        platformFeeRemainderPpm;
    mapping(bytes32 settlementKey => SettlementFeeRecord record) public settlements;

    mapping(address currency => uint256 amount) public pendingPlatformFeeFunding;
    mapping(address currency => uint256 amount) public fundedPlatformFeeFunding;
    mapping(address currency => uint256 amount) public platformFeesAccrued;
    mapping(address currency => uint256 amount) public totalPlatformFeesFunded;
    mapping(address currency => uint256 amount) public totalPlatformFeesClaimed;

    error AccountingInvariantViolation(address currency, uint256 funded, uint256 accrued, uint256 claimed);
    error CurrencyFundingInProgress(address currency, uint256 pending, uint256 funded);
    error IncorrectNativeFunding(uint256 expected, uint256 received);
    error InvalidAddress();
    error InvalidCurrency(address currency);
    error InvalidPathId();
    error InvalidRoute(address route);
    error InvalidRouteBinding(address route);
    error InvalidRouteSettlementId();
    error NoFeesToClaim(address currency);
    error ReentrantRouteBinding();
    error RouteAlreadyBound(address route);
    error RouteBindingStateChanged();
    error RouteCodeHashChanged(bytes32 expected, bytes32 observed);
    error SettlementAlreadyProcessed(bytes32 settlementKey, SettlementFeeState state);
    error SettlementStateInvalid(bytes32 settlementKey, SettlementFeeState expected, SettlementFeeState observed);
    error TokenClaimMismatch(address token, uint256 expected, uint256 vaultDebit, uint256 treasuryCredit);
    error TokenFundingMismatch(address token, uint256 expected, uint256 received);
    error UnauthorizedBinding(address caller);
    error UnauthorizedClaim(address caller);
    error UnauthorizedRoute(address caller);

    event RouteBound(address indexed route, bytes32 indexed routeCodeHash, bytes32 indexed bindingHash);
    event SettlementFeePending(
        bytes32 indexed settlementKey,
        bytes32 indexed routeSettlementId,
        address indexed currency,
        bytes32 pathId,
        uint256 grossBasisAmount,
        uint256 platformFeeAmount,
        uint32 previousRemainderPpm,
        uint32 nextRemainderPpm
    );
    event SettlementFeeFunded(bytes32 indexed settlementKey, address indexed currency, uint256 amount);
    event SettlementFeeAccounted(
        bytes32 indexed settlementKey,
        bytes32 indexed pathId,
        address indexed currency,
        uint256 grossBasisAmount,
        uint256 platformFeeAmount,
        uint32 nextRemainderPpm
    );
    event PlatformFeesClaimed(address indexed currency, address indexed recipient, uint256 amount);

    constructor(address bindingAuthority_) {
        if (bindingAuthority_ == address(0)) revert InvalidAddress();
        bindingAuthority = bindingAuthority_;
    }

    /// @notice Binds one reciprocal route and permanently removes the temporary binding authority.
    /// @dev The launch transaction is expected to deploy both contracts and call this function atomically.
    function bindRoute(address route) external {
        if (bindingInProgress) revert ReentrantRouteBinding();
        if (authorizedRoute != address(0)) revert RouteAlreadyBound(authorizedRoute);
        address authority = bindingAuthority;
        if (msg.sender != authority) revert UnauthorizedBinding(msg.sender);
        if (route == address(0) || route.code.length == 0) revert InvalidRoute(route);

        bytes32 routeCodeHash = route.codehash;
        bindingInProgress = true;
        try IProgrammableSettlementFeeRouteV1(route).settlementFeeVault() returns (address vault) {
            if (vault != address(this)) revert InvalidRouteBinding(route);
        } catch {
            revert InvalidRouteBinding(route);
        }

        if (!bindingInProgress || authorizedRoute != address(0) || bindingAuthority != authority) {
            revert RouteBindingStateChanged();
        }
        bytes32 observedRouteCodeHash = route.codehash;
        if (route.code.length == 0 || observedRouteCodeHash != routeCodeHash) {
            revert RouteCodeHashChanged(routeCodeHash, observedRouteCodeHash);
        }

        bytes32 bindingHash =
            keccak256(abi.encode(ROUTE_BINDING_DOMAIN, block.chainid, address(this), route, routeCodeHash));
        authorizedRoute = route;
        authorizedRouteCodeHash = routeCodeHash;
        routeBindingHash = bindingHash;
        bindingAuthority = address(0);
        bindingInProgress = false;

        emit RouteBound(route, routeCodeHash, bindingHash);
    }

    /// @notice Returns the fee and carried remainder for the current bound route/path/currency accumulator.
    function quoteSettlementFee(bytes32 pathId, address currency, uint256 grossBasisAmount)
        external
        view
        returns (uint256 platformFeeAmount, uint32 nextRemainderPpm)
    {
        if (pathId == bytes32(0)) revert InvalidPathId();
        address route = _boundRoute();
        return _computePlatformFee(grossBasisAmount, platformFeeRemainderPpm[route][pathId][currency]);
    }

    /// @notice Returns the vault-domain settlement key for a route-owned unique settlement id.
    function settlementKey(bytes32 routeSettlementId) public view returns (bytes32 key) {
        if (routeSettlementId == bytes32(0)) revert InvalidRouteSettlementId();
        key = keccak256(
            abi.encode(SETTLEMENT_KEY_DOMAIN, block.chainid, address(this), _boundRoute(), routeSettlementId)
        );
    }

    /// @notice Atomically accounts an exactly funded native-currency fee from the authenticated gross basis.
    function settleNative(bytes32 routeSettlementId, bytes32 pathId, uint256 grossBasisAmount)
        external
        payable
        onlyRoute
        nonReentrant
        returns (bytes32 key, uint256 platformFeeAmount)
    {
        uint32 nextRemainderPpm;
        (key, platformFeeAmount, nextRemainderPpm) =
            _beginSettlement(routeSettlementId, pathId, address(0), grossBasisAmount);
        if (msg.value != platformFeeAmount) {
            revert IncorrectNativeFunding(platformFeeAmount, msg.value);
        }
        _fundAndAccount(key, pathId, address(0), grossBasisAmount, platformFeeAmount, nextRemainderPpm);
    }

    /// @notice Atomically pulls and accounts an exact ERC-20 fee from the bound route.
    /// @dev No-return tokens are accepted. False-return, fee-on-transfer, rebasing-during-call, and balance-mismatch
    ///      behavior reverts the complete settlement, including its dust remainder and settlement id.
    function settleERC20(bytes32 routeSettlementId, bytes32 pathId, address token, uint256 grossBasisAmount)
        external
        onlyRoute
        nonReentrant
        returns (bytes32 key, uint256 platformFeeAmount)
    {
        if (token == address(0) || token.code.length == 0) revert InvalidCurrency(token);

        uint32 nextRemainderPpm;
        (key, platformFeeAmount, nextRemainderPpm) =
            _beginSettlement(routeSettlementId, pathId, token, grossBasisAmount);

        if (platformFeeAmount != 0) {
            IERC20 currency = IERC20(token);
            uint256 balanceBefore = currency.balanceOf(address(this));
            currency.safeTransferFrom(msg.sender, address(this), platformFeeAmount);
            uint256 balanceAfter = currency.balanceOf(address(this));
            uint256 received = balanceAfter >= balanceBefore ? balanceAfter - balanceBefore : 0;
            if (received != platformFeeAmount) {
                revert TokenFundingMismatch(token, platformFeeAmount, received);
            }
        }

        _fundAndAccount(key, pathId, token, grossBasisAmount, platformFeeAmount, nextRemainderPpm);
    }

    /// @notice Pays all currently accounted fees for one currency to the fixed platform treasury.
    /// @dev Native currency is address(0). Direct donations are never added to accounting and cannot be swept.
    function claimPlatformFees(address currency) external onlyTreasury nonReentrant returns (uint256 amount) {
        uint256 pending = pendingPlatformFeeFunding[currency];
        uint256 fundedPending = fundedPlatformFeeFunding[currency];
        if (pending != 0 || fundedPending != 0) {
            revert CurrencyFundingInProgress(currency, pending, fundedPending);
        }

        amount = platformFeesAccrued[currency];
        if (amount == 0) revert NoFeesToClaim(currency);
        _assertAccountingConservation(currency, amount);

        platformFeesAccrued[currency] = 0;
        totalPlatformFeesClaimed[currency] += amount;

        if (currency == address(0)) {
            uint256 vaultBalanceBefore = address(this).balance;
            uint256 treasuryBalanceBefore = PLATFORM_FEE_RECIPIENT.balance;
            payable(PLATFORM_FEE_RECIPIENT).sendValue(amount);
            uint256 vaultBalanceAfter = address(this).balance;
            uint256 treasuryBalanceAfter = PLATFORM_FEE_RECIPIENT.balance;
            uint256 vaultDebit = vaultBalanceAfter <= vaultBalanceBefore ? vaultBalanceBefore - vaultBalanceAfter : 0;
            uint256 treasuryCredit =
                treasuryBalanceAfter >= treasuryBalanceBefore ? treasuryBalanceAfter - treasuryBalanceBefore : 0;
            if (vaultDebit != amount || treasuryCredit != amount) {
                revert TokenClaimMismatch(address(0), amount, vaultDebit, treasuryCredit);
            }
        } else {
            if (currency.code.length == 0) revert InvalidCurrency(currency);
            IERC20 token = IERC20(currency);
            uint256 vaultBalanceBefore = token.balanceOf(address(this));
            uint256 treasuryBalanceBefore = token.balanceOf(PLATFORM_FEE_RECIPIENT);
            token.safeTransfer(PLATFORM_FEE_RECIPIENT, amount);
            uint256 vaultBalanceAfter = token.balanceOf(address(this));
            uint256 treasuryBalanceAfter = token.balanceOf(PLATFORM_FEE_RECIPIENT);
            uint256 vaultDebit = vaultBalanceAfter <= vaultBalanceBefore ? vaultBalanceBefore - vaultBalanceAfter : 0;
            uint256 treasuryCredit =
                treasuryBalanceAfter >= treasuryBalanceBefore ? treasuryBalanceAfter - treasuryBalanceBefore : 0;
            if (vaultDebit != amount || treasuryCredit != amount) {
                revert TokenClaimMismatch(currency, amount, vaultDebit, treasuryCredit);
            }
        }

        emit PlatformFeesClaimed(currency, PLATFORM_FEE_RECIPIENT, amount);
    }

    function _beginSettlement(bytes32 routeSettlementId, bytes32 pathId, address currency, uint256 grossBasisAmount)
        private
        returns (bytes32 key, uint256 platformFeeAmount, uint32 nextRemainderPpm)
    {
        if (pathId == bytes32(0)) revert InvalidPathId();
        key = settlementKey(routeSettlementId);
        SettlementFeeRecord storage record = settlements[key];
        if (record.state != SettlementFeeState.None) {
            revert SettlementAlreadyProcessed(key, record.state);
        }

        uint256 pending = pendingPlatformFeeFunding[currency];
        uint256 fundedPending = fundedPlatformFeeFunding[currency];
        if (pending != 0 || fundedPending != 0) {
            revert CurrencyFundingInProgress(currency, pending, fundedPending);
        }

        address route = authorizedRoute;
        uint32 previousRemainderPpm = platformFeeRemainderPpm[route][pathId][currency];
        (platformFeeAmount, nextRemainderPpm) = _computePlatformFee(grossBasisAmount, previousRemainderPpm);

        record.pathId = pathId;
        record.currency = currency;
        record.grossBasisAmount = grossBasisAmount;
        record.platformFeeAmount = platformFeeAmount;
        record.previousRemainderPpm = previousRemainderPpm;
        record.nextRemainderPpm = nextRemainderPpm;
        record.state = SettlementFeeState.Pending;
        pendingPlatformFeeFunding[currency] = platformFeeAmount;

        emit SettlementFeePending(
            key,
            routeSettlementId,
            currency,
            pathId,
            grossBasisAmount,
            platformFeeAmount,
            previousRemainderPpm,
            nextRemainderPpm
        );
    }

    function _fundAndAccount(
        bytes32 key,
        bytes32 pathId,
        address currency,
        uint256 grossBasisAmount,
        uint256 platformFeeAmount,
        uint32 nextRemainderPpm
    ) private {
        SettlementFeeRecord storage record = settlements[key];
        if (record.state != SettlementFeeState.Pending) {
            revert SettlementStateInvalid(key, SettlementFeeState.Pending, record.state);
        }

        pendingPlatformFeeFunding[currency] = 0;
        fundedPlatformFeeFunding[currency] = platformFeeAmount;
        record.state = SettlementFeeState.Funded;
        emit SettlementFeeFunded(key, currency, platformFeeAmount);

        platformFeeRemainderPpm[authorizedRoute][pathId][currency] = nextRemainderPpm;
        fundedPlatformFeeFunding[currency] = 0;
        platformFeesAccrued[currency] += platformFeeAmount;
        totalPlatformFeesFunded[currency] += platformFeeAmount;
        record.state = SettlementFeeState.Accounted;

        emit SettlementFeeAccounted(key, pathId, currency, grossBasisAmount, platformFeeAmount, nextRemainderPpm);
    }

    function _computePlatformFee(uint256 grossBasisAmount, uint32 previousRemainderPpm)
        private
        pure
        returns (uint256 platformFeeAmount, uint32 nextRemainderPpm)
    {
        uint256 wholeFee = Math.mulDiv(grossBasisAmount, PLATFORM_FEE_PPM, FEE_DENOMINATOR_PPM);
        uint256 fractionalFee = mulmod(grossBasisAmount, PLATFORM_FEE_PPM, FEE_DENOMINATOR_PPM);
        uint256 scaledRemainder = fractionalFee + previousRemainderPpm;
        platformFeeAmount = wholeFee + scaledRemainder / FEE_DENOMINATOR_PPM;
        nextRemainderPpm = uint32(scaledRemainder % FEE_DENOMINATOR_PPM);
    }

    function _assertAccountingConservation(address currency, uint256 accrued) private view {
        uint256 funded = totalPlatformFeesFunded[currency];
        uint256 claimed = totalPlatformFeesClaimed[currency];
        if (funded < claimed || funded - claimed != accrued) {
            revert AccountingInvariantViolation(currency, funded, accrued, claimed);
        }
    }

    function _boundRoute() private view returns (address route) {
        route = authorizedRoute;
        if (route == address(0)) revert InvalidRoute(route);
    }

    modifier onlyRoute() {
        address route = authorizedRoute;
        if (msg.sender != route) revert UnauthorizedRoute(msg.sender);
        bytes32 observedCodeHash = msg.sender.codehash;
        if (observedCodeHash != authorizedRouteCodeHash) {
            revert RouteCodeHashChanged(authorizedRouteCodeHash, observedCodeHash);
        }
        _;
    }

    modifier onlyTreasury() {
        if (msg.sender != PLATFORM_FEE_RECIPIENT) revert UnauthorizedClaim(msg.sender);
        _;
    }
}
