// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";

import { ClassicCtoAuthorityV1 } from "./ClassicCtoAuthorityV1.sol";
import { IClassicCtoVaultV1 } from "./interfaces/IClassicCtoVaultV1.sol";
import { IClassicFeeHookV3 } from "./interfaces/IClassicFeeHookV3.sol";

/// @title ClassicRewardVaultV1
/// @notice Distributes one Classic pool's creator rewards across at most five current payout wallets.
/// @dev Every payout-wallet change and CTO first checkpoints all creator fees accrued under the prior configuration.
///      Historic claim balances remain owned by the wallets that earned them; only future accrual follows the new
///      configuration.
contract ClassicRewardVaultV1 is IClassicCtoVaultV1, ReentrancyGuardTransient {
    using Address for address payable;

    uint16 public constant BASIS_POINTS = 10_000;
    uint256 public constant MAX_BENEFICIARIES = 5;

    IClassicFeeHookV3 public immutable feeHook;
    IPoolManager public immutable poolManager;
    ClassicCtoAuthorityV1 public immutable ctoAuthority;
    bytes32 public immutable poolId;

    /// @notice Factory-authenticated commitment to this vault's immutable dependencies and initial allocation.
    bytes32 public immutable configurationHash;

    /// @notice Monotonic version of the active future-reward configuration. The initial configuration is epoch one.
    uint64 public configurationEpoch;

    /// @notice Commitment to the current future-reward payout wallets, shares and epoch.
    bytes32 public activeConfigurationHash;

    address[] private _beneficiaries;
    uint16[] private _sharesBps;

    mapping(address beneficiary => uint256 amount) private _claimableBy;
    mapping(address beneficiary => uint256 claimed) public claimedBy;

    /// @notice Creator fees pulled from the registered hook. Forced ETH is intentionally excluded.
    uint256 public totalCreatorFeesReceived;

    /// @notice Creator fees paid to current or historic payout wallets.
    uint256 public totalCreatorFeesClaimed;

    error DuplicateBeneficiary(address beneficiary);
    error FeeReceiptMismatch(uint256 actual, uint256 expected);
    error InvalidAllocationIndex(uint256 index, uint256 count);
    error InvalidBeneficiary(address beneficiary);
    error InvalidBeneficiaryCount(uint256 count);
    error InvalidCtoApprovalReference();
    error InvalidCtoAuthority(address authority);
    error InvalidHook(address hook);
    error InvalidShare(address beneficiary, uint16 shareBps);
    error InvalidShareTotal(uint256 totalShareBps);
    error NoFeesToClaim(address beneficiary);
    error PayoutWalletUnchanged(address payoutWallet);
    error UnauthorizedAllocationOwner(address caller, uint256 allocationIndex, address expected);
    error UnauthorizedCtoAuthority(address caller, address expected);
    error UnauthorizedNativeSender(address caller);

    event CreatorFeesCheckpointed(
        bytes32 indexed poolId, uint64 indexed configurationEpoch, uint256 amount, uint256 totalCreatorFeesReceived
    );
    event BeneficiaryFeesClaimed(
        address indexed beneficiary, uint256 amount, uint256 beneficiaryTotalClaimed, uint256 vaultTotalReceived
    );
    event PayoutWalletChanged(
        bytes32 indexed poolId,
        uint256 indexed allocationIndex,
        address indexed previousPayoutWallet,
        address newPayoutWallet,
        uint16 shareBps,
        uint64 configurationEpoch,
        bytes32 activeConfigurationHash,
        uint256 effectiveTotalCreatorFeesReceived
    );
    event CtoRewardConfigurationActivated(
        bytes32 indexed poolId,
        bytes32 indexed approvalReference,
        uint64 indexed configurationEpoch,
        bytes32 previousConfigurationHash,
        bytes32 newConfigurationHash,
        address[] beneficiaries,
        uint16[] sharesBps,
        uint256 effectiveTotalCreatorFeesReceived
    );

    constructor(
        IClassicFeeHookV3 feeHook_,
        bytes32 poolId_,
        ClassicCtoAuthorityV1 ctoAuthority_,
        address[] memory beneficiaries_,
        uint16[] memory sharesBps_
    ) {
        address hookAddress = address(feeHook_);
        if (hookAddress == address(0) || hookAddress.code.length == 0) revert InvalidHook(hookAddress);

        address authorityAddress = address(ctoAuthority_);
        if (authorityAddress == address(0) || authorityAddress.code.length == 0) {
            revert InvalidCtoAuthority(authorityAddress);
        }

        IPoolManager poolManager_ = feeHook_.poolManager();
        if (address(poolManager_) == address(0) || address(poolManager_).code.length == 0) {
            revert InvalidHook(hookAddress);
        }

        _validateConfiguration(beneficiaries_, sharesBps_);

        feeHook = feeHook_;
        poolManager = poolManager_;
        ctoAuthority = ctoAuthority_;
        poolId = poolId_;
        _replaceConfiguration(beneficiaries_, sharesBps_);

        configurationEpoch = 1;
        configurationHash = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                hookAddress,
                address(poolManager_),
                authorityAddress,
                poolId_,
                beneficiaries_,
                sharesBps_
            )
        );
        activeConfigurationHash = _configurationHash(beneficiaries_, sharesBps_, configurationEpoch);
    }

    function beneficiaryCount() external view returns (uint256) {
        return _beneficiaries.length;
    }

    function beneficiaryAt(uint256 index) external view returns (address) {
        return _beneficiaries[index];
    }

    function shareBpsAt(uint256 index) external view returns (uint16) {
        return _sharesBps[index];
    }

    /// @notice Returns the sum of all active allocation shares currently owned by `beneficiary`.
    function shareBpsOf(address beneficiary) public view returns (uint16 totalShareBps) {
        uint256 count = _beneficiaries.length;
        for (uint256 index; index < count; index++) {
            if (_beneficiaries[index] == beneficiary) totalShareBps += _sharesBps[index];
        }
    }

    /// @notice Returns checkpointed creator rewards owned by `beneficiary`.
    function claimable(address beneficiary) public view returns (uint256) {
        return _claimableBy[beneficiary];
    }

    /// @notice Changes only where one allocation's future rewards accrue, without requiring acceptance.
    /// @dev Rewards accrued before this transaction stay claimable by the previous payout wallet. They are never moved
    ///      by this function.
    // ReentrancyGuardTransient protects the entire update; Slither does not model its transient lock.
    // slither-disable-next-line reentrancy-no-eth,reentrancy-benign
    function changePayoutWallet(uint256 allocationIndex, address newPayoutWallet) external nonReentrant {
        uint256 count = _beneficiaries.length;
        if (allocationIndex >= count) revert InvalidAllocationIndex(allocationIndex, count);

        address previousPayoutWallet = _beneficiaries[allocationIndex];
        if (msg.sender != previousPayoutWallet) {
            revert UnauthorizedAllocationOwner(msg.sender, allocationIndex, previousPayoutWallet);
        }
        if (newPayoutWallet == address(0)) revert InvalidBeneficiary(newPayoutWallet);
        if (newPayoutWallet == previousPayoutWallet) revert PayoutWalletUnchanged(newPayoutWallet);

        _checkpoint();
        _beneficiaries[allocationIndex] = newPayoutWallet;
        uint64 newEpoch = configurationEpoch + 1;
        configurationEpoch = newEpoch;
        bytes32 newConfigurationHash = _configurationHash(_beneficiaries, _sharesBps, newEpoch);
        activeConfigurationHash = newConfigurationHash;

        emit PayoutWalletChanged(
            poolId,
            allocationIndex,
            previousPayoutWallet,
            newPayoutWallet,
            _sharesBps[allocationIndex],
            newEpoch,
            newConfigurationHash,
            totalCreatorFeesReceived
        );
    }

    /// @notice Replaces the complete future creator-reward configuration after a Programmable-approved CTO.
    /// @dev The shared CTO contract is the sole caller. The new wallets receive no reward accrued before this call.
    // ReentrancyGuardTransient protects the complete replacement; Slither does not model its transient lock.
    // slither-disable-next-line reentrancy-no-eth,reentrancy-benign
    function executeCto(address[] calldata beneficiaries, uint16[] calldata sharesBps, bytes32 approvalReference)
        external
        override
        nonReentrant
    {
        address expectedAuthority = address(ctoAuthority);
        if (msg.sender != expectedAuthority) revert UnauthorizedCtoAuthority(msg.sender, expectedAuthority);
        if (approvalReference == bytes32(0)) revert InvalidCtoApprovalReference();
        _validateConfiguration(beneficiaries, sharesBps);

        _checkpoint();
        bytes32 previousConfigurationHash = activeConfigurationHash;
        _replaceConfiguration(beneficiaries, sharesBps);

        uint64 newEpoch = configurationEpoch + 1;
        configurationEpoch = newEpoch;
        bytes32 newConfigurationHash = _configurationHash(beneficiaries, sharesBps, newEpoch);
        activeConfigurationHash = newConfigurationHash;

        emit CtoRewardConfigurationActivated(
            poolId,
            approvalReference,
            newEpoch,
            previousConfigurationHash,
            newConfigurationHash,
            beneficiaries,
            sharesBps,
            totalCreatorFeesReceived
        );
    }

    /// @notice Pulls newly accrued fees and pays all checkpointed rewards owned by the caller.
    // ReentrancyGuardTransient protects checkpointing and payment; Slither does not model its transient lock.
    // slither-disable-next-line reentrancy-no-eth,reentrancy-benign
    function claim() external nonReentrant returns (uint256 amount) {
        address beneficiary = msg.sender;
        _checkpoint();

        amount = _claimableBy[beneficiary];
        if (amount == 0) revert NoFeesToClaim(beneficiary);
        _claimableBy[beneficiary] = 0;
        claimedBy[beneficiary] += amount;
        totalCreatorFeesClaimed += amount;

        payable(beneficiary).sendValue(amount);
        emit BeneficiaryFeesClaimed(beneficiary, amount, claimedBy[beneficiary], totalCreatorFeesReceived);
    }

    /// @dev Native ETH is received only while the registered hook redeems a PoolManager claim.
    receive() external payable {
        if (msg.sender != address(poolManager)) revert UnauthorizedNativeSender(msg.sender);
    }

    // Every caller holds ReentrancyGuardTransient across the full checkpoint and its following state transition.
    // slither-disable-next-line reentrancy-benign
    function _checkpoint() private returns (uint256 received) {
        uint256 balanceBefore = address(this).balance;
        uint256 pulled = feeHook.claimCreatorFees(poolId);
        received = address(this).balance - balanceBefore;
        if (received != pulled) revert FeeReceiptMismatch(received, pulled);
        // Zero is a no-op sentinel, not a price, balance threshold or authorization decision.
        // slither-disable-next-line incorrect-equality
        if (received == 0) return 0;

        totalCreatorFeesReceived += received;
        _allocate(received);
        emit CreatorFeesCheckpointed(poolId, configurationEpoch, received, totalCreatorFeesReceived);
    }

    function _allocate(uint256 amount) private {
        uint256 count = _beneficiaries.length;
        uint256 allocated = 0;
        for (uint256 index; index + 1 < count; index++) {
            uint256 share = FullMath.mulDiv(amount, _sharesBps[index], BASIS_POINTS);
            _claimableBy[_beneficiaries[index]] += share;
            allocated += share;
        }
        _claimableBy[_beneficiaries[count - 1]] += amount - allocated;
    }

    function _replaceConfiguration(address[] memory beneficiaries, uint16[] memory sharesBps) private {
        delete _beneficiaries;
        delete _sharesBps;
        uint256 count = beneficiaries.length;
        for (uint256 index; index < count; index++) {
            _beneficiaries.push(beneficiaries[index]);
            _sharesBps.push(sharesBps[index]);
        }
    }

    function _validateConfiguration(address[] memory beneficiaries, uint16[] memory sharesBps) private pure {
        uint256 count = beneficiaries.length;
        if (count == 0 || count > MAX_BENEFICIARIES || sharesBps.length != count) {
            revert InvalidBeneficiaryCount(count);
        }

        uint256 totalShareBps = 0;
        for (uint256 index; index < count; index++) {
            address beneficiary = beneficiaries[index];
            uint16 shareBps = sharesBps[index];
            if (beneficiary == address(0)) revert InvalidBeneficiary(beneficiary);
            if (shareBps == 0) revert InvalidShare(beneficiary, shareBps);
            for (uint256 prior; prior < index; prior++) {
                if (beneficiaries[prior] == beneficiary) revert DuplicateBeneficiary(beneficiary);
            }
            totalShareBps += shareBps;
        }
        if (totalShareBps != BASIS_POINTS) revert InvalidShareTotal(totalShareBps);
    }

    function _configurationHash(address[] memory beneficiaries, uint16[] memory sharesBps, uint64 epoch)
        private
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(block.chainid, address(this), configurationHash, epoch, beneficiaries, sharesBps));
    }
}
