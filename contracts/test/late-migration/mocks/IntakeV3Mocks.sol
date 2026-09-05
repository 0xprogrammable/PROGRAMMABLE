// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Permit } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @dev Storage-only ERC-20/ERC-2612 mock that can be etched at the pinned old-token address.
contract PinnedPermitTokenMockV3 is IERC20, IERC20Permit {
    bytes32 internal constant PINNED_DOMAIN_SEPARATOR =
        0xe2ac19a052ba41dccaaa930f489a94353d986c7769e416830273d9362ad26a47;
    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    mapping(address account => uint256) public override balanceOf;
    mapping(address owner => mapping(address spender => uint256)) public override allowance;
    mapping(address owner => uint256) public override nonces;
    uint256 public override totalSupply;

    bool public feeOnTransfer;
    bool public forcePermitRevert;
    bool public forceTransferFromFalse;
    bool public skipPermitNonce;
    bool public extraSourceDebit;
    address public callbackTarget;
    bytes public callbackData;
    bool public callbackSucceeded;
    address public constant FEE_SINK = address(0xFEE);

    error InsufficientBalance(uint256 available, uint256 required);
    error InsufficientAllowance(uint256 available, uint256 required);
    error PermitExpired(uint256 deadline, uint256 currentTimestamp);
    error InvalidPermitSigner(address recovered, address owner);
    error ForcedPermitFailure();

    function DOMAIN_SEPARATOR() external pure override returns (bytes32) {
        return PINNED_DOMAIN_SEPARATOR;
    }

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function setFeeOnTransfer(bool enabled) external {
        feeOnTransfer = enabled;
    }

    function setForcePermitRevert(bool enabled) external {
        forcePermitRevert = enabled;
    }

    function setForceTransferFromFalse(bool enabled) external {
        forceTransferFromFalse = enabled;
    }

    function setSkipPermitNonce(bool enabled) external {
        skipPermitNonce = enabled;
    }

    function setExtraSourceDebit(bool enabled) external {
        extraSourceDebit = enabled;
    }

    function setCallback(address target, bytes calldata data) external {
        callbackTarget = target;
        callbackData = data;
    }

    function approve(address spender, uint256 value) external override returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external override returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external override returns (bool) {
        if (forceTransferFromFalse) return false;
        if (callbackTarget != address(0)) {
            (callbackSucceeded,) = callbackTarget.call(callbackData);
        }
        uint256 available = allowance[from][msg.sender];
        if (available != type(uint256).max) {
            if (available < value) revert InsufficientAllowance(available, value);
            unchecked {
                allowance[from][msg.sender] = available - value;
            }
            emit Approval(from, msg.sender, allowance[from][msg.sender]);
        }
        _transfer(from, to, value);
        return true;
    }

    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
        override
    {
        if (forcePermitRevert) revert ForcedPermitFailure();
        if (block.timestamp > deadline) revert PermitExpired(deadline, block.timestamp);
        uint256 nonce = nonces[owner];
        bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", PINNED_DOMAIN_SEPARATOR, structHash));
        address recovered = ECDSA.recover(digest, v, r, s);
        if (recovered != owner) revert InvalidPermitSigner(recovered, owner);

        if (!skipPermitNonce) nonces[owner] = nonce + 1;
        allowance[owner][spender] = value;
        emit Approval(owner, spender, value);
    }

    function _transfer(address from, address to, uint256 value) private {
        uint256 available = balanceOf[from];
        if (available < value) revert InsufficientBalance(available, value);
        unchecked {
            balanceOf[from] = available - value;
        }
        if (extraSourceDebit) {
            balanceOf[from] -= 1;
            balanceOf[FEE_SINK] += 1;
        }

        if (feeOnTransfer && value != 0) {
            balanceOf[to] += value - 1;
            balanceOf[FEE_SINK] += 1;
            emit Transfer(from, to, value - 1);
            emit Transfer(from, FEE_SINK, 1);
            return;
        }

        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}
