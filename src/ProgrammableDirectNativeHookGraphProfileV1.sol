// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";

/// @title ProgrammableDirectNativeHookGraphProfileV1
/// @notice Pure codec and fail-closed shape checks for `programmable.direct-native-hook-graph.v1` review artifacts.
/// @dev This helper is not an authorization oracle and is not an onchain dependency of Router V1. The existing
///      immutable permit authority admits an exact reviewed source/build/runtime set. Router V1 then binds the
///      returned topology hash, the GraphDeployer commitment, every expected runtime hash, and the final calldata.
///      A hook's self-reported configuration is deliberately insufficient for admission.
contract ProgrammableDirectNativeHookGraphProfileV1 {
    enum TargetRoleV1 {
        Invalid,
        Token,
        Hook,
        Initializer,
        Other
    }

    struct TargetBindingV1 {
        uint8 targetIndex;
        TargetRoleV1 role;
        bytes32 targetIdHash;
        address expectedAddress;
        bytes32 sourceArtifactHash;
        bytes32 compilerBuildHash;
        bytes32 initCodeHash;
        bytes32 initializerAbiHash;
        bytes32 runtimeCodeHash;
    }

    struct ReviewAdmissionV1 {
        bytes32 sourceRepositoryHash;
        bytes32 sourceCommitHash;
        bytes32 sourceTreeHash;
        bytes32 compilerInputHash;
        bytes32 compilerOutputHash;
        bytes32 targetManifestHash;
        bytes32 hookCreationCodeHash;
        bytes32 hookRuntimeCodeHash;
        bytes32 initializerCreationCodeHash;
        bytes32 initializerRuntimeCodeHash;
        bytes32 feeConformanceEvidenceHash;
        bytes32 securityReviewHash;
    }

    struct MarketBindingV1 {
        address currency0;
        address currency1;
        uint24 lpFeePips;
        int24 tickSpacing;
        address token;
        address hook;
        address quoteCurrency;
        uint160 hookPermissions;
    }

    struct FeePolicyV1 {
        uint256 chainId;
        address poolManager;
        bytes32 poolManagerRuntimeCodeHash;
        bytes32 poolKeyHash;
        address quoteCurrency;
        address hook;
        bytes32 hookRuntimeCodeHash;
        uint160 hookPermissions;
        address projectFeeOwner;
        uint32 selectedBuyHundredthsOfBip;
        uint32 selectedSellHundredthsOfBip;
        bytes32 reviewAdmissionHash;
    }

    struct FeePolicyCommitmentV1 {
        uint256 chainId;
        address poolManager;
        bytes32 poolManagerRuntimeCodeHash;
        bytes32 poolKeyHash;
        address quoteCurrency;
        address hook;
        bytes32 hookRuntimeCodeHash;
        uint160 hookPermissions;
        address projectFeeOwner;
        uint32 selectedBuyHundredthsOfBip;
        uint32 selectedSellHundredthsOfBip;
        address programmableFeeOwner;
        uint32 programmableHundredthsOfBip;
        uint32 minimumEffectiveHundredthsOfBip;
        uint256 rateDenominator;
        bytes32 accountingModeHash;
        bytes32 programmableFeePolicyHash;
        bytes32 collectionProfileHash;
        bytes32 reviewAdmissionHash;
    }

    /// @dev This is the pre-graph topology binding. It intentionally excludes `graphCommitment`: GraphDeployer's
    ///      graph commitment already includes `topologyHash`, so including it here would create a fixed-point cycle.
    struct TopologyBindingV1 {
        uint256 chainId;
        address router;
        address graphFactory;
        address authorizedLauncher;
        bytes32 routeNamespace;
        bytes32 routeNonce;
        uint8 targetCount;
        uint8 tokenTargetIndex;
        uint8 hookTargetIndex;
        uint8 initializerTargetIndex;
        address token;
        address hook;
        address initializer;
        bytes32 initializerTargetIdHash;
        bytes32 poolKeyHash;
        uint160 hookPermissions;
        bytes32 targetManifestHash;
        bytes32 reviewAdmissionHash;
        bytes32 feePolicyHash;
        bytes32 fundingIntentHash;
        bytes32 topologyEdgesHash;
    }

    /// @dev EIP-3009 signatures and the final graph commitment are intentionally absent. `nonce` is the hash of this
    ///      fixed pre-signature intent. The final GraphDeployer commitment subsequently binds the exact v/r/s bytes
    ///      inside the fully ABI-encoded initializer calldata.
    struct FundingIntentV1 {
        uint256 chainId;
        address token;
        address router;
        address graphFactory;
        bytes32 routeNamespace;
        bytes32 routeNonce;
        bytes32 launchIntentCommitment;
        address from;
        address to;
        uint256 value;
        uint256 validAfter;
        uint256 validBefore;
    }

    uint256 public constant MIN_TARGETS = 3;
    uint256 public constant MAX_TARGETS = 16;
    uint256 public constant RATE_DENOMINATOR = 1_000_000;
    uint32 public constant PROGRAMMABLE_HUNDREDTHS_OF_BIP = 1000;
    uint32 public constant MINIMUM_EFFECTIVE_HUNDREDTHS_OF_BIP = 1000;
    uint32 public constant MAX_SELECTED_HUNDREDTHS_OF_BIP = 999_999;
    address public constant PROGRAMMABLE_FEE_OWNER = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;

    uint160 public constant ALL_HOOK_MASK = uint160((1 << 14) - 1);
    uint160 public constant BEFORE_ADD_LIQUIDITY_FLAG = 1 << 11;
    uint160 public constant AFTER_ADD_LIQUIDITY_FLAG = 1 << 10;
    uint160 public constant BEFORE_REMOVE_LIQUIDITY_FLAG = 1 << 9;
    uint160 public constant AFTER_REMOVE_LIQUIDITY_FLAG = 1 << 8;
    uint160 public constant BEFORE_SWAP_FLAG = 1 << 7;
    uint160 public constant AFTER_SWAP_FLAG = 1 << 6;
    uint160 public constant BEFORE_SWAP_RETURNS_DELTA_FLAG = 1 << 3;
    uint160 public constant AFTER_SWAP_RETURNS_DELTA_FLAG = 1 << 2;
    uint160 public constant AFTER_ADD_LIQUIDITY_RETURNS_DELTA_FLAG = 1 << 1;
    uint160 public constant AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA_FLAG = 1;

    bytes32 public constant PROFILE_ID_HASH = keccak256("programmable.direct-native-hook-graph.v1");
    bytes32 public constant PROFILE_VERSION_HASH = keccak256("1.0.0");
    bytes32 public constant PROGRAMMABLE_FEE_POLICY_HASH = keccak256("programmable-volume-fee-v2@2.0.0");
    bytes32 public constant COLLECTION_PROFILE_HASH = keccak256("standard-amm");
    bytes32 public constant ACCOUNTING_MODE_HASH = keccak256("inclusive-selected-total-executed-gross-quote");
    bytes32 public constant FUNDING_INTENT_DOMAIN_HASH =
        keccak256("programmable.direct-native-hook-graph.funding-intent.v1");
    bytes32 public constant FUNDING_NONCE_DOMAIN_HASH =
        keccak256("programmable.direct-native-hook-graph.funding-nonce.v1");

    bytes32 public constant POOL_KEY_TYPEHASH = keccak256(
        "ProgrammablePoolKeyV1(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)"
    );
    bytes32 public constant TARGET_BINDING_TYPEHASH = keccak256(
        "ProgrammableDirectNativeHookTargetBindingV1(uint8 targetIndex,uint8 role,bytes32 targetIdHash,address expectedAddress,bytes32 sourceArtifactHash,bytes32 compilerBuildHash,bytes32 initCodeHash,bytes32 initializerAbiHash,bytes32 runtimeCodeHash)"
    );
    bytes32 public constant TARGET_MANIFEST_TYPEHASH =
        keccak256("ProgrammableDirectNativeHookTargetManifestV1(bytes32 targetBindingsHash)");
    bytes32 public constant REVIEW_ADMISSION_TYPEHASH = keccak256(
        "ProgrammableDirectNativeHookReviewAdmissionV1(bytes32 sourceRepositoryHash,bytes32 sourceCommitHash,bytes32 sourceTreeHash,bytes32 compilerInputHash,bytes32 compilerOutputHash,bytes32 targetManifestHash,bytes32 hookCreationCodeHash,bytes32 hookRuntimeCodeHash,bytes32 initializerCreationCodeHash,bytes32 initializerRuntimeCodeHash,bytes32 feeConformanceEvidenceHash,bytes32 securityReviewHash)"
    );
    bytes32 public constant FEE_POLICY_TYPEHASH = keccak256(
        "ProgrammableDirectNativeHookFeePolicyV1(uint256 chainId,address poolManager,bytes32 poolManagerRuntimeCodeHash,bytes32 poolKeyHash,address quoteCurrency,address hook,bytes32 hookRuntimeCodeHash,uint160 hookPermissions,address projectFeeOwner,uint32 selectedBuyHundredthsOfBip,uint32 selectedSellHundredthsOfBip,address programmableFeeOwner,uint32 programmableHundredthsOfBip,uint32 minimumEffectiveHundredthsOfBip,uint256 rateDenominator,bytes32 accountingModeHash,bytes32 programmableFeePolicyHash,bytes32 collectionProfileHash,bytes32 reviewAdmissionHash)"
    );
    bytes32 public constant TOPOLOGY_BINDING_TYPEHASH = keccak256(
        "ProgrammableDirectNativeHookTopologyBindingV1(uint256 chainId,address router,address graphFactory,address authorizedLauncher,bytes32 routeNamespace,bytes32 routeNonce,uint8 targetCount,uint8 tokenTargetIndex,uint8 hookTargetIndex,uint8 initializerTargetIndex,address token,address hook,address initializer,bytes32 initializerTargetIdHash,bytes32 poolKeyHash,uint160 hookPermissions,bytes32 targetManifestHash,bytes32 reviewAdmissionHash,bytes32 feePolicyHash,bytes32 fundingIntentHash,bytes32 topologyEdgesHash)"
    );

    error InvalidBinding(uint8 field);
    error InvalidFundingIntent(uint256 index);
    error InvalidHookPermissions(uint160 permissions);
    error InvalidSignaturePatch(uint8 field);
    error InvalidTarget(uint256 index);

    function computeTargetManifestHash(TargetBindingV1[] calldata targets) external pure returns (bytes32) {
        uint256 length = targets.length;
        if (length < MIN_TARGETS || length > MAX_TARGETS) revert InvalidBinding(1);
        bytes32[] memory leaves = new bytes32[](length);
        bool tokenFound;
        bool hookFound;
        bool initializerFound;
        for (uint256 i; i < length; ++i) {
            TargetBindingV1 calldata target = targets[i];
            if (
                target.targetIndex != i || target.role == TargetRoleV1.Invalid || target.targetIdHash == bytes32(0)
                    || target.expectedAddress == address(0) || target.sourceArtifactHash == bytes32(0)
                    || target.compilerBuildHash == bytes32(0) || target.initCodeHash == bytes32(0)
                    || target.initializerAbiHash == bytes32(0) || target.runtimeCodeHash == bytes32(0)
            ) revert InvalidTarget(i);
            for (uint256 prior; prior < i; ++prior) {
                if (
                    targets[prior].targetIdHash == target.targetIdHash
                        || targets[prior].expectedAddress == target.expectedAddress
                ) revert InvalidTarget(i);
            }
            if (target.role == TargetRoleV1.Token) {
                if (tokenFound) revert InvalidTarget(i);
                tokenFound = true;
            } else if (target.role == TargetRoleV1.Hook) {
                if (hookFound) revert InvalidTarget(i);
                hookFound = true;
            } else if (target.role == TargetRoleV1.Initializer) {
                if (initializerFound) revert InvalidTarget(i);
                initializerFound = true;
            }
            leaves[i] = keccak256(
                abi.encode(
                    TARGET_BINDING_TYPEHASH,
                    target.targetIndex,
                    uint8(target.role),
                    target.targetIdHash,
                    target.expectedAddress,
                    target.sourceArtifactHash,
                    target.compilerBuildHash,
                    target.initCodeHash,
                    target.initializerAbiHash,
                    target.runtimeCodeHash
                )
            );
        }
        if (!tokenFound || !hookFound || !initializerFound) revert InvalidBinding(2);
        return keccak256(abi.encode(TARGET_MANIFEST_TYPEHASH, keccak256(abi.encodePacked(leaves))));
    }

    function computeReviewAdmissionHash(ReviewAdmissionV1 calldata review) external pure returns (bytes32) {
        if (
            review.sourceRepositoryHash == bytes32(0) || review.sourceCommitHash == bytes32(0)
                || review.sourceTreeHash == bytes32(0) || review.compilerInputHash == bytes32(0)
                || review.compilerOutputHash == bytes32(0) || review.targetManifestHash == bytes32(0)
                || review.hookCreationCodeHash == bytes32(0) || review.hookRuntimeCodeHash == bytes32(0)
                || review.initializerCreationCodeHash == bytes32(0) || review.initializerRuntimeCodeHash == bytes32(0)
                || review.feeConformanceEvidenceHash == bytes32(0) || review.securityReviewHash == bytes32(0)
        ) revert InvalidBinding(3);
        return keccak256(
            abi.encode(
                REVIEW_ADMISSION_TYPEHASH,
                review.sourceRepositoryHash,
                review.sourceCommitHash,
                review.sourceTreeHash,
                review.compilerInputHash,
                review.compilerOutputHash,
                review.targetManifestHash,
                review.hookCreationCodeHash,
                review.hookRuntimeCodeHash,
                review.initializerCreationCodeHash,
                review.initializerRuntimeCodeHash,
                review.feeConformanceEvidenceHash,
                review.securityReviewHash
            )
        );
    }

    function computePoolKeyHash(MarketBindingV1 calldata market) external pure returns (bytes32) {
        _validateMarket(market);
        return keccak256(
            abi.encode(
                POOL_KEY_TYPEHASH, market.currency0, market.currency1, market.lpFeePips, market.tickSpacing, market.hook
            )
        );
    }

    function computeFeePolicyHash(FeePolicyV1 calldata policy) external pure returns (bytes32) {
        if (
            policy.chainId == 0 || policy.poolManager == address(0) || policy.poolManagerRuntimeCodeHash == bytes32(0)
                || policy.poolKeyHash == bytes32(0) || policy.hook == address(0)
                || policy.hookRuntimeCodeHash == bytes32(0) || policy.projectFeeOwner == address(0)
                || policy.projectFeeOwner == PROGRAMMABLE_FEE_OWNER
                || policy.selectedBuyHundredthsOfBip > MAX_SELECTED_HUNDREDTHS_OF_BIP
                || policy.selectedSellHundredthsOfBip > MAX_SELECTED_HUNDREDTHS_OF_BIP
                || policy.reviewAdmissionHash == bytes32(0)
        ) revert InvalidBinding(4);
        _validateHookPermissions(policy.hook, policy.hookPermissions);
        FeePolicyCommitmentV1 memory commitment;
        commitment.chainId = policy.chainId;
        commitment.poolManager = policy.poolManager;
        commitment.poolManagerRuntimeCodeHash = policy.poolManagerRuntimeCodeHash;
        commitment.poolKeyHash = policy.poolKeyHash;
        commitment.quoteCurrency = policy.quoteCurrency;
        commitment.hook = policy.hook;
        commitment.hookRuntimeCodeHash = policy.hookRuntimeCodeHash;
        commitment.hookPermissions = policy.hookPermissions;
        commitment.projectFeeOwner = policy.projectFeeOwner;
        commitment.selectedBuyHundredthsOfBip = policy.selectedBuyHundredthsOfBip;
        commitment.selectedSellHundredthsOfBip = policy.selectedSellHundredthsOfBip;
        commitment.programmableFeeOwner = PROGRAMMABLE_FEE_OWNER;
        commitment.programmableHundredthsOfBip = PROGRAMMABLE_HUNDREDTHS_OF_BIP;
        commitment.minimumEffectiveHundredthsOfBip = MINIMUM_EFFECTIVE_HUNDREDTHS_OF_BIP;
        commitment.rateDenominator = RATE_DENOMINATOR;
        commitment.accountingModeHash = ACCOUNTING_MODE_HASH;
        commitment.programmableFeePolicyHash = PROGRAMMABLE_FEE_POLICY_HASH;
        commitment.collectionProfileHash = COLLECTION_PROFILE_HASH;
        commitment.reviewAdmissionHash = policy.reviewAdmissionHash;
        return keccak256(abi.encode(FEE_POLICY_TYPEHASH, commitment));
    }

    function computeTopologyHash(TopologyBindingV1 calldata topology) external pure returns (bytes32) {
        if (
            topology.chainId == 0 || topology.router == address(0) || topology.graphFactory == address(0)
                || topology.authorizedLauncher != topology.router || topology.routeNamespace == bytes32(0)
                || topology.routeNonce == bytes32(0) || topology.targetCount < MIN_TARGETS
                || topology.targetCount > MAX_TARGETS || topology.tokenTargetIndex >= topology.targetCount
                || topology.hookTargetIndex >= topology.targetCount
                || topology.initializerTargetIndex >= topology.targetCount
                || topology.tokenTargetIndex == topology.hookTargetIndex
                || topology.tokenTargetIndex == topology.initializerTargetIndex
                || topology.hookTargetIndex == topology.initializerTargetIndex || topology.token == address(0)
                || topology.hook == address(0) || topology.initializer == address(0)
                || topology.initializerTargetIdHash == bytes32(0) || topology.token == topology.hook
                || topology.token == topology.initializer || topology.hook == topology.initializer
                || topology.poolKeyHash == bytes32(0) || topology.targetManifestHash == bytes32(0)
                || topology.reviewAdmissionHash == bytes32(0) || topology.feePolicyHash == bytes32(0)
                || topology.fundingIntentHash == bytes32(0) || topology.topologyEdgesHash == bytes32(0)
        ) revert InvalidBinding(5);
        _validateHookPermissions(topology.hook, topology.hookPermissions);
        // The tuple is fully static, so encoding it as one tuple is byte-identical to listing every field after the
        // typehash while avoiding an otherwise unnecessary compiler stack-depth dependency.
        return keccak256(abi.encode(TOPOLOGY_BINDING_TYPEHASH, topology));
    }

    function computeFundingIntentHash(FundingIntentV1 calldata intent) public pure returns (bytes32) {
        _validateFundingIntent(intent);
        return keccak256(
            abi.encode(
                FUNDING_INTENT_DOMAIN_HASH,
                intent.chainId,
                intent.token,
                intent.router,
                intent.graphFactory,
                intent.routeNamespace,
                intent.routeNonce,
                intent.launchIntentCommitment,
                intent.from,
                intent.to,
                intent.value,
                intent.validAfter,
                intent.validBefore
            )
        );
    }

    function computeFundingNonce(bytes32 fundingIntentHash) external pure returns (bytes32) {
        if (fundingIntentHash == bytes32(0)) revert InvalidBinding(6);
        return keccak256(abi.encode(FUNDING_NONCE_DOMAIN_HASH, fundingIntentHash));
    }

    /// @notice Validates only the static ABI-word geometry and unsigned zero slots of the public signature patch.
    /// @dev Offchain admission must additionally resolve the exact target/function against the reviewed compiler ABI,
    ///      bind this template in launchIntent, patch bytes32 r/s and the final byte of the uint8 v word, and prove the
    ///      result equals a complete ABI encoding. Offsets count from calldata byte zero, including the selector.
    function validateFundingSignaturePatchTemplate(
        bytes calldata unsignedInitializerCalldata,
        uint256 rOffsetBytes,
        uint256 sOffsetBytes,
        uint256 vOffsetBytes
    ) external pure returns (bytes32 unsignedCalldataSha256) {
        uint256 length = unsignedInitializerCalldata.length;
        if (length < 100) revert InvalidSignaturePatch(1);
        if (rOffsetBytes == sOffsetBytes || rOffsetBytes == vOffsetBytes || sOffsetBytes == vOffsetBytes) {
            revert InvalidSignaturePatch(2);
        }
        _validateZeroAbiWord(unsignedInitializerCalldata, rOffsetBytes, length);
        _validateZeroAbiWord(unsignedInitializerCalldata, sOffsetBytes, length);
        _validateZeroAbiWord(unsignedInitializerCalldata, vOffsetBytes, length);
        return sha256(unsignedInitializerCalldata);
    }

    function feeSplit(uint32 selectedHundredthsOfBip)
        external
        pure
        returns (
            uint32 effectiveTotalHundredthsOfBip,
            uint32 projectHundredthsOfBip,
            uint32 programmableHundredthsOfBip
        )
    {
        if (selectedHundredthsOfBip > MAX_SELECTED_HUNDREDTHS_OF_BIP) {
            revert InvalidBinding(7);
        }
        effectiveTotalHundredthsOfBip = selectedHundredthsOfBip < MINIMUM_EFFECTIVE_HUNDREDTHS_OF_BIP
            ? MINIMUM_EFFECTIVE_HUNDREDTHS_OF_BIP
            : selectedHundredthsOfBip;
        programmableHundredthsOfBip = PROGRAMMABLE_HUNDREDTHS_OF_BIP;
        projectHundredthsOfBip = effectiveTotalHundredthsOfBip - programmableHundredthsOfBip;
    }

    function validateHookPermissions(address hook, uint160 permissions) external pure {
        _validateHookPermissions(hook, permissions);
    }

    function _validateMarket(MarketBindingV1 calldata market) private pure {
        if (
            market.currency0 >= market.currency1 || market.token == address(0) || market.hook == address(0)
                || market.token == market.hook || (market.token != market.currency0 && market.token != market.currency1)
                || (market.quoteCurrency != market.currency0 && market.quoteCurrency != market.currency1)
                || market.lpFeePips > MAX_SELECTED_HUNDREDTHS_OF_BIP || market.tickSpacing < TickMath.MIN_TICK_SPACING
                || market.tickSpacing > TickMath.MAX_TICK_SPACING
        ) revert InvalidBinding(8);
        _validateHookPermissions(market.hook, market.hookPermissions);
    }

    function _validateHookPermissions(address hook, uint160 permissions) private pure {
        if (permissions == 0 || permissions > ALL_HOOK_MASK || (uint160(hook) & ALL_HOOK_MASK) != permissions) {
            revert InvalidHookPermissions(permissions);
        }
        if (
            _requires(permissions, BEFORE_SWAP_RETURNS_DELTA_FLAG, BEFORE_SWAP_FLAG)
                || _requires(permissions, AFTER_SWAP_RETURNS_DELTA_FLAG, AFTER_SWAP_FLAG)
                || _requires(permissions, AFTER_ADD_LIQUIDITY_RETURNS_DELTA_FLAG, AFTER_ADD_LIQUIDITY_FLAG)
                || _requires(permissions, AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA_FLAG, AFTER_REMOVE_LIQUIDITY_FLAG)
        ) revert InvalidHookPermissions(permissions);
        bool beforeFeePath = permissions & (BEFORE_SWAP_FLAG | BEFORE_SWAP_RETURNS_DELTA_FLAG)
            == (BEFORE_SWAP_FLAG | BEFORE_SWAP_RETURNS_DELTA_FLAG);
        bool afterFeePath = permissions & (AFTER_SWAP_FLAG | AFTER_SWAP_RETURNS_DELTA_FLAG)
            == (AFTER_SWAP_FLAG | AFTER_SWAP_RETURNS_DELTA_FLAG);
        if (!beforeFeePath && !afterFeePath) revert InvalidHookPermissions(permissions);
    }

    function _validateFundingIntent(FundingIntentV1 calldata intent) private pure {
        if (
            intent.chainId == 0 || intent.token == address(0) || intent.router == address(0)
                || intent.graphFactory == address(0) || intent.routeNamespace == bytes32(0)
                || intent.routeNonce == bytes32(0) || intent.launchIntentCommitment == bytes32(0)
                || intent.from == address(0) || intent.to == address(0) || intent.value == 0
                || intent.validBefore <= intent.validAfter
        ) revert InvalidFundingIntent(0);
    }

    function _requires(uint160 permissions, uint160 dependent, uint160 prerequisite) private pure returns (bool) {
        return permissions & dependent != 0 && permissions & prerequisite == 0;
    }

    function _validateZeroAbiWord(bytes calldata data, uint256 offset, uint256 length) private pure {
        if (offset < 4 || (offset - 4) % 32 != 0 || offset > length - 32) revert InvalidSignaturePatch(3);
        for (uint256 i; i < 32; ++i) {
            if (data[offset + i] != bytes1(0)) revert InvalidSignaturePatch(4);
        }
    }
}
