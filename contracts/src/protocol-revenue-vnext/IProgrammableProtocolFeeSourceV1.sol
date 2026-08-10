// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Immutable binding for one approved protocol-revenue source and one fee asset.
/// @dev A source may support several assets, but every source/asset pair receives its own registry entry.
///      `asset == address(0)` represents native ETH.
struct ProtocolRevenueSourceConfigV1 {
    bytes32 sourceId;
    address source;
    bytes32 runtimeCodeHash;
    address asset;
    bytes4 claimSelector;
    address recipient;
    uint64 activationBlock;
}

/// @title IProgrammableProtocolFeeSourceV1
/// @notice Mandatory fee surface for future Programmable launch contracts.
/// @dev Claims are permissionless but must always pay the immutable Programmable reward wallet returned by
///      `programmableFeeRecipient`. Implementations must increment the cumulative counter and emit the canonical
///      event by exactly the amount delivered to that recipient. A positive accrual is claimed in full; an empty
///      claim returns zero without changing state or emitting the event.
interface IProgrammableProtocolFeeSourceV1 {
    event ProgrammableFeesClaimed(
        address indexed asset, address indexed recipient, address indexed caller, uint256 amount
    );

    function programmableFeeRecipient() external view returns (address);

    function accruedProgrammableFees(address asset) external view returns (uint256 amount);

    function totalProgrammableFeesClaimed(address asset) external view returns (uint256 amount);

    function claimProgrammableFees(address asset) external returns (uint256 amount);
}

/// @title ProgrammableProtocolFeeSourceBaseV1
/// @notice Optional accounting primitive for future fee sources implementing the standard interface.
/// @dev The base fixes the economic recipient and maintains accrued/cumulative accounting plus the canonical event.
///      It deliberately does not implement claim authorization, token transfers or any arbitrary-call surface. A
///      concrete source must transfer exactly the returned consumed amount to `programmableFeeRecipient`; a transfer
///      revert rolls back the accounting update and event with the complete claim transaction.
abstract contract ProgrammableProtocolFeeSourceBaseV1 is IProgrammableProtocolFeeSourceV1 {
    address public constant PROGRAMMABLE_REWARD_WALLET = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;

    mapping(address asset => uint256 amount) private _accruedProgrammableFees;
    mapping(address asset => uint256 amount) private _totalProgrammableFeesClaimed;

    function programmableFeeRecipient() external pure returns (address) {
        return PROGRAMMABLE_REWARD_WALLET;
    }

    function accruedProgrammableFees(address asset) external view returns (uint256 amount) {
        return _accruedProgrammableFees[asset];
    }

    function totalProgrammableFeesClaimed(address asset) external view returns (uint256 amount) {
        return _totalProgrammableFeesClaimed[asset];
    }

    function _accrueProgrammableFee(address asset, uint256 amount) internal {
        if (amount == 0) return;
        _accruedProgrammableFees[asset] += amount;
    }

    function _consumeProgrammableFees(address asset) internal returns (uint256 amount) {
        amount = _accruedProgrammableFees[asset];
        if (amount == 0) return 0;
        _accruedProgrammableFees[asset] = 0;
        _totalProgrammableFeesClaimed[asset] += amount;
        emit ProgrammableFeesClaimed(asset, PROGRAMMABLE_REWARD_WALLET, msg.sender, amount);
    }
}

/// @notice Narrow registry view consumed by the claim executor.
interface IProtocolRevenueSourceRegistryV1 {
    function collector() external view returns (address);

    function rewardWallet() external view returns (address);

    function sourceState(bytes32 sourceId)
        external
        view
        returns (ProtocolRevenueSourceConfigV1 memory config, bool registered, bool quarantined);

    function isExecutable(bytes32 sourceId) external view returns (bool);
}
