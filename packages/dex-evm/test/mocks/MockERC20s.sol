// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

contract StrictERC20Mock {
    mapping(address account => uint256 balance) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    function mint(address account, uint256 amount) external {
        balanceOf[account] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address recipient, uint256 amount) external virtual returns (bool) {
        _move(msg.sender, recipient, amount, amount);
        return true;
    }

    function transferFrom(address source, address recipient, uint256 amount) external virtual returns (bool) {
        uint256 allowed = allowance[source][msg.sender];
        require(allowed >= amount, "ALLOWANCE");
        allowance[source][msg.sender] = allowed - amount;
        _move(source, recipient, amount, amount);
        return true;
    }

    function _move(address source, address recipient, uint256 debit, uint256 credit) internal {
        uint256 sourceBalance = balanceOf[source];
        require(sourceBalance >= debit, "BALANCE");
        balanceOf[source] = sourceBalance - debit;
        balanceOf[recipient] += credit;
    }
}

contract GasRecordingERC20Mock is StrictERC20Mock {
    uint256 public gasAtTransferEntry;

    function transfer(address recipient, uint256 amount) external override returns (bool) {
        gasAtTransferEntry = gasleft();
        _move(msg.sender, recipient, amount, amount);
        return true;
    }

    function transferFrom(address source, address recipient, uint256 amount) external override returns (bool) {
        gasAtTransferEntry = gasleft();
        uint256 allowed = allowance[source][msg.sender];
        require(allowed >= amount, "ALLOWANCE");
        allowance[source][msg.sender] = allowed - amount;
        _move(source, recipient, amount, amount);
        return true;
    }
}

contract FalseReturnERC20Mock is StrictERC20Mock {
    function transfer(address, uint256) external pure override returns (bool) {
        return false;
    }

    function transferFrom(address, address, uint256) external pure override returns (bool) {
        return false;
    }
}

contract FeeOnTransferERC20Mock is StrictERC20Mock {
    function transfer(address recipient, uint256 amount) external override returns (bool) {
        _move(msg.sender, recipient, amount, amount - 1);
        return true;
    }

    function transferFrom(address source, address recipient, uint256 amount) external override returns (bool) {
        uint256 allowed = allowance[source][msg.sender];
        require(allowed >= amount, "ALLOWANCE");
        allowance[source][msg.sender] = allowed - amount;
        _move(source, recipient, amount, amount - 1);
        return true;
    }
}

contract OverDebitERC20Mock is StrictERC20Mock {
    function transfer(address recipient, uint256 amount) external override returns (bool) {
        _move(msg.sender, recipient, amount + 1, amount);
        return true;
    }

    function transferFrom(address source, address recipient, uint256 amount) external override returns (bool) {
        uint256 allowed = allowance[source][msg.sender];
        require(allowed >= amount + 1, "ALLOWANCE");
        allowance[source][msg.sender] = allowed - amount - 1;
        _move(source, recipient, amount + 1, amount);
        return true;
    }
}

contract NoReturnERC20Mock {
    mapping(address account => uint256 balance) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    function mint(address account, uint256 amount) external {
        balanceOf[account] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address recipient, uint256 amount) external {
        balanceOf[msg.sender] -= amount;
        balanceOf[recipient] += amount;
    }

    function transferFrom(address source, address recipient, uint256 amount) external {
        allowance[source][msg.sender] -= amount;
        balanceOf[source] -= amount;
        balanceOf[recipient] += amount;
    }
}

contract OversizedReturnERC20Mock is StrictERC20Mock {
    function transfer(address recipient, uint256 amount) external override returns (bool) {
        _move(msg.sender, recipient, amount, amount);
        _returnOversized();
    }

    function transferFrom(address source, address recipient, uint256 amount) external override returns (bool) {
        uint256 allowed = allowance[source][msg.sender];
        require(allowed >= amount, "ALLOWANCE");
        allowance[source][msg.sender] = allowed - amount;
        _move(source, recipient, amount, amount);
        _returnOversized();
    }

    function _returnOversized() private pure {
        assembly ("memory-safe") {
            mstore(0, 1)
            mstore(0x20, 0)
            return(0, 0x40)
        }
    }
}

/// @notice Returns the exact canonical word plus one trailing byte after moving tokens.
contract ExactPlusOneReturnERC20Mock is StrictERC20Mock {
    function transfer(address recipient, uint256 amount) external override returns (bool) {
        _move(msg.sender, recipient, amount, amount);
        _returnExactPlusOne();
    }

    function transferFrom(address source, address recipient, uint256 amount) external override returns (bool) {
        uint256 allowed = allowance[source][msg.sender];
        require(allowed >= amount, "ALLOWANCE");
        allowance[source][msg.sender] = allowed - amount;
        _move(source, recipient, amount, amount);
        _returnExactPlusOne();
    }

    function _returnExactPlusOne() private pure {
        assembly ("memory-safe") {
            mstore(0, 1)
            return(0, 0x21)
        }
    }
}
