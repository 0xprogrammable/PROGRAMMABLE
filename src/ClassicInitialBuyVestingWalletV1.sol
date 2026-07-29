// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { VestingWallet } from "@openzeppelin/contracts/finance/VestingWallet.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

enum ClassicInitialBuyCustodyMode {
    Unlocked,
    FixedLock,
    LinearVesting,
    CliffLinearVesting
}

struct ClassicInitialBuyCustodyConfig {
    ClassicInitialBuyCustodyMode mode;
    uint16 durationDays;
    uint16 cliffDays;
}

library ClassicInitialBuyScheduleV1 {
    using SafeCast for uint256;

    uint16 internal constant MIN_DURATION_DAYS = 1;
    uint16 internal constant MAX_DURATION_DAYS = 3650;

    error CliffMustLeaveFullVestingDay(uint16 durationDays, uint16 cliffDays);
    error InvalidCliffDays(ClassicInitialBuyCustodyMode mode, uint16 cliffDays);
    error InvalidDurationDays(uint16 durationDays);
    error InvalidUnlockedSchedule(uint16 durationDays, uint16 cliffDays);

    function validate(ClassicInitialBuyCustodyConfig memory config) internal pure {
        if (config.mode == ClassicInitialBuyCustodyMode.Unlocked) {
            if (config.durationDays != 0 || config.cliffDays != 0) {
                revert InvalidUnlockedSchedule(config.durationDays, config.cliffDays);
            }
            return;
        }

        if (config.durationDays < MIN_DURATION_DAYS || config.durationDays > MAX_DURATION_DAYS) {
            revert InvalidDurationDays(config.durationDays);
        }

        if (config.mode == ClassicInitialBuyCustodyMode.CliffLinearVesting) {
            if (config.cliffDays < MIN_DURATION_DAYS || config.cliffDays >= config.durationDays) {
                revert InvalidCliffDays(config.mode, config.cliffDays);
            }
            if (config.durationDays - config.cliffDays < MIN_DURATION_DAYS) {
                revert CliffMustLeaveFullVestingDay(config.durationDays, config.cliffDays);
            }
            return;
        }

        if (config.cliffDays != 0) revert InvalidCliffDays(config.mode, config.cliffDays);
    }

    function vestingStart(uint64 launchTimestamp, ClassicInitialBuyCustodyConfig memory config)
        internal
        pure
        returns (uint64)
    {
        validate(config);
        uint256 offsetDays = config.mode == ClassicInitialBuyCustodyMode.LinearVesting ? 0 : config.durationDays;
        if (config.mode == ClassicInitialBuyCustodyMode.CliffLinearVesting) {
            offsetDays = config.cliffDays;
        }
        return (uint256(launchTimestamp) + offsetDays * 1 days).toUint64();
    }

    function vestingDuration(ClassicInitialBuyCustodyConfig memory config) internal pure returns (uint64) {
        validate(config);
        if (config.mode == ClassicInitialBuyCustodyMode.FixedLock) return 0;
        if (config.mode == ClassicInitialBuyCustodyMode.LinearVesting) {
            return (uint256(config.durationDays) * 1 days).toUint64();
        }
        if (config.mode == ClassicInitialBuyCustodyMode.CliffLinearVesting) {
            return (uint256(config.durationDays - config.cliffDays) * 1 days).toUint64();
        }
        return 0;
    }

    function cliffTimestamp(uint64 launchTimestamp, ClassicInitialBuyCustodyConfig memory config)
        internal
        pure
        returns (uint64)
    {
        validate(config);
        if (config.mode == ClassicInitialBuyCustodyMode.FixedLock) {
            return (uint256(launchTimestamp) + uint256(config.durationDays) * 1 days).toUint64();
        }
        if (config.mode == ClassicInitialBuyCustodyMode.CliffLinearVesting) {
            return (uint256(launchTimestamp) + uint256(config.cliffDays) * 1 days).toUint64();
        }
        return launchTimestamp;
    }

    function releaseTimestamp(uint64 launchTimestamp, ClassicInitialBuyCustodyConfig memory config)
        internal
        pure
        returns (uint64)
    {
        validate(config);
        return (uint256(launchTimestamp) + uint256(config.durationDays) * 1 days).toUint64();
    }
}

/// @title ClassicInitialBuyVestingWalletV1
/// @notice Holds one Classic launch's Initial Buy tokens for an immutable launch-wallet beneficiary.
/// @dev Uses OpenZeppelin VestingWallet for token accounting. Fixed lock uses a zero-duration schedule beginning on the
///      release day. Cliff plus linear vesting begins at zero on the cliff day and reaches 100% on the final day.
contract ClassicInitialBuyVestingWalletV1 is VestingWallet {
    IERC20 public immutable initialBuyToken;
    ClassicInitialBuyCustodyMode public immutable custodyMode;
    uint64 public immutable launchTimestamp;
    uint64 public immutable cliffTimestamp;
    uint64 public immutable releaseTimestamp;
    uint16 public immutable durationDays;
    uint16 public immutable cliffDays;
    bytes32 public immutable configurationHash;

    error CustodyNotRequired();
    error ImmutableBeneficiary();
    error InvalidInitialBuyToken(address token);

    constructor(
        IERC20 initialBuyToken_,
        address beneficiary_,
        uint64 launchTimestamp_,
        ClassicInitialBuyCustodyConfig memory config_
    )
        VestingWallet(
            beneficiary_,
            ClassicInitialBuyScheduleV1.vestingStart(launchTimestamp_, config_),
            ClassicInitialBuyScheduleV1.vestingDuration(config_)
        )
    {
        if (config_.mode == ClassicInitialBuyCustodyMode.Unlocked) revert CustodyNotRequired();
        address tokenAddress = address(initialBuyToken_);
        if (tokenAddress == address(0) || tokenAddress.code.length == 0) {
            revert InvalidInitialBuyToken(tokenAddress);
        }

        initialBuyToken = initialBuyToken_;
        custodyMode = config_.mode;
        launchTimestamp = launchTimestamp_;
        cliffTimestamp = ClassicInitialBuyScheduleV1.cliffTimestamp(launchTimestamp_, config_);
        releaseTimestamp = ClassicInitialBuyScheduleV1.releaseTimestamp(launchTimestamp_, config_);
        durationDays = config_.durationDays;
        cliffDays = config_.cliffDays;
        configurationHash = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                tokenAddress,
                beneficiary_,
                config_.mode,
                launchTimestamp_,
                config_.durationDays,
                config_.cliffDays
            )
        );
    }

    /// @notice Only the immutable beneficiary can release vested native currency.
    function release() public override onlyOwner {
        super.release();
    }

    /// @notice Only the immutable beneficiary can release vested ERC-20 tokens.
    function release(address token) public override onlyOwner {
        super.release(token);
    }

    function transferOwnership(address) public pure override {
        revert ImmutableBeneficiary();
    }

    function renounceOwnership() public pure override {
        revert ImmutableBeneficiary();
    }
}
