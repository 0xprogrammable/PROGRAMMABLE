// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

import { IClassicCtoVaultV1 } from "./interfaces/IClassicCtoVaultV1.sol";

/// @title ClassicCtoAuthorityV1
/// @notice Executes disclosed Community Takeover reward changes and supports a two-step authority transfer.
/// @dev The authority can replace only a vault's future creator-reward configuration. Each vault checkpoints all
///      rewards accrued before accepting the replacement.
contract ClassicCtoAuthorityV1 is ReentrancyGuardTransient {
    address public authority;
    address public pendingAuthority;

    error InvalidAuthority(address authority);
    error InvalidVault(address vault);
    error UnauthorizedAuthority(address caller, address expected);
    error UnauthorizedPendingAuthority(address caller, address expected);

    event AuthorityTransferProposed(address indexed authority, address indexed pendingAuthority);
    event AuthorityTransferred(address indexed previousAuthority, address indexed newAuthority);
    event CtoExecuted(address indexed vault, bytes32 indexed approvalReference, address indexed authority);

    constructor(address initialAuthority) {
        if (initialAuthority == address(0)) revert InvalidAuthority(initialAuthority);
        authority = initialAuthority;
        emit AuthorityTransferred(address(0), initialAuthority);
    }

    function proposeAuthority(address newAuthority) external {
        address currentAuthority = authority;
        if (msg.sender != currentAuthority) revert UnauthorizedAuthority(msg.sender, currentAuthority);
        if (newAuthority == address(0)) revert InvalidAuthority(newAuthority);

        pendingAuthority = newAuthority;
        emit AuthorityTransferProposed(currentAuthority, newAuthority);
    }

    function acceptAuthority() external {
        address proposedAuthority = pendingAuthority;
        if (msg.sender != proposedAuthority) {
            revert UnauthorizedPendingAuthority(msg.sender, proposedAuthority);
        }

        address previousAuthority = authority;
        authority = proposedAuthority;
        pendingAuthority = address(0);
        emit AuthorityTransferred(previousAuthority, proposedAuthority);
    }

    function executeCto(
        IClassicCtoVaultV1 vault,
        address[] calldata beneficiaries,
        uint16[] calldata sharesBps,
        bytes32 approvalReference
    ) external nonReentrant {
        address currentAuthority = authority;
        if (msg.sender != currentAuthority) revert UnauthorizedAuthority(msg.sender, currentAuthority);
        if (address(vault).code.length == 0) revert InvalidVault(address(vault));

        vault.executeCto(beneficiaries, sharesBps, approvalReference);
        // The transient guard covers the complete call; Slither does not model it.
        // slither-disable-next-line reentrancy-events
        emit CtoExecuted(address(vault), approvalReference, currentAuthority);
    }
}
