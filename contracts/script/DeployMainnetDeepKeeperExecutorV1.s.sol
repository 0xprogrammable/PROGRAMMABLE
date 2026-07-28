// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Script } from "forge-std/Script.sol";

import { DeepKeeperExecutorV1 } from "../src/DeepKeeperExecutorV1.sol";
import { LiquidityGrowthFullRangeAutomationV1 } from "../src/LiquidityGrowthFullRangeAutomationV1.sol";

/// @title DeployMainnetDeepKeeperExecutorV1
/// @notice Fail-closed one-transaction deployment for Deep's immutable sponsored-keeper relay.
/// @dev A normal Forge script run is simulation only. Broadcasting still requires Forge's explicit `--broadcast`
///      flag and an operator-controlled signer. This does not modify the already deployed Deep infrastructure.
contract DeployMainnetDeepKeeperExecutorV1 is Script {
    uint256 internal constant MAINNET_CHAIN_ID = 1;
    uint256 internal constant EIP170_RUNTIME_LIMIT = 24_576;
    uint256 internal constant EXPECTED_MAX_BATCH_SIZE = 8;
    uint256 internal constant EXPECTED_ASSESSMENT_GAS_STIPEND = 150_000;
    uint256 internal constant EXPECTED_PROCESS_FEES_GAS_STIPEND = 700_000;
    uint256 internal constant EXPECTED_COMPOUND_PENDING_GAS_STIPEND = 220_000;
    uint256 internal constant EXPECTED_GROW_ORACLE_GAS_STIPEND = 450_000;
    uint256 internal constant EXPECTED_RESULT_GAS_RESERVE = 25_000;
    uint256 internal constant EXPECTED_FINAL_GAS_RESERVE = 25_000;

    address public constant AUTOMATION = 0x856a8E8421e76f55CD1e0D65B4f3c1b474289b2f;
    bytes32 public constant AUTOMATION_CODEHASH = 0x1b6cc50912806d27908a5e01abf30af392b909116e0d0f7321f828be52400ad8;

    struct DeploymentPlan {
        address broadcaster;
        uint64 startingNonce;
        address executor;
        bytes32 sourceCommitment;
    }

    struct DeploymentResult {
        DeepKeeperExecutorV1 executor;
        uint64 startingNonce;
        bytes32 sourceCommitment;
        bytes32 runtimeCodeHash;
    }

    error DeploymentAddressOccupied(address target);
    error InvalidBroadcaster(address broadcaster);
    error UnexpectedAddress(bytes32 field, address actual, address expected);
    error UnexpectedChain(uint256 actual, uint256 expected);
    error UnexpectedCodeHash(address target, bytes32 actual, bytes32 expected);
    error UnexpectedNonce(address broadcaster, uint64 actual, uint64 expected);
    error UnexpectedValue(bytes32 field, uint256 actual, uint256 expected);

    /// @notice Simulates or broadcasts the reviewed one-transaction deployment.
    /// @dev Required environment: DEEP_KEEPER_EXECUTOR_MAINNET_DEPLOYER and
    ///      DEEP_KEEPER_EXECUTOR_MAINNET_START_NONCE.
    function run() external returns (DeploymentResult memory result) {
        address broadcaster = vm.envAddress("DEEP_KEEPER_EXECUTOR_MAINNET_DEPLOYER");
        uint256 configuredNonce = vm.envUint("DEEP_KEEPER_EXECUTOR_MAINNET_START_NONCE");
        if (configuredNonce >= type(uint64).max) {
            revert UnexpectedValue(keccak256("startingNonce"), configuredNonce, type(uint64).max - 1);
        }

        // The explicit bound above makes this narrowing conversion lossless.
        // forge-lint: disable-next-line(unsafe-typecast)
        return deployReviewed(broadcaster, uint64(configuredNonce));
    }

    /// @notice Explicit-argument entrypoint used by pinned-fork tests and reviewed simulations.
    function deployReviewed(address broadcaster, uint64 startingNonce) public returns (DeploymentResult memory result) {
        validateOfficialAutomation();
        if (broadcaster == address(0)) revert InvalidBroadcaster(broadcaster);
        if (startingNonce == type(uint64).max) {
            revert UnexpectedValue(keccak256("startingNonce"), startingNonce, type(uint64).max - 1);
        }

        uint64 actualNonce = vm.getNonce(broadcaster);
        if (actualNonce != startingNonce) revert UnexpectedNonce(broadcaster, actualNonce, startingNonce);

        DeploymentPlan memory plan = deploymentPlan(broadcaster, startingNonce);
        if (plan.executor.code.length != 0) revert DeploymentAddressOccupied(plan.executor);

        vm.startBroadcast(broadcaster);
        result.executor = new DeepKeeperExecutorV1(LiquidityGrowthFullRangeAutomationV1(payable(AUTOMATION)));
        vm.stopBroadcast();

        if (address(result.executor) != plan.executor) {
            revert UnexpectedAddress(keccak256("executor"), address(result.executor), plan.executor);
        }
        if (address(result.executor.automation()) != AUTOMATION) {
            revert UnexpectedAddress(keccak256("automation"), address(result.executor.automation()), AUTOMATION);
        }
        if (address(result.executor).code.length > EIP170_RUNTIME_LIMIT) {
            revert UnexpectedValue(
                keccak256("executorRuntimeSize"), address(result.executor).code.length, EIP170_RUNTIME_LIMIT
            );
        }
        _assertValue(keccak256("maxBatchSize"), result.executor.MAX_BATCH_SIZE(), EXPECTED_MAX_BATCH_SIZE);
        _assertValue(
            keccak256("assessmentGasStipend"), result.executor.ASSESSMENT_GAS_STIPEND(), EXPECTED_ASSESSMENT_GAS_STIPEND
        );
        _assertValue(
            keccak256("processFeesGasStipend"),
            result.executor.PROCESS_FEES_GAS_STIPEND(),
            EXPECTED_PROCESS_FEES_GAS_STIPEND
        );
        _assertValue(
            keccak256("compoundPendingGasStipend"),
            result.executor.COMPOUND_PENDING_GAS_STIPEND(),
            EXPECTED_COMPOUND_PENDING_GAS_STIPEND
        );
        _assertValue(
            keccak256("growOracleGasStipend"),
            result.executor.GROW_ORACLE_GAS_STIPEND(),
            EXPECTED_GROW_ORACLE_GAS_STIPEND
        );
        _assertValue(keccak256("resultGasReserve"), result.executor.RESULT_GAS_RESERVE(), EXPECTED_RESULT_GAS_RESERVE);
        _assertValue(keccak256("finalGasReserve"), result.executor.FINAL_GAS_RESERVE(), EXPECTED_FINAL_GAS_RESERVE);

        uint64 finalNonce = vm.getNonce(broadcaster);
        if (finalNonce != startingNonce + 1) revert UnexpectedNonce(broadcaster, finalNonce, startingNonce + 1);

        result.startingNonce = startingNonce;
        result.sourceCommitment = plan.sourceCommitment;
        result.runtimeCodeHash = address(result.executor).codehash;
    }

    function deploymentPlan(address broadcaster, uint64 startingNonce)
        public
        pure
        returns (DeploymentPlan memory plan)
    {
        if (broadcaster == address(0)) revert InvalidBroadcaster(broadcaster);
        plan = DeploymentPlan({
            broadcaster: broadcaster,
            startingNonce: startingNonce,
            executor: vm.computeCreateAddress(broadcaster, startingNonce),
            sourceCommitment: deploymentSourceCommitment()
        });
    }

    function validateOfficialAutomation() public view {
        if (block.chainid != MAINNET_CHAIN_ID) revert UnexpectedChain(block.chainid, MAINNET_CHAIN_ID);
        bytes32 actualCodeHash = AUTOMATION.codehash;
        if (actualCodeHash != AUTOMATION_CODEHASH) {
            revert UnexpectedCodeHash(AUTOMATION, actualCodeHash, AUTOMATION_CODEHASH);
        }
    }

    /// @notice Commits to the relay creation code, immutable automation and fixed action-gas policy.
    function deploymentSourceCommitment() public pure returns (bytes32) {
        bytes32 gasPolicyCommitment = keccak256(
            abi.encode(
                EXPECTED_MAX_BATCH_SIZE,
                EXPECTED_ASSESSMENT_GAS_STIPEND,
                EXPECTED_PROCESS_FEES_GAS_STIPEND,
                EXPECTED_COMPOUND_PENDING_GAS_STIPEND,
                EXPECTED_GROW_ORACLE_GAS_STIPEND,
                EXPECTED_RESULT_GAS_RESERVE,
                EXPECTED_FINAL_GAS_RESERVE
            )
        );
        bytes32 resultPolicyCommitment =
            keccak256("one-result-per-candidate:fresh-assessment:skip-none-or-drift:bounded-per-action-call");
        return keccak256(
            abi.encode(
                keccak256(type(DeepKeeperExecutorV1).creationCode),
                AUTOMATION,
                AUTOMATION_CODEHASH,
                gasPolicyCommitment,
                resultPolicyCommitment
            )
        );
    }

    function _assertValue(bytes32 field, uint256 actual, uint256 expected) private pure {
        if (actual != expected) revert UnexpectedValue(field, actual, expected);
    }
}
