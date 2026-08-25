// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title ProgrammableLaunchTokenV2
/// @notice Canonical fixed-supply token for the closed Custom V2 launch profile.
/// The controller is only the immutable-in-practice initial supply recipient:
/// it has no administrative capability and there is no post-construction mint.
contract ProgrammableLaunchTokenV2 {
    uint8 public constant decimals = 18;
    uint256 public constant MAX_NAME_BYTES = 64;
    uint256 public constant MAX_SYMBOL_BYTES = 16;
    uint256 public constant MAX_FIXED_SUPPLY = type(uint128).max;

    string public name;
    string public symbol;
    uint256 public totalSupply;
    address public controller;

    mapping(address account => uint256 amount) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    error InvalidController();
    error InvalidMetadataLength(uint256 nameLength, uint256 symbolLength);
    error InvalidFixedSupply(uint256 fixedSupply);
    error InsufficientAllowance(address owner, address spender, uint256 available, uint256 required);
    error InsufficientBalance(address account, uint256 available, uint256 required);
    error InvalidRecipient();

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory name_, string memory symbol_, uint256 fixedSupply_, address controller_) {
        uint256 nameLength = bytes(name_).length;
        uint256 symbolLength = bytes(symbol_).length;
        if (nameLength == 0 || nameLength > MAX_NAME_BYTES || symbolLength == 0 || symbolLength > MAX_SYMBOL_BYTES) {
            revert InvalidMetadataLength(nameLength, symbolLength);
        }
        if (fixedSupply_ == 0 || fixedSupply_ > MAX_FIXED_SUPPLY) revert InvalidFixedSupply(fixedSupply_);
        if (controller_ == address(0)) revert InvalidController();

        name = name_;
        symbol = symbol_;
        totalSupply = fixedSupply_;
        controller = controller_;
        balanceOf[controller_] = fixedSupply_;
        emit Transfer(address(0), controller_, fixedSupply_);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 availableAllowance = allowance[from][msg.sender];
        if (availableAllowance != type(uint256).max) {
            if (availableAllowance < amount) {
                revert InsufficientAllowance(from, msg.sender, availableAllowance, amount);
            }
            unchecked {
                allowance[from][msg.sender] = availableAllowance - amount;
            }
            emit Approval(from, msg.sender, allowance[from][msg.sender]);
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) private {
        if (to == address(0)) revert InvalidRecipient();
        uint256 availableBalance = balanceOf[from];
        if (availableBalance < amount) revert InsufficientBalance(from, availableBalance, amount);
        unchecked {
            balanceOf[from] = availableBalance - amount;
            balanceOf[to] += amount;
        }
        emit Transfer(from, to, amount);
    }
}
