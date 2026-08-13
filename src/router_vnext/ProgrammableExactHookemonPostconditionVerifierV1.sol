// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    IProgrammableExactHookemonPostconditionVerifierV1
} from "./IProgrammableExactHookemonNormalCreateProfileV1.sol";
import { IProgrammableRuntimeBindingV1 } from "./IProgrammableUniversalLaunchKernelV1.sol";
import { ProgrammableTokenIdentityPolicyV1 } from "./ProgrammableTokenIdentityPolicyV1.sol";

interface IExactHookemonERC20ViewV1 {
    function allowance(address owner, address spender) external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
}

interface IExactHookemonAtomicLauncherViewV1 {
    struct PoolKeyV1 {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    function hookFactory() external view returns (address);
    function childFactoryRegistry() external view returns (address);
    function token() external view returns (address);
    function hook() external view returns (address);
    function rewardsDistributor() external view returns (address);
    function bridgeAdapter() external view returns (address);
    function returnAdapter() external view returns (address);
    function cycleVault() external view returns (address);
    function treasuryVesting() external view returns (address);
    function positionTimelock() external view returns (address);
    function positionManager() external view returns (address);
    function usdc() external view returns (address);
    function fundingWallet() external view returns (address);
    function approvedMultisig() external view returns (address);
    function executor() external view returns (address);
    function artifactAuthorizer() external view returns (address);
    function launchTimestamp() external view returns (uint64);
    function positionTokenId() external view returns (uint256);
    function canonicalPoolId() external view returns (bytes32);
    function tokenRoundingDust() external view returns (uint256);
    function launchId() external view returns (bytes32);
    function launchConfigHash() external view returns (bytes32);
    function launchHash() external view returns (bytes32);
    function tokenNameHash() external view returns (bytes32);
    function tokenSymbolHash() external view returns (bytes32);
    function poolKey() external view returns (PoolKeyV1 memory key);
}

interface IExactHookemonFeeHookViewV1 {
    function poolManager() external view returns (address);
    function registrar() external view returns (address);
    function quoteCurrencyAddress() external view returns (address);
    function canonicalPoolId() external view returns (bytes32);
    function canonicalPoolRegistered() external view returns (bool);
    function projectFeeOwner() external view returns (address);
    function selectedBuyHundredthsOfBip() external view returns (uint32);
    function selectedSellHundredthsOfBip() external view returns (uint32);
    function PROGRAMMABLE_FEE_OWNER() external view returns (address);
    function PROGRAMMABLE_HUNDREDTHS_OF_BIP() external view returns (uint32);
    function totalQuoteFeesAccrued() external view returns (uint256);
    function programmableFeeRemainder() external view returns (uint256);
    function projectFeeRemainder() external view returns (uint256);
    function feeRates(bool isBuy)
        external
        view
        returns (uint32 selected, uint32 effective, uint32 project, uint32 programmable);
}

interface IExactHookemonHookFactoryViewV1 {
    function configurationHashOf(address hook) external view returns (bytes32);
    function runtimeCodeHashOf(address hook) external view returns (bytes32);
}

interface IExactHookemonChildRegistryViewV1 {
    function factory(uint8 kind) external view returns (address);
}

interface IExactHookemonFixedFactoryViewV1 {
    function kind() external view returns (uint8);
    function creationCodeHash() external view returns (bytes32);
    function runtimeCodeHash() external view returns (bytes32);
    function deploymentConfigHash(address child) external view returns (bytes32);
    function chunkAddresses() external view returns (address[] memory);
    function predictChild(bytes32 launchId, address launcher, bytes32 launchConfigHash) external view returns (address);
}

interface IExactHookemonActivatedChildViewV1 {
    function bootstrapFactory() external view returns (address);
    function bootstrapLauncher() external view returns (address);
    function launchId() external view returns (bytes32);
    function launchConfigHash() external view returns (bytes32);
    function activated() external view returns (bool);
}

interface IExactHookemonPositionTimelockViewV1 {
    function positionManager() external view returns (address);
    function depositor() external view returns (address);
    function beneficiary() external view returns (address);
    function unlockTimestamp() external view returns (uint64);
    function expectedTokenId() external view returns (uint256);
    function expectedPoolId() external view returns (bytes32);
    function launchToken() external view returns (address);
    function expectedTokenDust() external view returns (uint256);
    function expectedPoolFee() external view returns (uint24);
    function expectedTickSpacing() external view returns (int24);
    function expectedTickLower() external view returns (int24);
    function expectedTickUpper() external view returns (int24);
    function expectedLiquidity() external view returns (uint128);
    function tokenId() external view returns (uint256);
    function positionDeposited() external view returns (bool);
    function released() external view returns (bool);
}

interface IExactHookemonPositionManagerViewV1 {
    function ownerOf(uint256 tokenId) external view returns (address);
    function getApproved(uint256 tokenId) external view returns (address);
    function getPositionLiquidity(uint256 tokenId) external view returns (uint128);
}

interface IExactHookemonCycleVaultViewV1 {
    function asset() external view returns (address);
    function projectFeeHook() external view returns (address);
    function distributor() external view returns (address);
    function admin() external view returns (address);
    function guardian() external view returns (address);
    function operationalReserveMicroUsdc() external view returns (uint256);
    function availableProjectFeesMicroUsdc() external view returns (uint256);
}

/// @notice Closed architecture module for Hookemon source 55fd47ce / tree 2667ff1b.
/// @dev Kept below the Kernel's per-runtime closed-bytecode scan bound. The coordinator and profile bind this exact
///      module address, runtime codehash and self-attested binding hash before any launch can begin.
contract ProgrammableExactHookemonArchitectureVerifierModuleV1 {
    struct FactoryVerificationContextV1 {
        address launcher;
        bytes32 launchId;
        bytes32 launchConfigHash;
    }

    bytes20 private constant SOURCE_COMMIT_ID = bytes20(hex"55fd47cec3ed8e61e59d5a919d98aeec2e269549");
    bytes20 private constant SOURCE_TREE_ID = bytes20(hex"2667ff1bee70dd082596d5f65b3ed4cb2c1ce387");
    bytes32 private constant RUNTIME_BINDING_TYPEHASH = keccak256(
        "ProgrammableExactHookemonArchitectureVerifierModuleBindingV1(uint256 chainId,address module,bytes20 sourceCommit,bytes20 sourceTree,bytes32 architectureTypeHash,bytes32 expectedTokenNameHash,bytes32 expectedTokenSymbolHash)"
    );
    bytes32 private constant ARCHITECTURE_TYPEHASH = keccak256(
        "ExactHookemonArchitectureV1(bytes20 sourceCommit,bytes20 sourceTree,address launcher,bytes32 launcherRuntimeCodeHash,bytes32 identityHead,bytes32 exclusiveHead,bytes32 sharedHead,bytes32 factoryHead)"
    );

    bytes32 private immutable EXPECTED_TOKEN_NAME_HASH;
    bytes32 private immutable EXPECTED_TOKEN_SYMBOL_HASH;

    error InvalidState(uint256 field);

    constructor(bytes32 expectedTokenNameHash, bytes32 expectedTokenSymbolHash) {
        if (expectedTokenNameHash == bytes32(0) || expectedTokenSymbolHash == bytes32(0)) revert InvalidState(1);
        EXPECTED_TOKEN_NAME_HASH = expectedTokenNameHash;
        EXPECTED_TOKEN_SYMBOL_HASH = expectedTokenSymbolHash;
    }

    function runtimeBindingHashV1() external view virtual returns (bytes32) {
        return keccak256(
            abi.encode(
                RUNTIME_BINDING_TYPEHASH,
                block.chainid,
                address(this),
                SOURCE_COMMIT_ID,
                SOURCE_TREE_ID,
                ARCHITECTURE_TYPEHASH,
                EXPECTED_TOKEN_NAME_HASH,
                EXPECTED_TOKEN_SYMBOL_HASH
            )
        );
    }

    function verifyArchitectureStateV1(address launcher) external view returns (bytes32 architectureStateHash) {
        if (launcher == address(0) || launcher.code.length == 0) revert InvalidState(1);
        return _architectureStateHash(launcher, EXPECTED_TOKEN_NAME_HASH, EXPECTED_TOKEN_SYMBOL_HASH);
    }

    function _architectureStateHash(address launcher, bytes32 expectedTokenNameHash, bytes32 expectedTokenSymbolHash)
        internal
        view
        returns (bytes32)
    {
        IExactHookemonAtomicLauncherViewV1 target = IExactHookemonAtomicLauncherViewV1(launcher);
        IExactHookemonERC20ViewV1 token = IExactHookemonERC20ViewV1(target.token());
        bytes32 observedNameHash = keccak256(bytes(token.name()));
        bytes32 observedSymbolHash = keccak256(bytes(token.symbol()));
        if (
            expectedTokenNameHash == bytes32(0) || expectedTokenSymbolHash == bytes32(0)
                || observedNameHash != expectedTokenNameHash || observedSymbolHash != expectedTokenSymbolHash
                || target.tokenNameHash() != expectedTokenNameHash
                || target.tokenSymbolHash() != expectedTokenSymbolHash
        ) revert InvalidState(2);
        address[9] memory exclusive = _exclusiveAccounts(target, launcher);
        bytes32 exclusiveHead = bytes32(0);
        for (uint256 i; i < 9; ++i) {
            if (exclusive[i].code.length == 0) revert InvalidState(2);
            exclusiveHead = keccak256(abi.encode(exclusiveHead, i, exclusive[i], exclusive[i].codehash));
        }
        (bytes32 sharedHead, bytes32 factoryHead) = _sharedAndFactoryHeads(target, launcher, exclusive);
        bytes32 identityHead = _identityHead(target, observedNameHash, observedSymbolHash);
        return _architectureHash(launcher, identityHead, exclusiveHead, sharedHead, factoryHead);
    }

    function _architectureHash(
        address launcher,
        bytes32 identityHead,
        bytes32 exclusiveHead,
        bytes32 sharedHead,
        bytes32 factoryHead
    ) private view returns (bytes32) {
        return keccak256(
            abi.encode(
                ARCHITECTURE_TYPEHASH,
                SOURCE_COMMIT_ID,
                SOURCE_TREE_ID,
                launcher,
                launcher.codehash,
                identityHead,
                exclusiveHead,
                sharedHead,
                factoryHead
            )
        );
    }

    function _identityHead(
        IExactHookemonAtomicLauncherViewV1 target,
        bytes32 observedNameHash,
        bytes32 observedSymbolHash
    ) private view returns (bytes32) {
        bytes32 launchHead = keccak256(
            abi.encode(
                target.launchConfigHash(),
                target.launchId(),
                target.launchHash(),
                target.launchTimestamp(),
                target.positionManager(),
                target.usdc()
            )
        );
        bytes32 authorityHead = keccak256(
            abi.encode(
                target.fundingWallet(), target.approvedMultisig(), target.executor(), target.artifactAuthorizer()
            )
        );
        return keccak256(abi.encode(launchHead, authorityHead, observedNameHash, observedSymbolHash));
    }

    function _exclusiveAccounts(IExactHookemonAtomicLauncherViewV1 target, address launcher)
        private
        view
        returns (address[9] memory exclusive)
    {
        exclusive[0] = launcher;
        exclusive[1] = target.token();
        exclusive[2] = target.hook();
        exclusive[3] = target.rewardsDistributor();
        exclusive[4] = target.bridgeAdapter();
        exclusive[5] = target.returnAdapter();
        exclusive[6] = target.cycleVault();
        exclusive[7] = target.treasuryVesting();
        exclusive[8] = target.positionTimelock();
    }

    function _sharedAndFactoryHeads(
        IExactHookemonAtomicLauncherViewV1 target,
        address launcher,
        address[9] memory exclusive
    ) private view returns (bytes32 sharedHead, bytes32 factoryHead) {
        address hookFactory = target.hookFactory();
        address registryAddress = target.childFactoryRegistry();
        if (hookFactory.code.length == 0 || registryAddress.code.length == 0) revert InvalidState(3);
        sharedHead = keccak256(abi.encode(sharedHead, uint256(0), hookFactory, hookFactory.codehash));
        sharedHead = keccak256(abi.encode(sharedHead, uint256(1), registryAddress, registryAddress.codehash));
        FactoryVerificationContextV1 memory context = FactoryVerificationContextV1({
            launcher: launcher, launchId: target.launchId(), launchConfigHash: target.launchConfigHash()
        });
        (bytes32 factoriesSharedHead, bytes32 verifiedFactoryHead) = _factoryHeads(registryAddress, exclusive, context);
        sharedHead = keccak256(abi.encode(sharedHead, factoriesSharedHead));
        factoryHead = verifiedFactoryHead;
        if (
            IExactHookemonHookFactoryViewV1(hookFactory).runtimeCodeHashOf(exclusive[2]) != exclusive[2].codehash
                || IExactHookemonHookFactoryViewV1(hookFactory).configurationHashOf(exclusive[2]) == bytes32(0)
        ) revert InvalidState(7);
    }

    function _factoryHeads(
        address registryAddress,
        address[9] memory exclusive,
        FactoryVerificationContextV1 memory context
    ) private view returns (bytes32 sharedHead, bytes32 factoryHead) {
        IExactHookemonChildRegistryViewV1 registry = IExactHookemonChildRegistryViewV1(registryAddress);
        for (uint8 kind = 1; kind <= 6; ++kind) {
            uint256 index = kind - 1;
            address factoryAddress = registry.factory(kind);
            address child = exclusive[3 + index];
            (address chunk, bytes32 factoryLeaf) = _factoryStateLeaf(kind, factoryAddress, child, context);
            sharedHead = keccak256(abi.encode(sharedHead, uint256(2 + index), factoryAddress, factoryAddress.codehash));
            sharedHead = keccak256(abi.encode(sharedHead, uint256(8 + index), chunk, chunk.codehash));
            factoryHead = keccak256(abi.encode(factoryHead, kind, factoryLeaf));
        }
    }

    function _factoryStateLeaf(
        uint8 kind,
        address factoryAddress,
        address child,
        FactoryVerificationContextV1 memory context
    ) private view returns (address chunk, bytes32 factoryLeaf) {
        if (factoryAddress.code.length == 0) revert InvalidState(4);
        IExactHookemonFixedFactoryViewV1 factory = IExactHookemonFixedFactoryViewV1(factoryAddress);
        address[] memory chunks = factory.chunkAddresses();
        if (
            factory.kind() != kind || factory.creationCodeHash() == bytes32(0)
                || factory.runtimeCodeHash() != child.codehash || chunks.length != 1 || chunks[0].code.length == 0
                || factory.deploymentConfigHash(child) != context.launchConfigHash
                || factory.predictChild(context.launchId, context.launcher, context.launchConfigHash) != child
        ) revert InvalidState(5);
        IExactHookemonActivatedChildViewV1 activatedChild = IExactHookemonActivatedChildViewV1(child);
        if (
            activatedChild.bootstrapFactory() != factoryAddress
                || activatedChild.bootstrapLauncher() != context.launcher
                || activatedChild.launchId() != context.launchId
                || activatedChild.launchConfigHash() != context.launchConfigHash || !activatedChild.activated()
        ) revert InvalidState(6);
        chunk = chunks[0];
        factoryLeaf = keccak256(
            abi.encode(
                factoryAddress, factory.creationCodeHash(), factory.runtimeCodeHash(), chunk, chunk.codehash, child
            )
        );
    }
}

/// @notice Reusable architecture verifier for Hookemon source 55fd47ce / tree 2667ff1b.
/// @dev Expected identity hashes are exact per-launch inputs committed by the grant/permit/plan. This module has one
///      fixed runtime and never stores or selects executable bytes.
contract ProgrammableExactHookemonArchitectureVerifierModuleV2 is
    ProgrammableExactHookemonArchitectureVerifierModuleV1
{
    bytes20 private constant SOURCE_COMMIT_ID_V2 = bytes20(hex"55fd47cec3ed8e61e59d5a919d98aeec2e269549");
    bytes20 private constant SOURCE_TREE_ID_V2 = bytes20(hex"2667ff1bee70dd082596d5f65b3ed4cb2c1ce387");
    bytes32 private constant RUNTIME_BINDING_TYPEHASH_V2 = keccak256(
        "ProgrammableExactHookemonArchitectureVerifierModuleBindingV2(uint256 chainId,address module,bytes20 sourceCommit,bytes20 sourceTree,bytes32 architectureTypeHash)"
    );
    bytes32 private constant ARCHITECTURE_TYPEHASH_V2 = keccak256(
        "ExactHookemonArchitectureV1(bytes20 sourceCommit,bytes20 sourceTree,address launcher,bytes32 launcherRuntimeCodeHash,bytes32 identityHead,bytes32 exclusiveHead,bytes32 sharedHead,bytes32 factoryHead)"
    );

    constructor() ProgrammableExactHookemonArchitectureVerifierModuleV1(bytes32(uint256(1)), bytes32(uint256(2))) { }

    function runtimeBindingHashV1() external view override returns (bytes32) {
        return keccak256(
            abi.encode(
                RUNTIME_BINDING_TYPEHASH_V2,
                block.chainid,
                address(this),
                SOURCE_COMMIT_ID_V2,
                SOURCE_TREE_ID_V2,
                ARCHITECTURE_TYPEHASH_V2
            )
        );
    }

    function verifyArchitectureStateV2(address launcher, bytes32 expectedTokenNameHash, bytes32 expectedTokenSymbolHash)
        external
        view
        returns (bytes32 architectureStateHash)
    {
        if (launcher == address(0) || launcher.code.length == 0) revert InvalidState(1);
        return _architectureStateHash(launcher, expectedTokenNameHash, expectedTokenSymbolHash);
    }
}

/// @notice Closed stateless pool, custody and inclusive-revenue module for the exact Hookemon source.
contract ProgrammableExactHookemonEconomicVerifierModuleV1 {
    address private constant PROGRAMMABLE_FEE_OWNER = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    uint32 private constant SELECTED_TOTAL_HUNDREDTHS_OF_BIP = 30_000;
    uint32 private constant PROJECT_HUNDREDTHS_OF_BIP = 29_000;
    uint32 private constant PROGRAMMABLE_HUNDREDTHS_OF_BIP = 1000;
    uint24 private constant LP_FEE_PIPS = 3000;
    int24 private constant TICK_SPACING = 60;
    int24 private constant TICK_LOWER = -887_220;
    int24 private constant TICK_UPPER = 887_220;
    uint160 private constant REQUIRED_HOOK_FLAGS = 0x20cc;
    uint160 private constant ALL_HOOK_MASK = (1 << 14) - 1;
    uint256 private constant FIXED_TOKEN_SUPPLY = 420_690_000_000 ether;
    uint256 private constant TREASURY_TOKEN_AMOUNT = 42_069_000_000 ether;
    uint256 private constant OPERATIONAL_RESERVE_FLOOR_MICRO_USDC = 50e6;
    bytes20 private constant SOURCE_COMMIT_ID = bytes20(hex"55fd47cec3ed8e61e59d5a919d98aeec2e269549");
    bytes20 private constant SOURCE_TREE_ID = bytes20(hex"2667ff1bee70dd082596d5f65b3ed4cb2c1ce387");
    bytes32 private constant RUNTIME_BINDING_TYPEHASH = keccak256(
        "ProgrammableExactHookemonEconomicVerifierModuleBindingV1(uint256 chainId,address module,bytes20 sourceCommit,bytes20 sourceTree,bytes32 economicsHead)"
    );
    bytes32 private constant POOL_STATE_TYPEHASH =
        keccak256("ExactHookemonPoolStateV1(bytes32 identityHead,bytes32 positionHead,bytes32 fundingHead)");
    bytes32 private constant REVENUE_STATE_TYPEHASH = keccak256(
        "ExactHookemonRevenueStateV1(bytes32 identityHead,bytes32 directionalRatesHead,uint24 lpFeePips,bool lpFeeSeparate)"
    );

    error InvalidState(uint256 field);

    function runtimeBindingHashV1() external view returns (bytes32) {
        bytes32 economicsHead = keccak256(
            abi.encode(
                REQUIRED_HOOK_FLAGS,
                SELECTED_TOTAL_HUNDREDTHS_OF_BIP,
                PROJECT_HUNDREDTHS_OF_BIP,
                PROGRAMMABLE_HUNDREDTHS_OF_BIP,
                PROGRAMMABLE_FEE_OWNER,
                LP_FEE_PIPS
            )
        );
        return keccak256(
            abi.encode(
                RUNTIME_BINDING_TYPEHASH, block.chainid, address(this), SOURCE_COMMIT_ID, SOURCE_TREE_ID, economicsHead
            )
        );
    }

    function verifyEconomicStateV1(address launcher) external view returns (bytes32 poolHash, bytes32 revenueHash) {
        if (launcher == address(0) || launcher.code.length == 0) revert InvalidState(1);
        poolHash = _poolStateHash(launcher);
        revenueHash = _revenueStateHash(launcher);
    }

    function _poolStateHash(address launcher) private view returns (bytes32) {
        IExactHookemonAtomicLauncherViewV1 target = IExactHookemonAtomicLauncherViewV1(launcher);
        IExactHookemonAtomicLauncherViewV1.PoolKeyV1 memory key = target.poolKey();
        if (
            key.currency0 != target.usdc() || key.currency1 != target.token() || key.hooks != target.hook()
                || key.fee != LP_FEE_PIPS || key.tickSpacing != TICK_SPACING
        ) revert InvalidState(2);
        (uint256 tokenId, bytes32 positionHead) = _positionStateHead(target, launcher, key);
        bytes32 fundingHead = _fundingStateHead(target, launcher);
        return keccak256(abi.encode(POOL_STATE_TYPEHASH, _poolIdentityHead(target, tokenId), positionHead, fundingHead));
    }

    function _positionStateHead(
        IExactHookemonAtomicLauncherViewV1 target,
        address launcher,
        IExactHookemonAtomicLauncherViewV1.PoolKeyV1 memory key
    ) private view returns (uint256 tokenId, bytes32 positionHead) {
        IExactHookemonPositionTimelockViewV1 timelock = IExactHookemonPositionTimelockViewV1(target.positionTimelock());
        tokenId = target.positionTokenId();
        if (
            timelock.positionManager() != target.positionManager() || timelock.depositor() != launcher
                || timelock.beneficiary() != target.approvedMultisig()
                || timelock.unlockTimestamp() != target.launchTimestamp() + 2 * 365 days
                || timelock.expectedTokenId() != tokenId || timelock.expectedPoolId() != target.canonicalPoolId()
                || timelock.launchToken() != target.token()
                || timelock.expectedTokenDust() != target.tokenRoundingDust()
                || timelock.expectedPoolFee() != LP_FEE_PIPS || timelock.expectedTickSpacing() != TICK_SPACING
                || timelock.expectedTickLower() != TICK_LOWER || timelock.expectedTickUpper() != TICK_UPPER
                || timelock.expectedLiquidity() == 0 || timelock.tokenId() != tokenId || !timelock.positionDeposited()
                || timelock.released()
        ) revert InvalidState(3);
        IExactHookemonPositionManagerViewV1 positions = IExactHookemonPositionManagerViewV1(target.positionManager());
        if (
            positions.ownerOf(tokenId) != target.positionTimelock() || positions.getApproved(tokenId) != address(0)
                || positions.getPositionLiquidity(tokenId) != timelock.expectedLiquidity()
        ) revert InvalidState(4);
        positionHead = keccak256(
            abi.encode(
                key.fee,
                key.tickSpacing,
                TICK_LOWER,
                TICK_UPPER,
                timelock.expectedLiquidity(),
                target.tokenRoundingDust(),
                target.launchTimestamp(),
                timelock.unlockTimestamp()
            )
        );
    }

    function _fundingStateHead(IExactHookemonAtomicLauncherViewV1 target, address launcher)
        private
        view
        returns (bytes32 fundingHead)
    {
        IExactHookemonERC20ViewV1 token = IExactHookemonERC20ViewV1(target.token());
        if (
            token.totalSupply() != FIXED_TOKEN_SUPPLY
                || token.balanceOf(target.treasuryVesting()) != TREASURY_TOKEN_AMOUNT
                || token.balanceOf(target.positionTimelock()) != target.tokenRoundingDust()
                || token.balanceOf(launcher) != 0
                || IExactHookemonERC20ViewV1(target.usdc()).allowance(target.fundingWallet(), launcher) != 0
        ) revert InvalidState(5);
        IExactHookemonCycleVaultViewV1 vault = IExactHookemonCycleVaultViewV1(target.cycleVault());
        if (
            vault.asset() != target.usdc() || vault.projectFeeHook() != target.hook()
                || vault.distributor() != target.rewardsDistributor() || vault.admin() != target.approvedMultisig()
                || vault.guardian() != target.approvedMultisig()
        ) revert InvalidState(6);
        uint256 reserve = vault.operationalReserveMicroUsdc();
        uint256 available = vault.availableProjectFeesMicroUsdc();
        uint256 bootstrap = reserve + available;
        uint256 expectedReserve =
            bootstrap < OPERATIONAL_RESERVE_FLOOR_MICRO_USDC ? bootstrap : OPERATIONAL_RESERVE_FLOOR_MICRO_USDC;
        if (
            reserve != expectedReserve
                || IExactHookemonERC20ViewV1(target.usdc()).balanceOf(target.cycleVault()) < bootstrap
        ) revert InvalidState(7);
        fundingHead =
            keccak256(abi.encode(target.fundingWallet(), target.approvedMultisig(), reserve, available, bootstrap));
    }

    function _poolIdentityHead(IExactHookemonAtomicLauncherViewV1 target, uint256 tokenId)
        private
        view
        returns (bytes32)
    {
        bytes32 assetHead = keccak256(
            abi.encode(
                target.canonicalPoolId(),
                target.positionManager(),
                tokenId,
                target.token(),
                target.hook(),
                target.usdc()
            )
        );
        bytes32 custodyHead = keccak256(
            abi.encode(
                target.positionTimelock(), target.treasuryVesting(), target.launchConfigHash(), target.launchHash()
            )
        );
        return keccak256(abi.encode(assetHead, custodyHead));
    }

    function _revenueStateHash(address launcher) private view returns (bytes32) {
        IExactHookemonAtomicLauncherViewV1 target = IExactHookemonAtomicLauncherViewV1(launcher);
        address hookAddress = target.hook();
        if (uint160(hookAddress) & ALL_HOOK_MASK != REQUIRED_HOOK_FLAGS) revert InvalidState(8);
        IExactHookemonFeeHookViewV1 hook = IExactHookemonFeeHookViewV1(hookAddress);
        if (
            hook.poolManager() == address(0) || hook.registrar() != launcher
                || hook.quoteCurrencyAddress() != target.usdc() || !hook.canonicalPoolRegistered()
                || hook.canonicalPoolId() != target.canonicalPoolId() || hook.projectFeeOwner() != target.cycleVault()
                || hook.PROGRAMMABLE_FEE_OWNER() != PROGRAMMABLE_FEE_OWNER
                || hook.PROGRAMMABLE_HUNDREDTHS_OF_BIP() != PROGRAMMABLE_HUNDREDTHS_OF_BIP
                || hook.selectedBuyHundredthsOfBip() != SELECTED_TOTAL_HUNDREDTHS_OF_BIP
                || hook.selectedSellHundredthsOfBip() != SELECTED_TOTAL_HUNDREDTHS_OF_BIP
                || hook.totalQuoteFeesAccrued() != 0 || hook.programmableFeeRemainder() != 0
                || hook.projectFeeRemainder() != 0
        ) revert InvalidState(9);
        bytes32 directionalRatesHead = _directionalRatesHead(hook);
        bytes32 identityHead = keccak256(
            abi.encode(
                hookAddress,
                hook.poolManager(),
                launcher,
                target.usdc(),
                target.canonicalPoolId(),
                target.cycleVault(),
                PROGRAMMABLE_FEE_OWNER
            )
        );
        return keccak256(abi.encode(REVENUE_STATE_TYPEHASH, identityHead, directionalRatesHead, LP_FEE_PIPS, true));
    }

    function _directionalRatesHead(IExactHookemonFeeHookViewV1 hook) private view returns (bytes32) {
        (uint32 selectedBuy, uint32 effectiveBuy, uint32 projectBuy, uint32 programmableBuy) = hook.feeRates(true);
        (uint32 selectedSell, uint32 effectiveSell, uint32 projectSell, uint32 programmableSell) = hook.feeRates(false);
        if (
            selectedBuy != SELECTED_TOTAL_HUNDREDTHS_OF_BIP || effectiveBuy != SELECTED_TOTAL_HUNDREDTHS_OF_BIP
                || projectBuy != PROJECT_HUNDREDTHS_OF_BIP || programmableBuy != PROGRAMMABLE_HUNDREDTHS_OF_BIP
                || selectedSell != SELECTED_TOTAL_HUNDREDTHS_OF_BIP || effectiveSell != SELECTED_TOTAL_HUNDREDTHS_OF_BIP
                || projectSell != PROJECT_HUNDREDTHS_OF_BIP || programmableSell != PROGRAMMABLE_HUNDREDTHS_OF_BIP
        ) revert InvalidState(10);
        return keccak256(
            abi.encode(
                selectedBuy,
                selectedSell,
                effectiveBuy,
                effectiveSell,
                projectBuy,
                projectSell,
                programmableBuy,
                programmableSell
            )
        );
    }
}

/// @notice Plan-bound postflight coordinator for Hookemon source 55fd47ce / tree 2667ff1b.
/// @dev Architecture and economic verification are split solely to fit the immutable Kernel closed-runtime scan cap.
///      The coordinator deploys both modules, and the profile independently closes and rechecks every module codehash.
contract ProgrammableExactHookemonPostconditionVerifierV1 is IProgrammableExactHookemonPostconditionVerifierV1 {
    bytes20 private constant SOURCE_COMMIT_ID = bytes20(hex"55fd47cec3ed8e61e59d5a919d98aeec2e269549");
    bytes20 private constant SOURCE_TREE_ID = bytes20(hex"2667ff1bee70dd082596d5f65b3ed4cb2c1ce387");
    bytes32 private constant RUNTIME_BINDING_TYPEHASH = keccak256(
        "ProgrammableExactHookemonPostconditionVerifierBindingV1(uint256 chainId,address verifier,bytes20 sourceCommit,bytes20 sourceTree,bytes32 expectedStateHead,bytes32 moduleHead)"
    );

    bytes32 private immutable EXPECTED_LAUNCHER_RUNTIME_CODE_HASH;
    bytes32 private immutable EXPECTED_ARCHITECTURE_STATE_HASH;
    bytes32 private immutable EXPECTED_POOL_STATE_HASH;
    bytes32 private immutable EXPECTED_REVENUE_STATE_HASH;
    bytes32 private immutable EXPECTED_TOKEN_NAME_HASH;
    bytes32 private immutable EXPECTED_TOKEN_SYMBOL_HASH;
    ProgrammableExactHookemonArchitectureVerifierModuleV1 private immutable ARCHITECTURE_MODULE;
    bytes32 private immutable ARCHITECTURE_MODULE_RUNTIME_CODE_HASH;
    bytes32 private immutable ARCHITECTURE_MODULE_BINDING_HASH;
    ProgrammableExactHookemonEconomicVerifierModuleV1 private immutable ECONOMIC_MODULE;
    bytes32 private immutable ECONOMIC_MODULE_RUNTIME_CODE_HASH;
    bytes32 private immutable ECONOMIC_MODULE_BINDING_HASH;

    error InvalidState(uint256 field);

    function tokenIdentityConstraintsHashV1() external pure returns (bytes32 constraintsHash) {
        return ProgrammableTokenIdentityPolicyV1.constraintsHash();
    }

    function validateTokenIdentityV1(string calldata tokenName, string calldata tokenSymbol)
        external
        pure
        returns (bytes32 tokenNameHash, bytes32 tokenSymbolHash)
    {
        (tokenNameHash, tokenSymbolHash) = ProgrammableTokenIdentityPolicyV1.validate(tokenName, tokenSymbol);
    }

    constructor(
        bytes32 expectedLauncherRuntimeCodeHash,
        bytes32 expectedArchitectureStateHash,
        bytes32 expectedPoolStateHash,
        bytes32 expectedRevenueStateHash,
        bytes32 expectedTokenNameHash,
        bytes32 expectedTokenSymbolHash
    ) {
        if (
            expectedLauncherRuntimeCodeHash == bytes32(0) || expectedArchitectureStateHash == bytes32(0)
                || expectedPoolStateHash == bytes32(0) || expectedRevenueStateHash == bytes32(0)
                || expectedTokenNameHash == bytes32(0) || expectedTokenSymbolHash == bytes32(0)
        ) revert InvalidState(1);
        EXPECTED_LAUNCHER_RUNTIME_CODE_HASH = expectedLauncherRuntimeCodeHash;
        EXPECTED_ARCHITECTURE_STATE_HASH = expectedArchitectureStateHash;
        EXPECTED_POOL_STATE_HASH = expectedPoolStateHash;
        EXPECTED_REVENUE_STATE_HASH = expectedRevenueStateHash;
        EXPECTED_TOKEN_NAME_HASH = expectedTokenNameHash;
        EXPECTED_TOKEN_SYMBOL_HASH = expectedTokenSymbolHash;

        ProgrammableExactHookemonArchitectureVerifierModuleV1 architectureModule =
            new ProgrammableExactHookemonArchitectureVerifierModuleV1(expectedTokenNameHash, expectedTokenSymbolHash);
        ProgrammableExactHookemonEconomicVerifierModuleV1 economicModule =
            new ProgrammableExactHookemonEconomicVerifierModuleV1();
        ARCHITECTURE_MODULE = architectureModule;
        ARCHITECTURE_MODULE_RUNTIME_CODE_HASH = address(architectureModule).codehash;
        ARCHITECTURE_MODULE_BINDING_HASH = architectureModule.runtimeBindingHashV1();
        ECONOMIC_MODULE = economicModule;
        ECONOMIC_MODULE_RUNTIME_CODE_HASH = address(economicModule).codehash;
        ECONOMIC_MODULE_BINDING_HASH = economicModule.runtimeBindingHashV1();
    }

    function expectedLauncherRuntimeCodeHashV1() external view returns (bytes32) {
        return EXPECTED_LAUNCHER_RUNTIME_CODE_HASH;
    }

    function expectedArchitectureStateHashV1() external view returns (bytes32) {
        return EXPECTED_ARCHITECTURE_STATE_HASH;
    }

    function expectedPoolStateHashV1() external view returns (bytes32) {
        return EXPECTED_POOL_STATE_HASH;
    }

    function expectedRevenueStateHashV1() external view returns (bytes32) {
        return EXPECTED_REVENUE_STATE_HASH;
    }

    function expectedTokenNameHashV1() external view returns (bytes32) {
        return EXPECTED_TOKEN_NAME_HASH;
    }

    function expectedTokenSymbolHashV1() external view returns (bytes32) {
        return EXPECTED_TOKEN_SYMBOL_HASH;
    }

    function verifierModulesV1()
        external
        view
        returns (
            address architectureModule,
            bytes32 architectureModuleRuntimeCodeHash,
            bytes32 architectureModuleBindingHash,
            address economicModule,
            bytes32 economicModuleRuntimeCodeHash,
            bytes32 economicModuleBindingHash
        )
    {
        return (
            address(ARCHITECTURE_MODULE),
            ARCHITECTURE_MODULE_RUNTIME_CODE_HASH,
            ARCHITECTURE_MODULE_BINDING_HASH,
            address(ECONOMIC_MODULE),
            ECONOMIC_MODULE_RUNTIME_CODE_HASH,
            ECONOMIC_MODULE_BINDING_HASH
        );
    }

    function runtimeBindingHashV1() external view returns (bytes32) {
        bytes32 expectedStateHead = keccak256(
            abi.encode(
                EXPECTED_LAUNCHER_RUNTIME_CODE_HASH,
                EXPECTED_ARCHITECTURE_STATE_HASH,
                EXPECTED_POOL_STATE_HASH,
                EXPECTED_REVENUE_STATE_HASH,
                EXPECTED_TOKEN_NAME_HASH,
                EXPECTED_TOKEN_SYMBOL_HASH
            )
        );
        bytes32 moduleHead = keccak256(
            abi.encode(
                address(ARCHITECTURE_MODULE),
                ARCHITECTURE_MODULE_RUNTIME_CODE_HASH,
                ARCHITECTURE_MODULE_BINDING_HASH,
                address(ECONOMIC_MODULE),
                ECONOMIC_MODULE_RUNTIME_CODE_HASH,
                ECONOMIC_MODULE_BINDING_HASH
            )
        );
        return keccak256(
            abi.encode(
                RUNTIME_BINDING_TYPEHASH,
                block.chainid,
                address(this),
                SOURCE_COMMIT_ID,
                SOURCE_TREE_ID,
                expectedStateHead,
                moduleHead
            )
        );
    }

    function verifyExactHookemonPostconditionsV1(address launcher)
        external
        view
        returns (bytes32 architectureStateHash, bytes32 poolStateHash, bytes32 revenueStateHash)
    {
        if (
            launcher == address(0) || launcher.code.length == 0
                || launcher.codehash != EXPECTED_LAUNCHER_RUNTIME_CODE_HASH
                || address(ARCHITECTURE_MODULE).codehash != ARCHITECTURE_MODULE_RUNTIME_CODE_HASH
                || address(ECONOMIC_MODULE).codehash != ECONOMIC_MODULE_RUNTIME_CODE_HASH
        ) revert InvalidState(2);
        architectureStateHash = ARCHITECTURE_MODULE.verifyArchitectureStateV1(launcher);
        if (architectureStateHash != EXPECTED_ARCHITECTURE_STATE_HASH) revert InvalidState(3);
        (poolStateHash, revenueStateHash) = ECONOMIC_MODULE.verifyEconomicStateV1(launcher);
        if (poolStateHash != EXPECTED_POOL_STATE_HASH) revert InvalidState(4);
        if (revenueStateHash != EXPECTED_REVENUE_STATE_HASH) revert InvalidState(5);
    }
}

/// @notice Reusable dynamic postcondition verifier for exact configurable-identity Hookemon launches.
/// @dev Every expected value is typed and committed in the route plan. The fixed verifier only observes the deployed
///      graph and returns its exact state hashes; the reusable profile compares them with the permit-bound plan.
contract ProgrammableExactHookemonPostconditionVerifierV2 is IProgrammableRuntimeBindingV1 {
    bytes20 private constant SOURCE_COMMIT_ID = bytes20(hex"55fd47cec3ed8e61e59d5a919d98aeec2e269549");
    bytes20 private constant SOURCE_TREE_ID = bytes20(hex"2667ff1bee70dd082596d5f65b3ed4cb2c1ce387");
    bytes32 private constant RUNTIME_BINDING_TYPEHASH = keccak256(
        "ProgrammableExactHookemonPostconditionVerifierBindingV2(uint256 chainId,address verifier,bytes20 sourceCommit,bytes20 sourceTree,bytes32 moduleHead)"
    );

    ProgrammableExactHookemonArchitectureVerifierModuleV2 private immutable ARCHITECTURE_MODULE;
    bytes32 private immutable ARCHITECTURE_MODULE_RUNTIME_CODE_HASH;
    bytes32 private immutable ARCHITECTURE_MODULE_BINDING_HASH;
    ProgrammableExactHookemonEconomicVerifierModuleV1 private immutable ECONOMIC_MODULE;
    bytes32 private immutable ECONOMIC_MODULE_RUNTIME_CODE_HASH;
    bytes32 private immutable ECONOMIC_MODULE_BINDING_HASH;

    error InvalidState(uint256 field);

    constructor() {
        ProgrammableExactHookemonArchitectureVerifierModuleV2 architectureModule =
            new ProgrammableExactHookemonArchitectureVerifierModuleV2();
        ProgrammableExactHookemonEconomicVerifierModuleV1 economicModule =
            new ProgrammableExactHookemonEconomicVerifierModuleV1();
        ARCHITECTURE_MODULE = architectureModule;
        ARCHITECTURE_MODULE_RUNTIME_CODE_HASH = address(architectureModule).codehash;
        ARCHITECTURE_MODULE_BINDING_HASH = architectureModule.runtimeBindingHashV1();
        ECONOMIC_MODULE = economicModule;
        ECONOMIC_MODULE_RUNTIME_CODE_HASH = address(economicModule).codehash;
        ECONOMIC_MODULE_BINDING_HASH = economicModule.runtimeBindingHashV1();
    }

    function tokenIdentityConstraintsHashV1() external pure returns (bytes32 constraintsHash) {
        return ProgrammableTokenIdentityPolicyV1.constraintsHash();
    }

    function validateTokenIdentityV1(string calldata tokenName, string calldata tokenSymbol)
        external
        pure
        returns (bytes32 tokenNameHash, bytes32 tokenSymbolHash)
    {
        (tokenNameHash, tokenSymbolHash) = ProgrammableTokenIdentityPolicyV1.validate(tokenName, tokenSymbol);
    }

    function verifierModulesV2()
        external
        view
        returns (
            address architectureModule,
            bytes32 architectureModuleRuntimeCodeHash,
            bytes32 architectureModuleBindingHash,
            address economicModule,
            bytes32 economicModuleRuntimeCodeHash,
            bytes32 economicModuleBindingHash
        )
    {
        return (
            address(ARCHITECTURE_MODULE),
            ARCHITECTURE_MODULE_RUNTIME_CODE_HASH,
            ARCHITECTURE_MODULE_BINDING_HASH,
            address(ECONOMIC_MODULE),
            ECONOMIC_MODULE_RUNTIME_CODE_HASH,
            ECONOMIC_MODULE_BINDING_HASH
        );
    }

    function runtimeBindingHashV1() external view returns (bytes32) {
        bytes32 moduleHead = keccak256(
            abi.encode(
                address(ARCHITECTURE_MODULE),
                ARCHITECTURE_MODULE_RUNTIME_CODE_HASH,
                ARCHITECTURE_MODULE_BINDING_HASH,
                address(ECONOMIC_MODULE),
                ECONOMIC_MODULE_RUNTIME_CODE_HASH,
                ECONOMIC_MODULE_BINDING_HASH
            )
        );
        return keccak256(
            abi.encode(
                RUNTIME_BINDING_TYPEHASH, block.chainid, address(this), SOURCE_COMMIT_ID, SOURCE_TREE_ID, moduleHead
            )
        );
    }

    function verifyExactHookemonPostconditionsV2(
        address launcher,
        bytes32 expectedLauncherRuntimeCodeHash,
        bytes32 expectedTokenNameHash,
        bytes32 expectedTokenSymbolHash
    ) external view returns (bytes32 architectureStateHash, bytes32 poolStateHash, bytes32 revenueStateHash) {
        if (
            launcher == address(0) || launcher.code.length == 0 || expectedLauncherRuntimeCodeHash == bytes32(0)
                || launcher.codehash != expectedLauncherRuntimeCodeHash || expectedTokenNameHash == bytes32(0)
                || expectedTokenSymbolHash == bytes32(0)
                || address(ARCHITECTURE_MODULE).codehash != ARCHITECTURE_MODULE_RUNTIME_CODE_HASH
                || address(ECONOMIC_MODULE).codehash != ECONOMIC_MODULE_RUNTIME_CODE_HASH
        ) revert InvalidState(1);
        architectureStateHash =
            ARCHITECTURE_MODULE.verifyArchitectureStateV2(launcher, expectedTokenNameHash, expectedTokenSymbolHash);
        (poolStateHash, revenueStateHash) = ECONOMIC_MODULE.verifyEconomicStateV1(launcher);
    }
}
