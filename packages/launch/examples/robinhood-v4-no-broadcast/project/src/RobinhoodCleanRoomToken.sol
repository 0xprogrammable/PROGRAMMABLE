// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

contract RobinhoodCleanRoomToken {
    string public constant name = "Robinhood Clean Room";
    string public constant symbol = "RHCR";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    mapping(address account => uint256 balance) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 allowance)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(address owner, uint256 supply) {
        require(owner != address(0) && supply != 0, "invalid mint");
        totalSupply = supply;
        balanceOf[owner] = supply;
        emit Transfer(address(0), owner, supply);
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 approved = allowance[from][msg.sender];
        if (approved != type(uint256).max) {
            require(approved >= value, "allowance");
            allowance[from][msg.sender] = approved - value;
        }
        _transfer(from, to, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) internal {
        require(to != address(0) && balanceOf[from] >= value, "transfer");
        unchecked {
            balanceOf[from] -= value;
            balanceOf[to] += value;
        }
        emit Transfer(from, to, value);
    }
}
