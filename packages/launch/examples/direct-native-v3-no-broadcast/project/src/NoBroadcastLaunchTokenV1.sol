// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Fixed-supply ERC-20 used only by the direct-native V3 no-broadcast fixture.
/// @dev There is no owner, post-construction mint, seizure, pause, fee, proxy, or upgrade surface.
contract NoBroadcastLaunchTokenV1 {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;

    mapping(address account => uint256 amount) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    error InsufficientAllowance(uint256 available, uint256 required);
    error InsufficientBalance(uint256 available, uint256 required);
    error ZeroAddress();

    event Approval(address indexed owner, address indexed spender, uint256 amount);
    event Transfer(address indexed from, address indexed to, uint256 amount);

    constructor(string memory name_, string memory symbol_, uint256 initialSupply_, address recipient_) {
        if (recipient_ == address(0)) revert ZeroAddress();
        name = name_;
        symbol = symbol_;
        totalSupply = initialSupply_;
        balanceOf[recipient_] = initialSupply_;
        emit Transfer(address(0), recipient_, initialSupply_);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 available = allowance[from][msg.sender];
        if (available != type(uint256).max) {
            if (available < amount) revert InsufficientAllowance(available, amount);
            unchecked {
                allowance[from][msg.sender] = available - amount;
            }
            emit Approval(from, msg.sender, allowance[from][msg.sender]);
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) private {
        if (to == address(0)) revert ZeroAddress();
        uint256 available = balanceOf[from];
        if (available < amount) revert InsufficientBalance(available, amount);
        unchecked {
            balanceOf[from] = available - amount;
            balanceOf[to] += amount;
        }
        emit Transfer(from, to, amount);
    }
}
