// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import { ProgrammableV4MigrationDistributorV1 } from "./ProgrammableV4MigrationDistributorV1.sol";

/// @title Programmable V4 token V1
/// @notice Fixed one-billion-supply Robinhood token for the Ethereum V4 migration.
/// @dev Creates the immutable distributor during construction and mints the complete supply directly to it.
contract ProgrammableV4TokenV1 is ERC20 {
    uint256 public constant TARGET_CHAIN_ID = 4663;
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether;

    ProgrammableV4MigrationDistributorV1 public immutable MIGRATION_DISTRIBUTOR;

    error InvalidChain(uint256 actual, uint256 expected);

    constructor(
        bytes32 releaseIdHash,
        uint256 sourceChainId,
        address sourceToken,
        uint256 sourceDeadlineTimestampExclusive,
        bytes32 snapshotRuleHash,
        address sealAuthority,
        address remainderRecipient
    ) ERC20("Programmable", "V4") {
        if (block.chainid != TARGET_CHAIN_ID) {
            revert InvalidChain(block.chainid, TARGET_CHAIN_ID);
        }

        ProgrammableV4MigrationDistributorV1 distributor = new ProgrammableV4MigrationDistributorV1(
            this,
            releaseIdHash,
            sourceChainId,
            sourceToken,
            sourceDeadlineTimestampExclusive,
            snapshotRuleHash,
            sealAuthority,
            remainderRecipient
        );
        MIGRATION_DISTRIBUTOR = distributor;
        _mint(address(distributor), TOTAL_SUPPLY);
    }
}
