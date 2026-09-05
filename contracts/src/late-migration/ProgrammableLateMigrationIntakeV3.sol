// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Permit } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { MerkleProof } from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ProgrammableLateMigrationIntakeV3
/// @notice Gas-sponsored Ethereum intake for the frozen V4 late-migration round.
/// @dev A holder signs the old token's native ERC-2612 permit. Any sponsor may submit that
///      signature, but this contract can only move the exact Merkle-committed amount directly
///      from that holder to the immutable migration recipient. Robinhood payouts are manual and
///      are deliberately outside this contract. There is no close, pause, upgrade, sweep,
///      arbitrary call, mutable root, mutable amount, mutable recipient, or payout capability.
contract ProgrammableLateMigrationIntakeV3 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant SOURCE_CHAIN_ID = 1;
    uint256 public constant TARGET_CHAIN_ID = 4663;
    uint256 public constant PAYOUT_BPS = 8000;
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAX_PERMIT_DEADLINE_LEAD = 20 minutes;
    uint256 public constant ELIGIBLE_OFFER_COUNT = 1499;
    uint256 public constant DEPOSIT_BITMAP_WORD_COUNT = 6;
    uint256 public constant MAXIMUM_GROSS_AMOUNT = 176_529_129_261_873_518_239_425_341;
    uint256 public constant MAXIMUM_PAYOUT_AMOUNT = 141_223_303_409_498_814_591_539_678;

    bytes32 public constant ROUND_ID = 0xe18c667c5916bb9e8929d81a7769a25040da8964555b76d68dc62b7f7a07d179;
    bytes32 public constant ELIGIBILITY_ROOT = 0x2817f23e9af279fe00d478f47cee3d36393677af6ac9d00c6ae4a0f821b423a0;
    bytes32 public constant OLD_TOKEN_DOMAIN_SEPARATOR =
        0xe2ac19a052ba41dccaaa930f489a94353d986c7769e416830273d9362ad26a47;
    bytes32 public constant OLD_TOKEN_RUNTIME_CODEHASH =
        0x4fe466386aeebe507f6bcfc58e046a0632e4687699fa5bd28c4b7ec6333141ad;
    bytes32 public constant ERC2612_PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    address public constant OLD_TOKEN = 0x7987f03462200b3D8A072E02C89A8A41dCB124EE;
    address public constant OLD_TOKEN_RECIPIENT = 0x2Bb333d48DFAF1596D9036671d2E43168994249E;
    address public constant TARGET_TOKEN = 0xC60bA256B44334A0Cd2C7242E98B88f031abB006;

    struct Offer {
        uint256 offerIndex;
        address source;
        uint256 grossAmount;
        uint256 payoutAmount;
    }

    IERC20 public immutable oldToken;
    address public activationAuthority;
    bool public depositsOpen;
    uint256 public activatedAtBlock;

    uint256 public depositedOfferCount;
    uint256 public depositedGrossTotal;
    uint256 public depositedPayoutTotal;

    uint256[DEPOSIT_BITMAP_WORD_COUNT] private _depositedOfferBitmap;
    mapping(uint256 offerIndex => bytes32 depositId) private _acceptedDepositIds;
    mapping(uint256 offerIndex => uint256 blockNumber) public depositedAtBlock;
    mapping(address source => bool consumed) public consumedSource;

    error WrongChain(uint256 actual, uint256 required);
    error ZeroActivationAuthority();
    error WrongOldTokenDomain(bytes32 actual, bytes32 required);
    error UnauthorizedActivator(address caller, address requiredAuthority);
    error DepositsAlreadyOpen();
    error DepositsNotOpen();
    error OfferIndexOutOfBounds(uint256 offerIndex, uint256 maximumExclusive);
    error ZeroSource();
    error InvalidAmount();
    error IncorrectPayout(uint256 supplied, uint256 expected);
    error InvalidEligibilityProof(uint256 offerIndex, address source);
    error OfferAlreadyDeposited(uint256 offerIndex);
    error SourceAlreadyDeposited(address source);
    error PermitDeadlineExpired(uint256 deadline, uint256 currentTimestamp);
    error PermitDeadlineTooFar(uint256 deadline, uint256 maximum);
    error PermitNonceInFuture(uint256 supplied, uint256 current);
    error PermitNonceAdvancedTooFar(uint256 supplied, uint256 current);
    error PermitNonceNotConsumed(uint256 expected, uint256 current);
    error PermitSignerMismatch(address recovered, address requiredSource);
    error PermitAllowanceMismatch(uint256 available, uint256 required);
    error AggregateGrossExceeded(uint256 attempted, uint256 maximum);
    error AggregatePayoutExceeded(uint256 attempted, uint256 maximum);
    error SourceBalanceDeltaMismatch(uint256 beforeBalance, uint256 afterBalance, uint256 expectedDecrease);
    error RecipientBalanceDeltaMismatch(uint256 beforeBalance, uint256 afterBalance, uint256 expectedIncrease);
    error UnexpectedRuntimeCodeHash(address dependency, bytes32 actual, bytes32 expected);

    event DepositsActivated(bytes32 indexed roundId, address indexed previousAuthority, uint256 activatedAtBlock);
    event MigrationDepositAccepted(
        bytes32 indexed roundId,
        bytes32 indexed depositId,
        address indexed source,
        uint256 offerIndex,
        uint256 grossAmount,
        uint256 manualPayoutAmount,
        address oldTokenRecipient,
        uint256 targetChainId,
        address targetToken,
        address sponsor,
        uint256 permitNonce
    );

    constructor(address activationAuthority_) {
        if (block.chainid != SOURCE_CHAIN_ID) revert WrongChain(block.chainid, SOURCE_CHAIN_ID);
        if (activationAuthority_ == address(0)) revert ZeroActivationAuthority();

        bytes32 observedDomain = IERC20Permit(OLD_TOKEN).DOMAIN_SEPARATOR();
        if (observedDomain != OLD_TOKEN_DOMAIN_SEPARATOR) {
            revert WrongOldTokenDomain(observedDomain, OLD_TOKEN_DOMAIN_SEPARATOR);
        }

        oldToken = IERC20(OLD_TOKEN);
        activationAuthority = activationAuthority_;
    }

    /// @notice Irreversibly opens this frozen intake round.
    /// @dev The authority can only activate. It cannot alter any commitment or regain authority.
    function activateDeposits() external {
        if (depositsOpen) revert DepositsAlreadyOpen();
        address authority = activationAuthority;
        if (msg.sender != authority) revert UnauthorizedActivator(msg.sender, authority);
        _assertPinnedOldToken();

        depositsOpen = true;
        activatedAtBlock = block.number;
        delete activationAuthority;

        emit DepositsActivated(ROUND_ID, authority, block.number);
    }

    /// @notice Transfers one holder's exact frozen old-V4 amount to the migration recipient.
    /// @dev The permit may already have been submitted by a third party. In that case the exact
    ///      allowance and one-step nonce advance are accepted, while every other state is rejected.
    function depositWithPermit(
        Offer calldata offer,
        bytes32[] calldata eligibilityProof,
        uint256 permitNonce,
        uint256 permitDeadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        if (!depositsOpen) revert DepositsNotOpen();
        _assertPinnedOldToken();
        _validateOffer(offer, eligibilityProof);
        if (isOfferDeposited(offer.offerIndex)) revert OfferAlreadyDeposited(offer.offerIndex);
        if (consumedSource[offer.source]) revert SourceAlreadyDeposited(offer.source);
        _validatePermit(offer, permitNonce, permitDeadline, v, r, s);

        uint256 newGrossTotal = depositedGrossTotal + offer.grossAmount;
        uint256 newPayoutTotal = depositedPayoutTotal + offer.payoutAmount;
        if (newGrossTotal > MAXIMUM_GROSS_AMOUNT) {
            revert AggregateGrossExceeded(newGrossTotal, MAXIMUM_GROSS_AMOUNT);
        }
        if (newPayoutTotal > MAXIMUM_PAYOUT_AMOUNT) {
            revert AggregatePayoutExceeded(newPayoutTotal, MAXIMUM_PAYOUT_AMOUNT);
        }

        uint256 sourceBefore = oldToken.balanceOf(offer.source);
        uint256 recipientBefore = oldToken.balanceOf(OLD_TOKEN_RECIPIENT);
        bytes32 depositId = depositIdFor(offer);

        _depositedOfferBitmap[offer.offerIndex >> 8] |= uint256(1) << (offer.offerIndex & 255);
        _acceptedDepositIds[offer.offerIndex] = depositId;
        depositedAtBlock[offer.offerIndex] = block.number;
        consumedSource[offer.source] = true;
        depositedGrossTotal = newGrossTotal;
        depositedPayoutTotal = newPayoutTotal;
        unchecked {
            ++depositedOfferCount;
        }

        _consumePermit(offer, permitNonce, permitDeadline, v, r, s);
        oldToken.safeTransferFrom(offer.source, OLD_TOKEN_RECIPIENT, offer.grossAmount);
        _assertExactOldTokenTransfer(offer, sourceBefore, recipientBefore);

        emit MigrationDepositAccepted(
            ROUND_ID,
            depositId,
            offer.source,
            offer.offerIndex,
            offer.grossAmount,
            offer.payoutAmount,
            OLD_TOKEN_RECIPIENT,
            TARGET_CHAIN_ID,
            TARGET_TOKEN,
            msg.sender,
            permitNonce
        );
    }

    function _validateOffer(Offer calldata offer, bytes32[] calldata eligibilityProof) private view {
        if (offer.offerIndex >= ELIGIBLE_OFFER_COUNT) {
            revert OfferIndexOutOfBounds(offer.offerIndex, ELIGIBLE_OFFER_COUNT);
        }
        if (offer.source == address(0)) revert ZeroSource();
        if (offer.grossAmount == 0 || offer.payoutAmount == 0) revert InvalidAmount();
        uint256 expected = expectedPayout(offer.grossAmount);
        if (offer.payoutAmount != expected) revert IncorrectPayout(offer.payoutAmount, expected);
        if (!MerkleProof.verifyCalldata(eligibilityProof, eligibilityRoot(), leafHash(offer))) {
            revert InvalidEligibilityProof(offer.offerIndex, offer.source);
        }
    }

    function _validatePermit(
        Offer calldata offer,
        uint256 permitNonce,
        uint256 permitDeadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) private view {
        if (permitDeadline < block.timestamp) {
            revert PermitDeadlineExpired(permitDeadline, block.timestamp);
        }
        uint256 maximumDeadline = block.timestamp + MAX_PERMIT_DEADLINE_LEAD;
        if (permitDeadline > maximumDeadline) {
            revert PermitDeadlineTooFar(permitDeadline, maximumDeadline);
        }
        address recovered =
            ECDSA.recover(permitDigest(offer.source, offer.grossAmount, permitNonce, permitDeadline), v, r, s);
        if (recovered != offer.source) revert PermitSignerMismatch(recovered, offer.source);
    }

    function _consumePermit(
        Offer calldata offer,
        uint256 permitNonce,
        uint256 permitDeadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) private {
        uint256 currentNonce = IERC20Permit(OLD_TOKEN).nonces(offer.source);
        if (currentNonce < permitNonce) revert PermitNonceInFuture(permitNonce, currentNonce);

        if (currentNonce == permitNonce) {
            // No external transaction can interleave with this call. A current nonce must be
            // consumed by the token itself; an unrelated existing approval is insufficient.
            IERC20Permit(OLD_TOKEN).permit(offer.source, address(this), offer.grossAmount, permitDeadline, v, r, s);
        } else if (currentNonce != permitNonce + 1) {
            revert PermitNonceAdvancedTooFar(permitNonce, currentNonce);
        }

        uint256 nonceAfterPermit = IERC20Permit(OLD_TOKEN).nonces(offer.source);
        if (nonceAfterPermit != permitNonce + 1) {
            revert PermitNonceNotConsumed(permitNonce + 1, nonceAfterPermit);
        }
        uint256 allowance = oldToken.allowance(offer.source, address(this));
        if (allowance != offer.grossAmount) {
            revert PermitAllowanceMismatch(allowance, offer.grossAmount);
        }
    }

    function _assertExactOldTokenTransfer(Offer calldata offer, uint256 sourceBefore, uint256 recipientBefore)
        private
        view
    {
        uint256 sourceAfter = oldToken.balanceOf(offer.source);
        uint256 recipientAfter = oldToken.balanceOf(OLD_TOKEN_RECIPIENT);
        if (sourceAfter > sourceBefore || sourceBefore - sourceAfter != offer.grossAmount) {
            revert SourceBalanceDeltaMismatch(sourceBefore, sourceAfter, offer.grossAmount);
        }
        if (recipientAfter < recipientBefore || recipientAfter - recipientBefore != offer.grossAmount) {
            revert RecipientBalanceDeltaMismatch(recipientBefore, recipientAfter, offer.grossAmount);
        }
    }

    function _assertPinnedOldToken() internal view virtual {
        if (block.chainid != SOURCE_CHAIN_ID) revert WrongChain(block.chainid, SOURCE_CHAIN_ID);
        bytes32 actualCodeHash = OLD_TOKEN.codehash;
        if (actualCodeHash != OLD_TOKEN_RUNTIME_CODEHASH) {
            revert UnexpectedRuntimeCodeHash(OLD_TOKEN, actualCodeHash, OLD_TOKEN_RUNTIME_CODEHASH);
        }
    }

    function assertPinnedOldToken() external view {
        _assertPinnedOldToken();
    }

    function eligibilityRoot() public view virtual returns (bytes32) {
        return ELIGIBILITY_ROOT;
    }

    function expectedPayout(uint256 grossAmount) public pure returns (uint256) {
        return Math.mulDiv(grossAmount, PAYOUT_BPS, BPS_DENOMINATOR);
    }

    function permitDigest(address owner, uint256 value, uint256 nonce, uint256 deadline) public view returns (bytes32) {
        bytes32 structHash =
            keccak256(abi.encode(ERC2612_PERMIT_TYPEHASH, owner, address(this), value, nonce, deadline));
        return keccak256(abi.encodePacked("\x19\x01", OLD_TOKEN_DOMAIN_SEPARATOR, structHash));
    }

    /// @dev Double-hashed leaf encoding is intentionally identical to the frozen V2 eligibility artifact.
    function leafHash(Offer calldata offer) public pure returns (bytes32) {
        return keccak256(
            bytes.concat(
                keccak256(abi.encode(ROUND_ID, offer.offerIndex, offer.source, offer.grossAmount, offer.payoutAmount))
            )
        );
    }

    /// @dev Kept byte-for-byte compatible with the V2 source deposit identifier.
    function depositIdFor(Offer calldata offer) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                ROUND_ID,
                SOURCE_CHAIN_ID,
                OLD_TOKEN,
                offer.offerIndex,
                offer.source,
                offer.grossAmount,
                offer.payoutAmount
            )
        );
    }

    function isOfferDeposited(uint256 offerIndex) public view returns (bool) {
        if (offerIndex >= ELIGIBLE_OFFER_COUNT) return false;
        return (_depositedOfferBitmap[offerIndex >> 8] & (uint256(1) << (offerIndex & 255))) != 0;
    }

    function depositedBitmapWord(uint256 wordIndex) external view returns (uint256) {
        if (wordIndex >= DEPOSIT_BITMAP_WORD_COUNT) {
            revert OfferIndexOutOfBounds(wordIndex * 256, ELIGIBLE_OFFER_COUNT);
        }
        return _depositedOfferBitmap[wordIndex];
    }

    function acceptedDepositId(uint256 offerIndex) external view returns (bytes32) {
        if (offerIndex >= ELIGIBLE_OFFER_COUNT) {
            revert OfferIndexOutOfBounds(offerIndex, ELIGIBLE_OFFER_COUNT);
        }
        return _acceptedDepositIds[offerIndex];
    }
}
