// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Script } from "forge-std/Script.sol";

import { ProtocolRevenueClaimCoordinatorV2 } from "../src/ProtocolRevenueClaimCoordinatorV2.sol";
import { ProtocolRevenueVaultV2 } from "../src/ProtocolRevenueVaultV2.sol";

/// @title DeployMainnetProtocolRevenueV2
/// @notice Fail-closed deployment of the ERC-7715-compatible claim coordinator and immutable revenue vault.
/// @dev This script never reads a private key. A normal run is simulation only; broadcasting still requires Forge's
///      separate `--broadcast` flag. Deployment does not request a wallet permission or activate Vercel.
contract DeployMainnetProtocolRevenueV2 is Script {
    uint256 internal constant MAINNET_CHAIN_ID = 1;
    uint256 internal constant EIP170_RUNTIME_LIMIT = 24_576;

    address public constant REVENUE_AUTHORITY = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    address public constant TREASURY = 0x2Bb333d48DFAF1596D9036671d2E43168994249E;
    address public constant V4_TOKEN = 0x7987f03462200b3D8A072E02C89A8A41dCB124EE;

    struct DeploymentPlan {
        address broadcaster;
        uint64 startingNonce;
        address coordinator;
        address vault;
        address keeper;
        bytes32 sourceCommitment;
    }

    struct DeploymentResult {
        ProtocolRevenueClaimCoordinatorV2 coordinator;
        ProtocolRevenueVaultV2 vault;
        uint64 startingNonce;
        bytes32 sourceCommitment;
        bytes32 coordinatorRuntimeCodeHash;
        bytes32 vaultRuntimeCodeHash;
    }

    error DeploymentAddressOccupied(address target);
    error InvalidBroadcaster(address broadcaster);
    error InvalidKeeper(address keeper);
    error UnexpectedAddress(bytes32 field, address actual, address expected);
    error UnexpectedChain(uint256 actual, uint256 expected);
    error UnexpectedCodeSize(address target, uint256 actual, uint256 maximum);
    error UnexpectedNonce(address broadcaster, uint64 actual, uint64 expected);

    function run() external returns (DeploymentResult memory result) {
        address broadcaster = vm.envAddress("PROTOCOL_REVENUE_MAINNET_DEPLOYER");
        address keeper = vm.envAddress("PROTOCOL_REVENUE_KEEPER_ADDRESS");
        uint256 configuredNonce = vm.envUint("PROTOCOL_REVENUE_MAINNET_START_NONCE");
        if (configuredNonce > type(uint64).max - 2) {
            revert UnexpectedNonce(broadcaster, type(uint64).max, type(uint64).max - 2);
        }
        // forge-lint: disable-next-line(unsafe-typecast)
        return deployReviewed(broadcaster, uint64(configuredNonce), keeper);
    }

    function deployReviewed(address broadcaster, uint64 startingNonce, address keeper)
        public
        returns (DeploymentResult memory result)
    {
        if (block.chainid != MAINNET_CHAIN_ID) revert UnexpectedChain(block.chainid, MAINNET_CHAIN_ID);
        if (broadcaster == address(0)) revert InvalidBroadcaster(broadcaster);
        if (keeper == address(0) || keeper == REVENUE_AUTHORITY || keeper == TREASURY) revert InvalidKeeper(keeper);
        uint64 actualNonce = vm.getNonce(broadcaster);
        if (actualNonce != startingNonce) revert UnexpectedNonce(broadcaster, actualNonce, startingNonce);

        DeploymentPlan memory plan = deploymentPlan(broadcaster, startingNonce, keeper);
        _assertVacant(plan.coordinator);
        _assertVacant(plan.vault);

        vm.startBroadcast(broadcaster);
        result.coordinator = new ProtocolRevenueClaimCoordinatorV2(keeper);
        result.vault = new ProtocolRevenueVaultV2(keeper);
        vm.stopBroadcast();

        _assertAddress(keccak256("coordinator"), address(result.coordinator), plan.coordinator);
        _assertAddress(keccak256("vault"), address(result.vault), plan.vault);
        _validateConfiguration(result, keeper);
        uint64 finalNonce = vm.getNonce(broadcaster);
        if (finalNonce != startingNonce + 2) revert UnexpectedNonce(broadcaster, finalNonce, startingNonce + 2);

        result.startingNonce = startingNonce;
        result.sourceCommitment = plan.sourceCommitment;
        result.coordinatorRuntimeCodeHash = address(result.coordinator).codehash;
        result.vaultRuntimeCodeHash = address(result.vault).codehash;
    }

    function deploymentPlan(address broadcaster, uint64 startingNonce, address keeper)
        public
        pure
        returns (DeploymentPlan memory plan)
    {
        if (broadcaster == address(0)) revert InvalidBroadcaster(broadcaster);
        if (keeper == address(0) || keeper == REVENUE_AUTHORITY || keeper == TREASURY) revert InvalidKeeper(keeper);
        plan = DeploymentPlan({
            broadcaster: broadcaster,
            startingNonce: startingNonce,
            coordinator: vm.computeCreateAddress(broadcaster, startingNonce),
            vault: vm.computeCreateAddress(broadcaster, uint256(startingNonce) + 1),
            keeper: keeper,
            sourceCommitment: deploymentSourceCommitment(keeper)
        });
    }

    function deploymentSourceCommitment(address keeper) public pure returns (bytes32) {
        if (keeper == address(0) || keeper == REVENUE_AUTHORITY || keeper == TREASURY) revert InvalidKeeper(keeper);
        return keccak256(
            abi.encode(
                keccak256(type(ProtocolRevenueClaimCoordinatorV2).creationCode),
                keccak256(type(ProtocolRevenueVaultV2).creationCode),
                REVENUE_AUTHORITY,
                TREASURY,
                V4_TOKEN,
                keeper,
                uint16(5000),
                uint16(4950),
                uint16(50),
                uint64(1 days),
                uint256(5 ether)
            )
        );
    }

    function _validateConfiguration(DeploymentResult memory result, address expectedKeeper) private view {
        if (result.coordinator.keeper() != expectedKeeper) {
            revert UnexpectedAddress(keccak256("coordinatorKeeper"), result.coordinator.keeper(), expectedKeeper);
        }
        if (result.vault.keeper() != expectedKeeper) {
            revert UnexpectedAddress(keccak256("vaultKeeper"), result.vault.keeper(), expectedKeeper);
        }
        if (result.vault.REVENUE_AUTHORITY() != REVENUE_AUTHORITY) {
            revert UnexpectedAddress(keccak256("revenueAuthority"), result.vault.REVENUE_AUTHORITY(), REVENUE_AUTHORITY);
        }
        if (result.vault.TREASURY() != TREASURY) {
            revert UnexpectedAddress(keccak256("treasury"), result.vault.TREASURY(), TREASURY);
        }
        if (result.vault.V4_TOKEN() != V4_TOKEN) {
            revert UnexpectedAddress(keccak256("v4Token"), result.vault.V4_TOKEN(), V4_TOKEN);
        }
        _assertSize(address(result.coordinator));
        _assertSize(address(result.vault));
    }

    function _assertVacant(address target) private view {
        if (target.code.length != 0) revert DeploymentAddressOccupied(target);
    }

    function _assertSize(address target) private view {
        uint256 size = target.code.length;
        if (size > EIP170_RUNTIME_LIMIT) revert UnexpectedCodeSize(target, size, EIP170_RUNTIME_LIMIT);
    }

    function _assertAddress(bytes32 field, address actual, address expected) private pure {
        if (actual != expected) revert UnexpectedAddress(field, actual, expected);
    }
}
