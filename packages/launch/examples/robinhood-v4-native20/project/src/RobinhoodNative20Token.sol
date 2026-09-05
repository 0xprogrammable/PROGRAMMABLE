// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Fixed inventory for the native20 example. No owner, transfer tax, mint, burn, or upgrade entry point.
contract RobinhoodNative20Token {
    // Set once in the constructor. There is no metadata setter or administrative entry point.
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public constant totalSupply = 1_000_000_000 ether;
    mapping(address account => uint256 balance) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    error InvalidTransfer();
    error InvalidMetadata();
    error InsufficientAllowance();
    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    constructor(address inventoryOwner, string memory name_, string memory symbol_) {
        if (inventoryOwner == address(0)) revert InvalidTransfer();
        // The API additionally binds these exact strings to its canonical project metadata.
        if (
            bytes(name_).length == 0 || bytes(name_).length > 64 || bytes(symbol_).length == 0
                || bytes(symbol_).length > 16
        ) {
            revert InvalidMetadata();
        }
        name = name_;
        symbol = symbol_;
        balanceOf[inventoryOwner] = totalSupply;
        emit Transfer(address(0), inventoryOwner, totalSupply);
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
        uint256 approved = allowance[from][msg.sender];
        if (approved != type(uint256).max) {
            if (approved < amount) revert InsufficientAllowance();
            allowance[from][msg.sender] = approved - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) private {
        if (to == address(0) || balanceOf[from] < amount) revert InvalidTransfer();
        unchecked {
            balanceOf[from] -= amount;
            balanceOf[to] += amount;
        }
        emit Transfer(from, to, amount);
    }
}
