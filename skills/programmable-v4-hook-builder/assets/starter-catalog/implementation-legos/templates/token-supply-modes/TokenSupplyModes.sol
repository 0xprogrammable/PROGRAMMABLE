// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

library TokenSupplyModes {
    enum Mode {
        Fixed,
        CappedMint,
        BurnOnly
    }

    struct Policy {
        Mode mode;
        uint256 cap;
    }

    error InitialSupplyExceedsCap(uint256 initialSupply, uint256 cap);
    error FixedSupplyCapMismatch(uint256 initialSupply, uint256 cap);
    error MintDisabled();
    error MintExceedsCap(uint256 resultingSupply, uint256 cap);
    error BurnExceedsBalance(uint256 balance, uint256 amount);

    function validateInitialSupply(Policy memory policy, uint256 initialSupply) internal pure {
        if (policy.cap < initialSupply) revert InitialSupplyExceedsCap(initialSupply, policy.cap);
        if (policy.mode == Mode.Fixed && policy.cap != initialSupply) {
            revert FixedSupplyCapMismatch(initialSupply, policy.cap);
        }
    }

    function supplyAfterMint(Policy memory policy, uint256 currentSupply, uint256 amount)
        internal
        pure
        returns (uint256 resultingSupply)
    {
        if (policy.mode != Mode.CappedMint) revert MintDisabled();
        resultingSupply = currentSupply + amount;
        if (resultingSupply > policy.cap) revert MintExceedsCap(resultingSupply, policy.cap);
    }

    function balanceAfterBurn(uint256 balance, uint256 amount) internal pure returns (uint256) {
        if (amount > balance) revert BurnExceedsBalance(balance, amount);
        return balance - amount;
    }
}
