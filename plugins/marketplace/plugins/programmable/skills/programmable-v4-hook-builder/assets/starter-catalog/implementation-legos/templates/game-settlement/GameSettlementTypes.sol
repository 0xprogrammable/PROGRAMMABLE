// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

library GameSettlementTypes {
    struct Outcome {
        bytes32 gameId;
        bytes32 rulesHash;
        address winner;
        address loser;
        address asset;
        uint256 amount;
        uint256 nonce;
        uint256 deadline;
    }

    function outcomeId(Outcome memory outcome) internal pure returns (bytes32) {
        return keccak256(abi.encode(outcome));
    }
}
