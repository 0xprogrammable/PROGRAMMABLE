// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IShardHookV1 } from "./interfaces/IShardHookV1.sol";
import { ShardErrorsV1 } from "./ShardErrorsV1.sol";
import { ShardConstantsV1 } from "./ShardConstantsV1.sol";

/// @title ShardFeeDistributorV1
/// @notice Running-accumulator fee sharing across circulating NFTs.
/// @dev Dust is carried in SCALED units so no wei is stranded. NFTs join the
///      earning set only from the block AFTER acquisition — the same-block
///      accrual guard — keyed on acquiredBlock per token, not a global block.
abstract contract ShardFeeDistributorV1 is IShardHookV1 {
    uint256 internal constant ACC_PRECISION = ShardConstantsV1.ACC_PRECISION;

    uint256 public constant BPS_DENOMINATOR = 10_000;
    /// @dev Documentation of the holder share: holders receive the remainder after the two
    ///      cuts, so rounding dust always stays with them. 8_000 = 10_000 - 1_000 - 1_000.
    uint256 public constant HOLDER_SHARE_BPS = 8000;
    uint256 public constant BUILDER_SHARE_BPS = 1000;
    uint256 public constant LAUNCHER_SHARE_BPS = 1000;

    /// @notice Receives Programmable's fixed 0.10% share of swap volume. Immutable.
    address public immutable launcherFeeRecipient;

    /// @notice Receives the builder's fixed 0.10% share of swap volume. Only the current
    ///         recipient may claim or hand the role to a successor.
    address public builderFeeRecipient;

    uint256 public builderFeesAccrued;
    uint256 public launcherFeesAccrued;

    /// @dev Carried numerator (< BPS_DENOMINATOR) for the combined builder+launcher cut, so a stream
    ///      of tiny fees cannot floor the entitlement to zero. See {_distributeFee}.
    uint256 internal operatorFeeRemainder;
    /// @dev Carried odd wei (0 or 1) from the even builder/launcher split; the launcher takes it.
    uint256 internal operatorSplitParity;

    uint256 public accFeePerNFT; // scaled by ACC_PRECISION
    uint256 public dustScaled; // scaled remainder, < circulating
    uint256 public escrowBalance; // fees accrued while nothing circulated
    uint256 public circulating; // the EARNING set (lags acquisitions by a block)
    uint256 public pendingCount;
    uint256 public pendingBlock;

    mapping(uint256 => uint256) public feeSnapshot;
    mapping(uint256 => uint256) public acquiredBlock;
    mapping(uint256 => uint256) public flushAcc; // block => accFeePerNFT at the moment that block's tokens joined
    mapping(address => uint256) public override claimable;

    event FeeDistributed(uint256 amount, uint256 circulating);
    event FeeEscrowed(uint256 amount);
    event EscrowReleased(uint256 amount);
    event Claimed(address indexed account, uint256 amount);
    event BuilderFeesClaimed(address indexed recipient, uint256 amount);
    event LauncherFeesClaimed(address indexed recipient, uint256 amount);
    event BuilderFeeRecipientChanged(address indexed previous, address indexed current);

    constructor(address _launcherFeeRecipient, address _builderFeeRecipient) {
        if (_launcherFeeRecipient == address(0)) revert ShardErrorsV1.ZeroAddress();
        if (_builderFeeRecipient == address(0)) revert ShardErrorsV1.ZeroAddress();
        launcherFeeRecipient = _launcherFeeRecipient;
        builderFeeRecipient = _builderFeeRecipient;
    }

    /// @notice Hands the builder share to a successor. Accrued-but-unclaimed fees follow the
    ///         role: the successor claims them, the predecessor is locked out immediately.
    function setBuilderFeeRecipient(address next) external {
        if (msg.sender != builderFeeRecipient) revert ShardErrorsV1.NotBuilder();
        if (next == address(0)) revert ShardErrorsV1.ZeroAddress();
        emit BuilderFeeRecipientChanged(builderFeeRecipient, next);
        builderFeeRecipient = next;
    }

    /// @dev SWAP-FEE entry point: carves the fixed 0.10% builder and 0.10% launcher shares before
    ///      the remainder joins the holder pool. The combined operator cut (2_000/10_000 of the fee)
    ///      is taken with a CARRIED remainder so a stream of sub-threshold swaps cannot floor the
    ///      Programmable or builder entitlement to zero — ten 9-wei fees accrue the same total as one
    ///      90-wei fee. No underflow: with `operatorFeeRemainder < BPS_DENOMINATOR`,
    ///      `operatorCut = (amount*2000 + rem)/10000 <= amount` for every `amount >= 0`, so the holder
    ///      remainder `amount - operatorCut` is always non-negative. The even split carries its odd
    ///      wei (`operatorSplitParity`) to the launcher, so Programmable is never shorted below the
    ///      builder and `builderCut + launcherCut + holderAmount == amount` holds every call.
    ///      Donations bypass this and call {_distribute} directly — a gift to holders is not swap
    ///      volume and is never split.
    function _distributeFee(uint256 amount) internal {
        uint256 operatorNum = amount * (BUILDER_SHARE_BPS + LAUNCHER_SHARE_BPS) + operatorFeeRemainder;
        uint256 operatorCut = operatorNum / BPS_DENOMINATOR;
        operatorFeeRemainder = operatorNum % BPS_DENOMINATOR;

        uint256 splitNum = operatorCut + operatorSplitParity;
        uint256 builderCut = splitNum / 2;
        operatorSplitParity = splitNum % 2;
        uint256 launcherCut = operatorCut - builderCut; // launcher (Programmable) takes the odd wei

        builderFeesAccrued += builderCut;
        launcherFeesAccrued += launcherCut;
        _distribute(amount - operatorCut);
    }

    /// @dev True while a token has been acquired but has not yet joined the earning
    ///      set. Such a token must never accrue: `circulating` already excludes it,
    ///      so this block's fees were divided among — and paid in full to — the
    ///      existing holders.
    function _isPending(uint256 tokenId) private view returns (bool) {
        return pendingCount != 0 && acquiredBlock[tokenId] == pendingBlock;
    }

    function _flushPending() internal {
        if (pendingCount != 0 && pendingBlock != block.number) {
            flushAcc[pendingBlock] = accFeePerNFT; // acc as of just BEFORE this block's fees
            circulating += pendingCount;
            pendingCount = 0;
        }
    }

    function _distribute(uint256 amount) internal {
        _flushPending();

        if (circulating == 0) {
            if (amount != 0) {
                escrowBalance += amount;
                emit FeeEscrowed(amount);
            }
            return;
        }

        uint256 total = amount;
        if (escrowBalance != 0) {
            total += escrowBalance;
            emit EscrowReleased(escrowBalance);
            escrowBalance = 0;
        }
        if (total == 0 && dustScaled == 0) return;

        uint256 totalScaled = total * ACC_PRECISION + dustScaled;
        accFeePerNFT += totalScaled / circulating;
        dustScaled = totalScaled % circulating;

        emit FeeDistributed(amount, circulating);
    }

    function _acquireAccounting(uint256 tokenId, address) internal {
        _flushPending();
        feeSnapshot[tokenId] = accFeePerNFT;
        acquiredBlock[tokenId] = block.number;
        if (pendingCount == 0) pendingBlock = block.number;
        pendingCount += 1;
    }

    function _releaseAccounting(uint256 tokenId, address from) internal {
        if (_isPending(tokenId)) {
            // Path 2
            // Never joined the earning set — it earned nothing by construction.
            feeSnapshot[tokenId] = accFeePerNFT;
            pendingCount -= 1; // decrement pending, NOT circulating
        } else {
            _settle(tokenId, from);
            _flushPending();
            circulating -= 1;
        }
    }

    function _settle(uint256 tokenId, address owner) internal {
        if (_isPending(tokenId)) return; // Path 3
        uint256 acc = accFeePerNFT;
        uint256 snap = feeSnapshot[tokenId];
        uint256 floor_ = flushAcc[acquiredBlock[tokenId]];
        if (floor_ > snap) snap = floor_; // Path 1: never earn from before you joined
        if (acc > snap) {
            uint256 delta = acc - snap;
            uint256 owed = delta / ACC_PRECISION;
            if (owed != 0) claimable[owner] += owed;
            feeSnapshot[tokenId] = acc - (delta % ACC_PRECISION); // keep the fraction
        }
    }

    function _claim(address account) internal returns (uint256 amount) {
        amount = claimable[account];
        if (amount == 0) revert ShardErrorsV1.NothingToClaim();
        claimable[account] = 0; // effects before interaction
        (bool ok,) = account.call{ value: amount }("");
        if (!ok) revert ShardErrorsV1.EthTransferFailed();
        emit Claimed(account, amount);
    }
}
