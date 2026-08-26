// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";

import { ProgrammableVolumeFeeHookV2 } from "./ProgrammableVolumeFeeHookV2.sol";

/// @notice Reference-only CREATE2 factory enforcing the exact v4 callback permission address bits.
/// @dev Every successful deployment is atomically registered and initialized. There is no factory path that can
///      produce a deployment-only receipt which could be mistaken for proof of the actual pool and fee rates.
///      Reference candidate, not independently audited or deployed.
contract ProgrammableVolumeFeeHookFactoryV2 is ReentrancyGuardTransient {
    struct RegistrationConfig {
        IPoolManager poolManager;
        Currency currency0;
        Currency currency1;
        uint24 lpFeePips;
        int24 tickSpacing;
        address quoteCurrency;
        address projectFeeOwner;
        uint32 selectedBuyHundredthsOfBip;
        uint32 selectedSellHundredthsOfBip;
        uint160 initialSqrtPriceX96;
    }

    bytes32 public constant FACTORY_CONFIGURATION_DOMAIN =
        keccak256("ProgrammableVolumeFeeHookFactoryV2.factory-configuration.v1");
    bytes32 public constant REGISTRATION_CONFIG_DOMAIN =
        keccak256("ProgrammableVolumeFeeHookFactoryV2.registration-config.v1");
    bytes32 public constant EFFECTIVE_SALT_DOMAIN = keccak256("ProgrammableVolumeFeeHookFactoryV2.effective-salt.v1");
    uint160 public constant ALL_HOOK_MASK = uint160((1 << 14) - 1);
    uint160 public constant REQUIRED_HOOK_FLAGS = uint160(
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
    );

    /// @notice Final factory-domain receipt for an atomically registered hook.
    /// @dev This commits to `runtimeConfigurationHashOf[hook]`, whose preimage binds the PoolManager, exact PoolId,
    ///      currencies, quote side, LP configuration, initialization, owners, rates, policy and profile.
    mapping(address hook => bytes32 factoryConfigurationHash) public factoryConfigurationHashOf;
    mapping(address hook => bytes32 runtimeConfigurationHash) public runtimeConfigurationHashOf;
    mapping(address hook => bytes32 registrationConfigHash) public registrationConfigHashOf;
    mapping(address hook => bytes32 effectiveSalt) public effectiveSaltOf;

    error DeploymentAddressMismatch(address actual, address predicted);
    error ExistingDeploymentReceiptMismatch(
        address hook,
        bytes32 expectedRegistrationConfigHash,
        bytes32 storedRegistrationConfigHash,
        bytes32 expectedEffectiveSalt,
        bytes32 storedEffectiveSalt,
        bytes32 storedRuntimeConfigurationHash,
        bytes32 observedRuntimeConfigurationHash,
        bytes32 storedFactoryConfigurationHash,
        bytes32 expectedFactoryConfigurationHash
    );
    error InvalidHookAddress(address hook, uint160 actualFlags, uint160 requiredFlags);

    event ProgrammableVolumeFeeHookDeployedAndRegistered(
        address indexed hook,
        address indexed poolManager,
        bytes32 indexed poolId,
        bytes32 userSalt,
        bytes32 effectiveSalt,
        bytes32 registrationConfigHash,
        bytes32 runtimeConfigurationHash,
        bytes32 factoryConfigurationHash
    );
    event ProgrammableVolumeFeeHookDeploymentReconciled(
        address indexed hook,
        address indexed poolManager,
        bytes32 indexed poolId,
        bytes32 userSalt,
        bytes32 effectiveSalt,
        bytes32 registrationConfigHash,
        bytes32 runtimeConfigurationHash,
        bytes32 factoryConfigurationHash
    );

    function deployAndRegister(bytes32 userSalt, RegistrationConfig calldata config)
        external
        nonReentrant
        returns (ProgrammableVolumeFeeHookV2 hook, bytes32 poolId, int24 initialTick, bytes32 factoryConfigurationHash)
    {
        (address predicted, bytes32 effectiveSalt_, bytes32 registrationConfigHash_, bytes memory code) =
            _deploymentIdentity(userSalt, config);
        uint160 actualFlags = uint160(predicted) & ALL_HOOK_MASK;
        if (actualFlags != REQUIRED_HOOK_FLAGS) {
            revert InvalidHookAddress(predicted, actualFlags, REQUIRED_HOOK_FLAGS);
        }
        if (predicted.code.length != 0) {
            return _reconcileExistingDeployment(
                predicted, userSalt, effectiveSalt_, registrationConfigHash_, address(config.poolManager)
            );
        }

        address deployed = Create2.deploy(0, effectiveSalt_, code);
        if (deployed != predicted) revert DeploymentAddressMismatch(deployed, predicted);
        hook = ProgrammableVolumeFeeHookV2(deployed);

        PoolKey memory key = PoolKey({
            currency0: config.currency0,
            currency1: config.currency1,
            fee: config.lpFeePips,
            tickSpacing: config.tickSpacing,
            hooks: hook
        });
        // This external call targets the hook just created above, whose immutable registrar is this factory. The
        // factory entrypoint is transient-nonReentrant, registration is one-shot, and any callback or later receipt
        // failure reverts the CREATE2 deployment atomically, so no attacker-controlled reentry can observe or forge
        // the post-registration receipt mappings.
        // slither-disable-next-line reentrancy-benign
        (poolId, initialTick) = hook.registerCanonicalPool(
            key,
            config.projectFeeOwner,
            config.selectedBuyHundredthsOfBip,
            config.selectedSellHundredthsOfBip,
            config.initialSqrtPriceX96
        );

        bytes32 runtimeConfigurationHash = hook.runtimeConfigurationHash();
        factoryConfigurationHash = _factoryConfigurationHash(deployed, runtimeConfigurationHash);
        registrationConfigHashOf[deployed] = registrationConfigHash_;
        effectiveSaltOf[deployed] = effectiveSalt_;
        runtimeConfigurationHashOf[deployed] = runtimeConfigurationHash;
        factoryConfigurationHashOf[deployed] = factoryConfigurationHash;

        emit ProgrammableVolumeFeeHookDeployedAndRegistered(
            deployed,
            address(config.poolManager),
            poolId,
            userSalt,
            effectiveSalt_,
            registrationConfigHash_,
            runtimeConfigurationHash,
            factoryConfigurationHash
        );
    }

    /// @notice Complete domain-separated commitment to every one-shot registration input.
    /// @dev The chain and this factory are explicit even though CREATE2 also binds the deployer. This makes the
    ///      commitment independently auditable and prevents a copied user salt from selecting the same address with a
    ///      different owner, rate, pool shape or initialization price.
    function registrationConfigHash(RegistrationConfig calldata config) external view returns (bytes32) {
        return _registrationConfigHash(config);
    }

    /// @notice CREATE2 salt derived from the caller's mining salt and complete registration commitment.
    function effectiveSalt(bytes32 userSalt, RegistrationConfig calldata config) external view returns (bytes32) {
        return _effectiveSalt(userSalt, _registrationConfigHash(config));
    }

    /// @notice Canonical prediction path used by both salt mining and deployment.
    function predictHookAddress(bytes32 userSalt, RegistrationConfig calldata config)
        external
        view
        returns (address predicted, bytes32 effectiveSalt_, bytes32 registrationConfigHash_)
    {
        (predicted, effectiveSalt_, registrationConfigHash_,) = _deploymentIdentity(userSalt, config);
    }

    /// @notice CREATE2 init code with this factory fixed as the one-shot registrar.
    function initCode(IPoolManager poolManager, address quoteCurrency) public view returns (bytes memory) {
        // slither-disable-next-line too-many-digits
        return abi.encodePacked(
            type(ProgrammableVolumeFeeHookV2).creationCode, abi.encode(poolManager, address(this), quoteCurrency)
        );
    }

    function initCodeHash(IPoolManager poolManager, address quoteCurrency) external view returns (bytes32) {
        return keccak256(initCode(poolManager, quoteCurrency));
    }

    function _deploymentIdentity(bytes32 userSalt, RegistrationConfig calldata config)
        private
        view
        returns (address predicted, bytes32 effectiveSalt_, bytes32 registrationConfigHash_, bytes memory code)
    {
        registrationConfigHash_ = _registrationConfigHash(config);
        effectiveSalt_ = _effectiveSalt(userSalt, registrationConfigHash_);
        code = initCode(config.poolManager, config.quoteCurrency);
        predicted = Create2.computeAddress(effectiveSalt_, keccak256(code));
    }

    function _registrationConfigHash(RegistrationConfig calldata config) private view returns (bytes32) {
        return keccak256(
            abi.encode(
                REGISTRATION_CONFIG_DOMAIN,
                block.chainid,
                address(this),
                address(config.poolManager),
                Currency.unwrap(config.currency0),
                Currency.unwrap(config.currency1),
                config.lpFeePips,
                config.tickSpacing,
                config.quoteCurrency,
                config.projectFeeOwner,
                config.selectedBuyHundredthsOfBip,
                config.selectedSellHundredthsOfBip,
                config.initialSqrtPriceX96
            )
        );
    }

    function _effectiveSalt(bytes32 userSalt, bytes32 registrationConfigHash_) private pure returns (bytes32) {
        return keccak256(abi.encode(EFFECTIVE_SALT_DOMAIN, userSalt, registrationConfigHash_));
    }

    function _factoryConfigurationHash(address hook, bytes32 runtimeConfigurationHash) private view returns (bytes32) {
        return keccak256(
            abi.encode(FACTORY_CONFIGURATION_DOMAIN, block.chainid, address(this), hook, runtimeConfigurationHash)
        );
    }

    function _reconcileExistingDeployment(
        address predicted,
        bytes32 userSalt,
        bytes32 effectiveSalt_,
        bytes32 registrationConfigHash_,
        address poolManager
    )
        private
        returns (ProgrammableVolumeFeeHookV2 hook, bytes32 poolId, int24 initialTick, bytes32 factoryConfigurationHash)
    {
        bytes32 storedRegistrationConfigHash = registrationConfigHashOf[predicted];
        bytes32 storedEffectiveSalt = effectiveSaltOf[predicted];
        bytes32 storedRuntimeConfigurationHash = runtimeConfigurationHashOf[predicted];
        bytes32 storedFactoryConfigurationHash = factoryConfigurationHashOf[predicted];
        bytes32 observedRuntimeConfigurationHash = bytes32(0);
        hook = ProgrammableVolumeFeeHookV2(predicted);
        // A low-level static call lets malformed foreign bytecode fail closed without an ABI-decoding panic escaping
        // the reconciliation error. Exactly 32 return bytes are required before the runtime receipt is considered.
        // slither-disable-next-line low-level-calls
        (bool runtimeCallSucceeded, bytes memory runtimeReturnData) =
            predicted.staticcall(abi.encodeCall(ProgrammableVolumeFeeHookV2.runtimeConfigurationHash, ()));
        if (runtimeCallSucceeded && runtimeReturnData.length == 32) {
            observedRuntimeConfigurationHash = abi.decode(runtimeReturnData, (bytes32));
        }
        bytes32 expectedFactoryConfigurationHash =
            _factoryConfigurationHash(predicted, observedRuntimeConfigurationHash);

        if (
            storedRegistrationConfigHash != registrationConfigHash_ || storedEffectiveSalt != effectiveSalt_
                || storedRuntimeConfigurationHash == bytes32(0)
                || storedRuntimeConfigurationHash != observedRuntimeConfigurationHash
                || storedFactoryConfigurationHash == bytes32(0)
                || storedFactoryConfigurationHash != expectedFactoryConfigurationHash
        ) {
            revert ExistingDeploymentReceiptMismatch(
                predicted,
                registrationConfigHash_,
                storedRegistrationConfigHash,
                effectiveSalt_,
                storedEffectiveSalt,
                storedRuntimeConfigurationHash,
                observedRuntimeConfigurationHash,
                storedFactoryConfigurationHash,
                expectedFactoryConfigurationHash
            );
        }

        poolId = hook.canonicalPoolId();
        initialTick = hook.canonicalPoolInitialTick();
        factoryConfigurationHash = storedFactoryConfigurationHash;
        emit ProgrammableVolumeFeeHookDeploymentReconciled(
            predicted,
            poolManager,
            poolId,
            userSalt,
            effectiveSalt_,
            registrationConfigHash_,
            observedRuntimeConfigurationHash,
            factoryConfigurationHash
        );
    }
}
