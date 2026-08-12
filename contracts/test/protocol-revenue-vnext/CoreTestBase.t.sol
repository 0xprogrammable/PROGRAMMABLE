// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { Test } from "forge-std/Test.sol";

import {
    IProgrammableProtocolFeeSourceV1,
    ProgrammableProtocolFeeSourceBaseV1,
    ProtocolRevenueSourceConfigV1
} from "../../src/protocol-revenue-vnext/IProgrammableProtocolFeeSourceV1.sol";
import { ProtocolRevenueCollectorV1 } from "../../src/protocol-revenue-vnext/ProtocolRevenueCollectorV1.sol";
import { ProtocolRevenueSourceRegistryV1 } from "../../src/protocol-revenue-vnext/ProtocolRevenueSourceRegistryV1.sol";
import { ProtocolRevenueClaimExecutorV1 } from "../../src/protocol-revenue-vnext/ProtocolRevenueClaimExecutorV1.sol";

contract CoreStandardFeeSource is ProgrammableProtocolFeeSourceBaseV1 {
    using Address for address payable;

    receive() external payable { }

    function accrueNative() external payable {
        _accrueProgrammableFee(address(0), msg.value);
    }

    function claimProgrammableFees(address asset) external returns (uint256 amount) {
        amount = _consumeProgrammableFees(asset);
        if (amount == 0) return 0;
        payable(PROGRAMMABLE_REWARD_WALLET).sendValue(amount);
    }
}

contract CoreStandardFeeSourceV2 is CoreStandardFeeSource {
    function sourceVersion() external pure returns (uint256) {
        return 2;
    }
}

contract CoreBombFeeSource is IProgrammableProtocolFeeSourceV1 {
    using Address for address payable;

    enum Mode {
        Valid,
        ReturnBomb,
        RevertBomb,
        MalformedRecipient,
        OverlongViews
    }

    address internal constant REWARD_WALLET = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;

    mapping(address asset => uint256 amount) private _accrued;
    mapping(address asset => uint256 amount) private _totalClaimed;
    Mode public mode;

    receive() external payable { }

    function setMode(Mode mode_) external {
        mode = mode_;
    }

    function accrueNative() external payable {
        _accrued[address(0)] += msg.value;
    }

    function programmableFeeRecipient() external view returns (address recipient) {
        if (mode == Mode.OverlongViews) {
            uint256 encodedRecipient = uint256(uint160(REWARD_WALLET));
            assembly ("memory-safe") {
                mstore(0, encodedRecipient)
                return(0, 0x40)
            }
        }
        if (mode == Mode.MalformedRecipient) {
            uint256 invalidEncoding = uint256(uint160(REWARD_WALLET)) | (uint256(1) << 200);
            assembly ("memory-safe") {
                mstore(0, invalidEncoding)
                return(0, 0x20)
            }
        }
        return REWARD_WALLET;
    }

    function accruedProgrammableFees(address asset) external view returns (uint256 amount) {
        amount = _accrued[asset];
        if (mode == Mode.OverlongViews) {
            assembly ("memory-safe") {
                mstore(0, amount)
                return(0, 0x40)
            }
        }
    }

    function totalProgrammableFeesClaimed(address asset) external view returns (uint256 amount) {
        amount = _totalClaimed[asset];
        if (mode == Mode.OverlongViews) {
            assembly ("memory-safe") {
                mstore(0, amount)
                return(0, 0x40)
            }
        }
    }

    function claimProgrammableFees(address asset) external returns (uint256 amount) {
        if (mode == Mode.ReturnBomb) {
            assembly ("memory-safe") {
                return(0, 0x10000)
            }
        }
        if (mode == Mode.RevertBomb) {
            assembly ("memory-safe") {
                revert(0, 0x10000)
            }
        }
        amount = _accrued[asset];
        if (amount == 0) return 0;
        _accrued[asset] = 0;
        _totalClaimed[asset] += amount;
        payable(REWARD_WALLET).sendValue(amount);
        emit ProgrammableFeesClaimed(asset, REWARD_WALLET, msg.sender, amount);
    }
}

