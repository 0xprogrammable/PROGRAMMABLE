// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";

import { IClassicFeeHookV3 } from "./interfaces/IClassicFeeHookV3.sol";

/// @title FeeSplitVaultV1
/// @notice Holds one Classic pool's creator rewards under an immutable beneficiary split.
/// @dev Beneficiary identities and shares never change. Each beneficiary alone controls its claim and may update only
///      its payout address. The payout address has no claim or configuration authority.
contract FeeSplitVaultV1 is ReentrancyGuardTransient {
    using Address for address payable;

    uint16 public constant BASIS_POINTS = 10_000;
    uint256 public constant MAX_BENEFICIARIES = 8;

    IClassicFeeHookV3 public immutable feeHook;
    IPoolManager public immutable poolManager;
    bytes32 public immutable poolId;
    bytes32 public immutable configurationHash;
    uint256 public immutable beneficiaryCount;

    address[] private _beneficiaries;

    mapping(address beneficiary => uint16 shareBps) public shareBpsOf;
    mapping(address beneficiary => address payoutAddress) public payoutAddressOf;
    mapping(address beneficiary => uint256 claimed) public claimedBy;

    /// @notice Creator fees pulled from the registered hook. Forced ETH is intentionally excluded.
    uint256 public totalCreatorFeesReceived;

    /// @notice Creator fees paid to beneficiaries.
    uint256 public totalCreatorFeesClaimed;

    error DuplicateBeneficiary(address beneficiary);
    error FeeReceiptMismatch(uint256 actual, uint256 expected);
    error InvalidBeneficiary(address beneficiary);
    error InvalidBeneficiaryCount(uint256 count);
    error InvalidHook(address hook);
    error InvalidPayoutAddress(address payoutAddress);
    error InvalidShare(address beneficiary, uint16 shareBps);
    error InvalidShareTotal(uint256 totalShareBps);
    error NoFeesToClaim(address beneficiary);
    error UnauthorizedBeneficiary(address caller);
    error UnauthorizedNativeSender(address caller);

    event PayoutAddressUpdated(
        address indexed beneficiary, address indexed previousPayoutAddress, address indexed newPayoutAddress
    );
    event BeneficiaryFeesClaimed(
        address indexed beneficiary,
        address indexed payoutAddress,
        uint256 amount,
        uint256 beneficiaryTotalClaimed,
        uint256 vaultTotalReceived
    );

    constructor(
        IClassicFeeHookV3 feeHook_,
        bytes32 poolId_,
        address[] memory beneficiaries_,
        uint16[] memory sharesBps_
    ) {
        address hookAddress = address(feeHook_);
        if (hookAddress == address(0) || hookAddress.code.length == 0) revert InvalidHook(hookAddress);

        uint256 count = beneficiaries_.length;
        if (count == 0 || count > MAX_BENEFICIARIES || sharesBps_.length != count) {
            revert InvalidBeneficiaryCount(count);
        }

        IPoolManager poolManager_ = feeHook_.poolManager();
        if (address(poolManager_) == address(0) || address(poolManager_).code.length == 0) {
            revert InvalidHook(hookAddress);
        }

        uint256 totalShareBps = 0;
        for (uint256 index; index < count; index++) {
            address beneficiary = beneficiaries_[index];
            uint16 shareBps = sharesBps_[index];
            if (beneficiary == address(0)) revert InvalidBeneficiary(beneficiary);
            if (shareBps == 0) revert InvalidShare(beneficiary, shareBps);

            for (uint256 prior; prior < index; prior++) {
                if (beneficiaries_[prior] == beneficiary) revert DuplicateBeneficiary(beneficiary);
            }

            _beneficiaries.push(beneficiary);
            shareBpsOf[beneficiary] = shareBps;
            payoutAddressOf[beneficiary] = beneficiary;
            totalShareBps += shareBps;
        }
        if (totalShareBps != BASIS_POINTS) revert InvalidShareTotal(totalShareBps);

        feeHook = feeHook_;
        poolManager = poolManager_;
        poolId = poolId_;
        beneficiaryCount = count;
        configurationHash = keccak256(
            abi.encode(
                block.chainid, address(this), hookAddress, address(poolManager_), poolId_, beneficiaries_, sharesBps_
            )
        );
    }

    /// @notice Returns the immutable beneficiary at `index`.
    function beneficiaryAt(uint256 index) external view returns (address) {
        return _beneficiaries[index];
    }

    /// @notice Returns creator rewards currently claimable by `beneficiary`.
    function claimable(address beneficiary) public view returns (uint256 amount) {
        uint16 shareBps = shareBpsOf[beneficiary];
        if (shareBps == 0) return 0;

        uint256 entitlement = _entitlement(beneficiary, totalCreatorFeesReceived);
        uint256 alreadyClaimed = claimedBy[beneficiary];
        return entitlement > alreadyClaimed ? entitlement - alreadyClaimed : 0;
    }

    /// @notice Changes only the caller's payout destination in one transaction.
    /// @dev Claim authority remains with `msg.sender`; the new payout address receives no control rights.
    function setPayoutAddress(address newPayoutAddress) external nonReentrant {
        if (shareBpsOf[msg.sender] == 0) revert UnauthorizedBeneficiary(msg.sender);
        if (newPayoutAddress == address(0)) revert InvalidPayoutAddress(newPayoutAddress);

        address previousPayoutAddress = payoutAddressOf[msg.sender];
        payoutAddressOf[msg.sender] = newPayoutAddress;
        emit PayoutAddressUpdated(msg.sender, previousPayoutAddress, newPayoutAddress);
    }

    /// @notice Pulls newly accrued creator fees and pays all of the caller's current entitlement.
    /// @dev Only an immutable beneficiary can call. A reverting payout affects only that beneficiary's transaction.
    function claim() external nonReentrant returns (uint256 amount) {
        address beneficiary = msg.sender;
        if (shareBpsOf[beneficiary] == 0) revert UnauthorizedBeneficiary(beneficiary);

        uint256 balanceBefore = address(this).balance;
        // The transient guard covers the hook pull. Effects precede the only untrusted payout call below.
        // slither-disable-next-line reentrancy-benign
        uint256 pulled = feeHook.claimCreatorFees(poolId);
        uint256 received = address(this).balance - balanceBefore;
        if (received != pulled) revert FeeReceiptMismatch(received, pulled);
        totalCreatorFeesReceived += received;

        uint256 entitlement = _entitlement(beneficiary, totalCreatorFeesReceived);
        uint256 alreadyClaimed = claimedBy[beneficiary];
        if (entitlement <= alreadyClaimed) revert NoFeesToClaim(beneficiary);
        amount = entitlement - alreadyClaimed;

        claimedBy[beneficiary] = entitlement;
        totalCreatorFeesClaimed += amount;

        address payoutAddress = payoutAddressOf[beneficiary];
        payable(payoutAddress).sendValue(amount);
        emit BeneficiaryFeesClaimed(beneficiary, payoutAddress, amount, entitlement, totalCreatorFeesReceived);
    }

    /// @dev Native ETH is received only while the registered hook redeems a PoolManager claim.
    receive() external payable {
        if (msg.sender != address(poolManager)) revert UnauthorizedNativeSender(msg.sender);
    }

    function _entitlement(address beneficiary, uint256 totalReceived) private view returns (uint256 amount) {
        uint256 count = beneficiaryCount;
        if (beneficiary != _beneficiaries[count - 1]) {
            return FullMath.mulDiv(totalReceived, shareBpsOf[beneficiary], BASIS_POINTS);
        }

        // The final immutable beneficiary receives all deterministic division remainders.
        uint256 allocatedBeforeRemainder = 0;
        for (uint256 index; index + 1 < count; index++) {
            address priorBeneficiary = _beneficiaries[index];
            allocatedBeforeRemainder += FullMath.mulDiv(totalReceived, shareBpsOf[priorBeneficiary], BASIS_POINTS);
        }
        amount = totalReceived - allocatedBeforeRemainder;
    }
}
