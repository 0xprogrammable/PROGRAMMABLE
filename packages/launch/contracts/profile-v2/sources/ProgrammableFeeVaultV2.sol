// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProgrammableFeeVaultV1 } from "./ProgrammableAdditiveFeeHookV1.sol";

uint256 constant PROGRAMMABLE_FEE_VAULT_CHAIN_ID_V2 = 1;
uint160 constant PROGRAMMABLE_FEE_VAULT_REQUIRED_HOOK_FLAGS_V2 = (1 << 13) | (1 << 6) | (1 << 2);

address constant PROGRAMMABLE_CANONICAL_POOL_MANAGER_V2 = 0x000000000004444c5dc75cB358380D2e3dE08A90;
bytes32 constant PROGRAMMABLE_CANONICAL_POOL_MANAGER_RUNTIME_CODE_HASH_V2 =
    0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293;
address constant PROGRAMMABLE_CANONICAL_GRAPH_DEPLOYER_V2 = 0xB012e4A8F2c5FC4E8E4faCA9D5Ad6FfF13FBA887;
bytes32 constant PROGRAMMABLE_CANONICAL_GRAPH_DEPLOYER_RUNTIME_CODE_HASH_V2 =
    0xd23692fae59331592048e71a96d4963e170ee56e449683dc9f7fa3f9470018b8;

/// @notice V2 vault reuses the V1 accounting and claim state machine while
/// strengthening the one-time adapter mask and canonical deployment checks.
abstract contract ProgrammableFeeVaultV2Core is ProgrammableFeeVaultV1 {
    uint160 public constant REQUIRED_ADAPTER_FLAGS_V2 = PROGRAMMABLE_FEE_VAULT_REQUIRED_HOOK_FLAGS_V2;
    address public immutable graphDeployer;

    constructor(address poolManager_, address graphDeployer_) ProgrammableFeeVaultV1(poolManager_, graphDeployer_) {
        graphDeployer = graphDeployer_;
    }

    function requiredAdapterFlags() public pure override returns (uint160) {
        return REQUIRED_ADAPTER_FLAGS_V2;
    }

    function canonicalPoolManagerRuntimeCodeHash() external view returns (bytes32) {
        return _canonicalPoolManagerRuntimeCodeHash();
    }

    function canonicalGraphDeployerRuntimeCodeHash() external view returns (bytes32) {
        return _canonicalGraphDeployerRuntimeCodeHash();
    }

    function _beforeAdapterBinding() internal view override {
        if (block.chainid != PROGRAMMABLE_FEE_VAULT_CHAIN_ID_V2) {
            revert UnsupportedFeePolicyChain(block.chainid, PROGRAMMABLE_FEE_VAULT_CHAIN_ID_V2);
        }
        _requireRuntimeCodeHash(poolManager, _canonicalPoolManagerRuntimeCodeHash());
        _requireRuntimeCodeHash(graphDeployer, _canonicalGraphDeployerRuntimeCodeHash());
    }

    function _canonicalPoolManagerRuntimeCodeHash() internal view virtual returns (bytes32);
    function _canonicalGraphDeployerRuntimeCodeHash() internal view virtual returns (bytes32);

    function _requireRuntimeCodeHash(address target, bytes32 expected) internal view {
        bytes32 actual = target.codehash;
        if (actual != expected) revert RuntimeCodeHashMismatch(target, expected, actual);
    }

    error RuntimeCodeHashMismatch(address target, bytes32 expected, bytes32 actual);
    error UnsupportedFeePolicyChain(uint256 actual, uint256 required);
}

contract ProgrammableFeeVaultV2 is ProgrammableFeeVaultV2Core {
    constructor()
        ProgrammableFeeVaultV2Core(PROGRAMMABLE_CANONICAL_POOL_MANAGER_V2, PROGRAMMABLE_CANONICAL_GRAPH_DEPLOYER_V2)
    { }

    function _canonicalPoolManagerRuntimeCodeHash() internal pure override returns (bytes32) {
        return PROGRAMMABLE_CANONICAL_POOL_MANAGER_RUNTIME_CODE_HASH_V2;
    }

    function _canonicalGraphDeployerRuntimeCodeHash() internal pure override returns (bytes32) {
        return PROGRAMMABLE_CANONICAL_GRAPH_DEPLOYER_RUNTIME_CODE_HASH_V2;
    }
}
