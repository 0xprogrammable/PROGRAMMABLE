// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract SignedRewardVault is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant CLAIM_TYPEHASH = keccak256(
        "Claim(address recipient,uint256 amount,uint256 nonce,uint256 deadline,bytes32 contextHash)"
    );

    IERC20 public immutable rewardToken;
    address public immutable signer;
    mapping(bytes32 digest => bool used) public usedClaim;

    error ClaimExpired(uint256 deadline);
    error ClaimAlreadyUsed(bytes32 digest);
    error InvalidSigner(address recovered);
    error ZeroAmount();
    error ZeroAddress();

    event RewardClaimed(address indexed recipient, uint256 amount, uint256 nonce, bytes32 contextHash);

    constructor(IERC20 rewardToken_, address signer_) EIP712("ProgrammableSignedRewardVault", "1") {
        if (address(rewardToken_) == address(0) || signer_ == address(0)) revert ZeroAddress();
        rewardToken = rewardToken_;
        signer = signer_;
    }

    function claim(
        address recipient,
        uint256 amount,
        uint256 nonce,
        uint256 deadline,
        bytes32 contextHash,
        bytes calldata signature
    ) external nonReentrant {
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (block.timestamp > deadline) revert ClaimExpired(deadline);
        bytes32 structHash = keccak256(abi.encode(CLAIM_TYPEHASH, recipient, amount, nonce, deadline, contextHash));
        bytes32 digest = _hashTypedDataV4(structHash);
        if (usedClaim[digest]) revert ClaimAlreadyUsed(digest);
        address recovered = ECDSA.recover(digest, signature);
        if (recovered != signer) revert InvalidSigner(recovered);
        usedClaim[digest] = true;
        rewardToken.safeTransfer(recipient, amount);
        emit RewardClaimed(recipient, amount, nonce, contextHash);
    }
}
