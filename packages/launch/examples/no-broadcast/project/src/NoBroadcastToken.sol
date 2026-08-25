// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

contract NoBroadcastToken {
    string public constant name = "Programmable No Broadcast";
    string public constant symbol = "PNB";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    mapping(address account => uint256 amount) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    constructor(address controller) {
        require(controller != address(0), "controller");
        totalSupply = 1_000_000 ether;
        balanceOf[controller] = totalSupply;
        emit Transfer(address(0), controller, totalSupply);
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
        uint256 permitted = allowance[from][msg.sender];
        if (permitted != type(uint256).max) {
            require(permitted >= amount, "allowance");
            unchecked {
                allowance[from][msg.sender] = permitted - amount;
            }
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0), "to");
        uint256 available = balanceOf[from];
        require(available >= amount, "balance");
        unchecked {
            balanceOf[from] = available - amount;
            balanceOf[to] += amount;
        }
        emit Transfer(from, to, amount);
    }
}
