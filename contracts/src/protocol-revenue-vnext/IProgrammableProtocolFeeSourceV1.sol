// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Immutable binding for one approved protocol-revenue source and native ETH.
/// @dev This Custom-native release keeps the generic field layout required by the reviewed vNext interface, but the
///      registry accepts only `asset == address(0)`. Quote assets and ERC-20 claims are outside this release.
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
/// @notice Mandatory native-fee surface for future Programmable Custom launch contracts.
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
/// @notice Optional native-only accounting primitive for future fee sources implementing the standard interface.
/// @dev The base fixes the economic recipient and maintains accrued/cumulative native accounting plus the canonical
///      event. It deliberately does not implement the permissionless claim function or any arbitrary-call surface. A
///      concrete source must transfer exactly the consumed native amount to `programmableFeeRecipient`; a transfer
///      revert rolls back the accounting update and event with the complete claim transaction.
abstract contract ProgrammableProtocolFeeSourceBaseV1 is IProgrammableProtocolFeeSourceV1 {
    address public constant PROGRAMMABLE_REWARD_WALLET = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;

    uint256 private _accruedProgrammableNativeFees;
    uint256 private _totalProgrammableNativeFeesClaimed;

    error UnsupportedProtocolRevenueAsset(address asset);

    function programmableFeeRecipient() external pure returns (address) {
        return PROGRAMMABLE_REWARD_WALLET;
    }

    function accruedProgrammableFees(address asset) external view returns (uint256 amount) {
        _requireNativeAsset(asset);
        return _accruedProgrammableNativeFees;
    }

    function totalProgrammableFeesClaimed(address asset) external view returns (uint256 amount) {
        _requireNativeAsset(asset);
        return _totalProgrammableNativeFeesClaimed;
    }

    function _accrueProgrammableFee(address asset, uint256 amount) internal {
        _requireNativeAsset(asset);
        if (amount == 0) return;
        _accruedProgrammableNativeFees += amount;
    }

    function _consumeProgrammableFees(address asset) internal returns (uint256 amount) {
        _requireNativeAsset(asset);
        amount = _accruedProgrammableNativeFees;
        if (amount == 0) return 0;
        _accruedProgrammableNativeFees = 0;
        _totalProgrammableNativeFeesClaimed += amount;
        emit ProgrammableFeesClaimed(address(0), PROGRAMMABLE_REWARD_WALLET, msg.sender, amount);
    }

    function _requireNativeAsset(address asset) private pure {
        if (asset != address(0)) revert UnsupportedProtocolRevenueAsset(asset);
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