contract CoreFaultyFeeSource is IProgrammableProtocolFeeSourceV1 {
    using Address for address payable;

    enum Mode {
        Valid,
        RevertClaim,
        PartialClaim,
        Misreport,
        NoTransfer,
        CounterMismatch
    }

    address internal constant REWARD_WALLET = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;

    mapping(address asset => uint256 amount) private _accrued;
    mapping(address asset => uint256 amount) private _totalClaimed;
    Mode public mode;

    receive() external payable { }

    function setMode(Mode mode_) external {
        mode = mode_;
    }

    function accrueNative() external payable {
        _accrued[address(0)] += msg.value;
    }

    function programmableFeeRecipient() external pure returns (address) {
        return REWARD_WALLET;
    }

    function accruedProgrammableFees(address asset) external view returns (uint256 amount) {
        return _accrued[asset];
    }

    function totalProgrammableFeesClaimed(address asset) external view returns (uint256 amount) {
        return _totalClaimed[asset];
    }

    function claimProgrammableFees(address asset) external returns (uint256 amount) {
        if (mode == Mode.RevertClaim) revert("faulty-source");
        uint256 accrued = _accrued[asset];
        if (accrued == 0) return 0;

        if (mode == Mode.PartialClaim) {
            amount = accrued / 2;
            _accrued[asset] = accrued - amount;
            _totalClaimed[asset] += amount;
            payable(REWARD_WALLET).sendValue(amount);
            emit ProgrammableFeesClaimed(asset, REWARD_WALLET, msg.sender, amount);
            return amount;
        }

        _accrued[asset] = 0;
        if (mode == Mode.CounterMismatch) {
            _totalClaimed[asset] += accrued - 1;
        } else {
            _totalClaimed[asset] += accrued;
        }
        if (mode != Mode.NoTransfer) payable(REWARD_WALLET).sendValue(accrued);
        emit ProgrammableFeesClaimed(asset, REWARD_WALLET, msg.sender, accrued);
        if (mode == Mode.Misreport) return accrued - 1;
        return accrued;
    }
}

abstract contract CoreTestBase is Test {
    address internal constant REWARD_WALLET = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    address internal admin;
    address internal proposer;
    address internal activator;
    address internal quarantiner;

    ProtocolRevenueCollectorV1 internal collector;
    ProtocolRevenueSourceRegistryV1 internal registry;
    ProtocolRevenueClaimExecutorV1 internal executor;

    uint64 internal constant ACTIVATION_DELAY = 64;
    uint32 internal constant ISOLATED_CALL_GAS = 600_000;

    function setUp() public virtual {
        vm.chainId(1);
        admin = makeAddr("coreAdmin");
        proposer = makeAddr("coreProposer");
        activator = makeAddr("coreActivator");
        quarantiner = makeAddr("coreQuarantiner");
        collector = new ProtocolRevenueCollectorV1();
        registry =
            new ProtocolRevenueSourceRegistryV1(2 days, admin, proposer, activator, quarantiner, address(collector));
        executor = new ProtocolRevenueClaimExecutorV1(address(registry), address(collector), ISOLATED_CALL_GAS);
        vm.deal(REWARD_WALLET, 0);
    }

    function _config(address source, address asset, uint64 activationBlock)
        internal
        view
        returns (ProtocolRevenueSourceConfigV1 memory config)
    {
        config = ProtocolRevenueSourceConfigV1({
            sourceId: bytes32(0),
            source: source,
            runtimeCodeHash: source.codehash,
            asset: asset,
            claimSelector: IProgrammableProtocolFeeSourceV1.claimProgrammableFees.selector,
            recipient: REWARD_WALLET,
            activationBlock: activationBlock
        });
        config.sourceId = registry.computeSourceId(config);
    }

    function _register(address source, address asset) internal returns (bytes32 sourceId) {
        bytes memory runtime = source.code;
        ProtocolRevenueSourceConfigV1 memory config = _config(source, asset, uint64(block.number + ACTIVATION_DELAY));
        vm.etch(source, bytes(""));
        vm.prank(proposer);
        registry.proposeSource(config);
        vm.roll(config.activationBlock);
        vm.etch(source, runtime);
        vm.prank(activator);
        registry.activateSource(config.sourceId);
        return config.sourceId;
    }
}
