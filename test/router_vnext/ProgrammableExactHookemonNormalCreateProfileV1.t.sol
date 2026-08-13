// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { IProgrammableUniversalLaunchKernelV1 } from "../../src/router_vnext/IProgrammableUniversalLaunchKernelV1.sol";
import { ProgrammableUniversalLaunchKernelV1 } from "../../src/router_vnext/ProgrammableUniversalLaunchKernelV1.sol";
import {
    ProgrammableUniversalLaunchPreflightV1
} from "../../src/router_vnext/ProgrammableUniversalLaunchPreflightV1.sol";
import {
    IProgrammableExactHookemonNormalCreateProfileV1
} from "../../src/router_vnext/IProgrammableExactHookemonNormalCreateProfileV1.sol";
import {
    IProgrammableGithubRepositoryLineageRegistryV1
} from "../../src/router_vnext/IProgrammableGithubRepositoryLineageRegistryV1.sol";
import {
    ProgrammableExactHookemonLauncherCodeStoreV1
} from "../../src/router_vnext/ProgrammableExactHookemonLauncherCodeStoreV1.sol";
import {
    ProgrammableExactHookemonNormalCreateProfileBaseV1,
    ProgrammableExactHookemonNormalCreateProfileV1
} from "../../src/router_vnext/ProgrammableExactHookemonNormalCreateProfileV1.sol";
import {
    IExactHookemonAtomicLauncherViewV1,
    ProgrammableExactHookemonPostconditionVerifierV1,
    ProgrammableExactHookemonPostconditionVerifierV2
} from "../../src/router_vnext/ProgrammableExactHookemonPostconditionVerifierV1.sol";

contract HookemonNormalCreateProfileHarnessV1 is ProgrammableExactHookemonNormalCreateProfileBaseV1 {
    constructor(
        DeploymentConfigV1 memory deployment,
        bytes32 expectedLauncherCreationCodeHash,
        uint256 expectedLauncherCreationCodeLength
    )
        ProgrammableExactHookemonNormalCreateProfileBaseV1(
            deployment, expectedLauncherCreationCodeHash, expectedLauncherCreationCodeLength
        )
    { }
}

library HookemonLifecycleMockTypesV1 {
    struct ComponentContextV1 {
        address launcher;
        address poolManager;
        address positionManager;
        address usdc;
        address fundingWallet;
        address approvedMultisig;
        address executor;
        address artifactAuthorizer;
        address token;
        address hook;
        address distributor;
        address bridgeAdapter;
        address returnAdapter;
        address cycleVault;
        address treasuryVesting;
        address positionTimelock;
        bytes32 launchId;
        bytes32 launchConfigHash;
        bytes32 launchHash;
        bytes32 canonicalPoolId;
        uint64 launchTimestamp;
        uint256 positionTokenId;
        uint256 tokenRoundingDust;
        uint128 expectedPositionLiquidity;
        uint256 cycleBootstrapUsdcAmount;
        uint32 selectedTotalFee;
        string tokenName;
        string tokenSymbol;
        bytes32 tokenNameHash;
        bytes32 tokenSymbolHash;
    }
}

contract HookemonTestAuthorityV1 {
    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) {
        return 0x1626ba7e;
    }

    function registerProfile(
        ProgrammableUniversalLaunchKernelV1 kernel,
        IProgrammableUniversalLaunchKernelV1.ProfileDescriptorV1 calldata descriptor
    ) external {
        kernel.registerProfileV1(descriptor);
    }
}

contract HookemonApplicantWalletV1 {
    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) {
        return 0x1626ba7e;
    }

    function approve(HookemonUsdcMockV1 usdc, address spender, uint256 amount) external {
        usdc.approve(spender, amount);
    }

    function launch(
        IProgrammableExactHookemonNormalCreateProfileV1 profile,
        bytes32 grantDigest,
        IProgrammableExactHookemonNormalCreateProfileV1.ExactHookemonPlanV1 calldata plan,
        IProgrammableUniversalLaunchKernelV1.ExecutionCurrentnessV1 calldata currentness,
        IProgrammableUniversalLaunchKernelV1.ApplicantWalletIntentV1 calldata intent
    ) external returns (bytes32 receiptCoreHash) {
        IProgrammableExactHookemonNormalCreateProfileV1.LaunchTransportV1 memory transport =
            IProgrammableExactHookemonNormalCreateProfileV1.LaunchTransportV1({
                currentness: currentness, currentnessSignature: hex"01", walletIntent: intent, walletSignature: hex"02"
            });
        return profile.launchExactHookemonV1(grantDigest, plan, transport);
    }
}

contract HookemonUsdcMockV1 {
    mapping(address owner => mapping(address spender => uint256 amount)) private _allowance;
    mapping(address account => uint256 amount) private _balance;

    function approve(address spender, uint256 amount) external returns (bool) {
        _allowance[msg.sender][spender] = amount;
        return true;
    }

    function allowance(address owner, address spender) external view returns (uint256) {
        return _allowance[owner][spender];
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balance[account];
    }

    function setBalance(address account, uint256 amount) external {
        _balance[account] = amount;
    }

    function consumeExactApproval(address owner, uint256 amount) external {
        require(_allowance[owner][msg.sender] == amount, "approval");
        _allowance[owner][msg.sender] = 0;
    }
}

contract HookemonPositionManagerMockV1 {
    uint256 public nextTokenId = 77;
    mapping(uint256 tokenId => address owner) private _ownerOf;
    mapping(uint256 tokenId => uint128 liquidity) private _liquidity;

    function configurePosition(uint256 tokenId, address owner, uint128 liquidity) external {
        _ownerOf[tokenId] = owner;
        _liquidity[tokenId] = liquidity;
        nextTokenId = tokenId + 1;
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        return _ownerOf[tokenId];
    }

    function getApproved(uint256) external pure returns (address) {
        return address(0);
    }

    function getPositionLiquidity(uint256 tokenId) external view returns (uint128) {
        return _liquidity[tokenId];
    }
}

contract HookemonRuntimeDependencyMockV1 { }

contract HookemonGithubRepositoryLineageRegistryMockV1 is IProgrammableGithubRepositoryLineageRegistryV1 {
    mapping(bytes32 repositoryKey => RepositoryConsumptionV1 record) private _consumptions;
    mapping(bytes32 launchId => bytes32 repositoryKey) private _repositoryKeyByLaunchId;
    uint64 private _consumptionCount;
    bool private _consumerAuthorized = true;

    error RepositoryAlreadyConsumed();
    error LaunchAlreadyConsumed();

    function setConsumerAuthorized(bool authorized) external {
        _consumerAuthorized = authorized;
    }

    function hasRole(bytes32, address) external view returns (bool) {
        return _consumerAuthorized;
    }

    function consume(uint64 githubRepositoryId, bytes32 launchId, bytes32 routeId)
        external
        returns (bytes32 repositoryKey)
    {
        repositoryKey = computeRepositoryKey(githubRepositoryId);
        RepositoryConsumptionV1 storage existing = _consumptions[repositoryKey];
        if (existing.launchId != bytes32(0)) {
            if (existing.launchId == launchId && existing.routeId == routeId && existing.consumer == msg.sender) {
                return repositoryKey;
            }
            revert RepositoryAlreadyConsumed();
        }
        if (_repositoryKeyByLaunchId[launchId] != bytes32(0)) revert LaunchAlreadyConsumed();
        uint64 consumedAtBlock = uint64(block.number);
        _consumptions[repositoryKey] = RepositoryConsumptionV1({
            githubRepositoryId: githubRepositoryId,
            consumedAtBlock: consumedAtBlock,
            launchId: launchId,
            routeId: routeId,
            consumer: msg.sender
        });
        _repositoryKeyByLaunchId[launchId] = repositoryKey;
        _consumptionCount += 1;
        emit GithubRepositoryLineageConsumedV1(
            repositoryKey, launchId, routeId, githubRepositoryId, msg.sender, consumedAtBlock
        );
    }

    function computeRepositoryKey(uint64 githubRepositoryId) public pure returns (bytes32) {
        if (githubRepositoryId == 0) revert RepositoryAlreadyConsumed();
        return keccak256(abi.encode("programmable.github.repository.v1", uint256(githubRepositoryId)));
    }

    function consumption(bytes32 repositoryKey) external view returns (RepositoryConsumptionV1 memory) {
        return _consumptions[repositoryKey];
    }

    function repositoryKeyByLaunchId(bytes32 launchId) external view returns (bytes32) {
        return _repositoryKeyByLaunchId[launchId];
    }

    function consumptionCount() external view returns (uint64) {
        return _consumptionCount;
    }
}

contract HookemonRawCodeChunkV1 {
    constructor(bytes memory data) {
        assembly ("memory-safe") {
            return(add(data, 32), mload(data))
        }
    }
}

contract HookemonExactComponentMockV1 {
    using HookemonLifecycleMockTypesV1 for HookemonLifecycleMockTypesV1.ComponentContextV1;

    uint8 private _kind;
    address private _bootstrapFactory;
    HookemonLifecycleMockTypesV1.ComponentContextV1 private _context;
    bool private _initialized;

    function initialize(
        uint8 kind_,
        address bootstrapFactory_,
        HookemonLifecycleMockTypesV1.ComponentContextV1 calldata context_
    ) external {
        require(!_initialized, "initialized");
        _initialized = true;
        _kind = kind_;
        _bootstrapFactory = bootstrapFactory_;
        _context = context_;
    }

    function bootstrapFactory() external view returns (address) {
        return _bootstrapFactory;
    }

    function bootstrapLauncher() external view returns (address) {
        return _context.launcher;
    }

    function launchId() external view returns (bytes32) {
        return _context.launchId;
    }

    function launchConfigHash() external view returns (bytes32) {
        return _context.launchConfigHash;
    }

    function activated() external view returns (bool) {
        return _initialized;
    }

    function totalSupply() external view returns (uint256) {
        return _kind == 1 ? 420_690_000_000 ether : 0;
    }

    function name() external view returns (string memory) {
        return _kind == 1 ? _context.tokenName : "";
    }

    function symbol() external view returns (string memory) {
        return _kind == 1 ? _context.tokenSymbol : "";
    }

    function balanceOf(address account) external view returns (uint256) {
        if (_kind != 1) return 0;
        if (account == _context.treasuryVesting) return 42_069_000_000 ether;
        if (account == _context.positionTimelock) return _context.tokenRoundingDust;
        return 0;
    }

    function poolManager() external view returns (address) {
        return _context.poolManager;
    }

    function registrar() external view returns (address) {
        return _context.launcher;
    }

    function quoteCurrencyAddress() external view returns (address) {
        return _context.usdc;
    }

    function canonicalPoolId() external view returns (bytes32) {
        return _context.canonicalPoolId;
    }

    function canonicalPoolRegistered() external view returns (bool) {
        return _initialized;
    }

    function projectFeeOwner() external view returns (address) {
        return _context.cycleVault;
    }

    function selectedBuyHundredthsOfBip() external view returns (uint32) {
        return _context.selectedTotalFee;
    }

    function selectedSellHundredthsOfBip() external view returns (uint32) {
        return _context.selectedTotalFee;
    }

    function PROGRAMMABLE_FEE_OWNER() external pure returns (address) {
        return 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    }

    function PROGRAMMABLE_HUNDREDTHS_OF_BIP() external pure returns (uint32) {
        return 1000;
    }

    function totalQuoteFeesAccrued() external pure returns (uint256) {
        return 0;
    }

    function programmableFeeRemainder() external pure returns (uint256) {
        return 0;
    }

    function projectFeeRemainder() external pure returns (uint256) {
        return 0;
    }

    function feeRates(bool)
        external
        view
        returns (uint32 selected, uint32 effective, uint32 project, uint32 programmable)
    {
        selected = _context.selectedTotalFee;
        effective = selected < 1000 ? 1000 : selected;
        project = effective - 1000;
        programmable = 1000;
    }

    function positionManager() external view returns (address) {
        return _context.positionManager;
    }

    function depositor() external view returns (address) {
        return _context.launcher;
    }

    function beneficiary() external view returns (address) {
        return _context.approvedMultisig;
    }

    function unlockTimestamp() external view returns (uint64) {
        return _context.launchTimestamp + 2 * 365 days;
    }

    function expectedTokenId() external view returns (uint256) {
        return _context.positionTokenId;
    }

    function expectedPoolId() external view returns (bytes32) {
        return _context.canonicalPoolId;
    }

    function launchToken() external view returns (address) {
        return _context.token;
    }

    function expectedTokenDust() external view returns (uint256) {
        return _context.tokenRoundingDust;
    }

    function expectedPoolFee() external pure returns (uint24) {
        return 3000;
    }

    function expectedTickSpacing() external pure returns (int24) {
        return 60;
    }

    function expectedTickLower() external pure returns (int24) {
        return -887_220;
    }

    function expectedTickUpper() external pure returns (int24) {
        return 887_220;
    }

    function expectedLiquidity() external view returns (uint128) {
        return _context.expectedPositionLiquidity;
    }

    function tokenId() external view returns (uint256) {
        return _context.positionTokenId;
    }

    function positionDeposited() external view returns (bool) {
        return _initialized;
    }

    function released() external pure returns (bool) {
        return false;
    }

    function asset() external view returns (address) {
        return _context.usdc;
    }

    function projectFeeHook() external view returns (address) {
        return _context.hook;
    }

    function distributor() external view returns (address) {
        return _context.distributor;
    }

    function admin() external view returns (address) {
        return _context.approvedMultisig;
    }

    function guardian() external view returns (address) {
        return _context.approvedMultisig;
    }

    function operationalReserveMicroUsdc() external view returns (uint256) {
        uint256 bootstrap = _context.cycleBootstrapUsdcAmount;
        return bootstrap < 50e6 ? bootstrap : 50e6;
    }

    function availableProjectFeesMicroUsdc() external view returns (uint256) {
        uint256 reserve = _context.cycleBootstrapUsdcAmount < 50e6 ? _context.cycleBootstrapUsdcAmount : 50e6;
        return _context.cycleBootstrapUsdcAmount - reserve;
    }
}

contract HookemonHookFactoryMockV1 {
    mapping(address hook => bytes32 configurationHash) private _configurationHashOf;
    uint32 public selectedTotalFee = 30_000;

    function setSelectedTotalFee(uint32 selectedTotalFee_) external {
        selectedTotalFee = selectedTotalFee_;
    }

    function predict(bytes32 salt) public view returns (address) {
        return _create2Address(address(this), salt, keccak256(type(HookemonExactComponentMockV1).creationCode));
    }

    function deploy(bytes32 salt) external returns (address hook) {
        hook = address(new HookemonExactComponentMockV1{ salt: salt }());
    }

    function record(address hook, bytes32 configurationHash) external {
        _configurationHashOf[hook] = configurationHash;
    }

    function configurationHashOf(address hook) external view returns (bytes32) {
        return _configurationHashOf[hook];
    }

    function runtimeCodeHashOf(address) external pure returns (bytes32) {
        return keccak256(type(HookemonExactComponentMockV1).runtimeCode);
    }

    function _create2Address(address deployer, bytes32 salt, bytes32 initCodeHash) private pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(hex"ff", deployer, salt, initCodeHash)))));
    }
}

contract HookemonFixedFactoryMockV1 {
    uint8 private _kind;
    address private _chunk;
    mapping(address child => bytes32 configurationHash) private _deploymentConfiguration;

    constructor(uint8 kind_, address chunk_) {
        _kind = kind_;
        _chunk = chunk_;
    }

    function kind() external view returns (uint8) {
        return _kind;
    }

    function creationCodeHash() external pure returns (bytes32) {
        return keccak256(type(HookemonExactComponentMockV1).creationCode);
    }

    function runtimeCodeHash() external pure returns (bytes32) {
        return keccak256(type(HookemonExactComponentMockV1).runtimeCode);
    }

    function deploymentConfigHash(address child) external view returns (bytes32) {
        return _deploymentConfiguration[child];
    }

    function chunkAddresses() external view returns (address[] memory chunks) {
        chunks = new address[](1);
        chunks[0] = _chunk;
    }

    function predictChild(bytes32 launchId, address launcher, bytes32 launchConfigHash) public view returns (address) {
        bytes32 salt = keccak256(abi.encode(launchId, launcher, launchConfigHash, _kind));
        bytes32 initCodeHash = keccak256(type(HookemonExactComponentMockV1).creationCode);
        return address(uint160(uint256(keccak256(abi.encodePacked(hex"ff", address(this), salt, initCodeHash)))));
    }

    function deployChild(bytes32 launchId, address launcher, bytes32 launchConfigHash)
        external
        returns (address child)
    {
        bytes32 salt = keccak256(abi.encode(launchId, launcher, launchConfigHash, _kind));
        child = address(new HookemonExactComponentMockV1{ salt: salt }());
        _deploymentConfiguration[child] = launchConfigHash;
    }
}

contract HookemonChildFactoryRegistryMockV1 {
    mapping(uint8 kind => address factoryAddress) private _factory;

    constructor(address[6] memory factories) {
        for (uint8 kind = 1; kind <= 6; ++kind) {
            _factory[kind] = factories[kind - 1];
        }
    }

    function factory(uint8 kind) external view returns (address) {
        return _factory[kind];
    }
}

contract HookemonReentryProbeV1 {
    address private _target;
    bytes private _payload;
    bool private _armed;
    bool public attempted;
    bool public blocked;
    bytes4 public revertSelector;

    function arm(address target, bytes calldata payload) external {
        _target = target;
        _payload = payload;
        _armed = true;
    }

    function onLauncherConstruction() external {
        if (!_armed) return;
        attempted = true;
        (bool success, bytes memory reason) = _target.call(_payload);
        blocked = !success;
        if (reason.length >= 4) {
            assembly ("memory-safe") { sstore(revertSelector.slot, mload(add(reason, 32))) }
        }
    }
}

contract HookemonAtomicLauncherLifecycleMockV1 {
    using HookemonLifecycleMockTypesV1 for HookemonLifecycleMockTypesV1.ComponentContextV1;

    address public hookFactory;
    address public childFactoryRegistry;
    address public token;
    address public hook;
    address public rewardsDistributor;
    address public bridgeAdapter;
    address public returnAdapter;
    address public cycleVault;
    address public treasuryVesting;
    address public positionTimelock;
    address public positionManager;
    address public usdc;
    address public fundingWallet;
    address public approvedMultisig;
    address public executor;
    address public artifactAuthorizer;
    uint64 public launchTimestamp;
    uint256 public positionTokenId;
    bytes32 public canonicalPoolId;
    uint256 public tokenRoundingDust;
    bytes32 public launchId;
    bytes32 public launchConfigHash;
    bytes32 public launchHash;
    bytes32 public tokenNameHash;
    bytes32 public tokenSymbolHash;

    constructor(
        HookemonHookFactoryMockV1 hookFactory_,
        HookemonChildFactoryRegistryMockV1 childFactoryRegistry_,
        IProgrammableExactHookemonNormalCreateProfileV1.LaunchConfigV1 memory config
    ) {
        hookFactory = address(hookFactory_);
        childFactoryRegistry = address(childFactoryRegistry_);
        positionManager = config.positionManager;
        usdc = config.usdc;
        fundingWallet = config.fundingWallet;
        approvedMultisig = config.approvedMultisig;
        executor = config.executor;
        artifactAuthorizer = config.artifactAuthorizer;
        launchTimestamp = config.scheduleAnchor;
        tokenRoundingDust = config.positionRoundingDust;
        tokenNameHash = keccak256(bytes(config.tokenName));
        tokenSymbolHash = keccak256(bytes(config.tokenSymbol));

        launchConfigHash = configurationHashFor(address(this), config);
        launchId = launchIdFor(address(this), config.scheduleAnchor, launchConfigHash);
        token = address(new HookemonExactComponentMockV1{ salt: config.tokenSalt }());
        hook = hookFactory_.deploy(config.hookSalt);

        address[6] memory children;
        for (uint8 kind = 1; kind <= 6; ++kind) {
            HookemonFixedFactoryMockV1 factory = HookemonFixedFactoryMockV1(childFactoryRegistry_.factory(kind));
            children[kind - 1] = factory.deployChild(launchId, address(this), launchConfigHash);
        }
        rewardsDistributor = children[0];
        bridgeAdapter = children[1];
        returnAdapter = children[2];
        cycleVault = children[3];
        treasuryVesting = children[4];
        positionTimelock = children[5];
        HookemonUsdcMockV1(config.usdc).setBalance(cycleVault, config.cycleBootstrapUsdcAmount);
        canonicalPoolId = poolIdFor(address(this), token, hook, config.usdc);
        launchHash = launchHashFor(address(this), launchId, launchConfigHash, canonicalPoolId);
        positionTokenId = HookemonPositionManagerMockV1(config.positionManager).nextTokenId();

        HookemonLifecycleMockTypesV1.ComponentContextV1 memory context = _context(config);
        HookemonExactComponentMockV1(token).initialize(1, address(this), context);
        HookemonExactComponentMockV1(hook).initialize(2, address(hookFactory_), context);
        for (uint8 kind = 1; kind <= 6; ++kind) {
            address factoryAddress = childFactoryRegistry_.factory(kind);
            HookemonExactComponentMockV1(children[kind - 1]).initialize(kind + 2, factoryAddress, context);
        }
        hookFactory_.record(hook, launchConfigHash);
        HookemonPositionManagerMockV1(config.positionManager)
            .configurePosition(positionTokenId, positionTimelock, config.expectedPositionLiquidity);
        HookemonUsdcMockV1(config.usdc)
            .consumeExactApproval(config.fundingWallet, config.liquidityUsdcAmount + config.cycleBootstrapUsdcAmount);
        (bool reentryHook,) = config.executor.call(abi.encodeCall(HookemonReentryProbeV1.onLauncherConstruction, ()));
        require(reentryHook, "reentry hook");
    }

    function poolKey() external view returns (IExactHookemonAtomicLauncherViewV1.PoolKeyV1 memory key) {
        key = IExactHookemonAtomicLauncherViewV1.PoolKeyV1({
            currency0: usdc, currency1: token, fee: 3000, tickSpacing: 60, hooks: hook
        });
    }

    function configurationHashFor(
        address launcher,
        IProgrammableExactHookemonNormalCreateProfileV1.LaunchConfigV1 memory config
    ) public view returns (bytes32) {
        return keccak256(abi.encode("HOOKEMON_TEST_LAUNCH_CONFIG_V1", block.chainid, launcher, config));
    }

    function launchIdFor(address launcher, uint64 scheduleAnchor, bytes32 configurationHash)
        public
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode("HOOKEMON_TEST_LAUNCH_V1", block.chainid, launcher, scheduleAnchor, configurationHash)
        );
    }

    function poolIdFor(address launcher, address token_, address hook_, address usdc_) public pure returns (bytes32) {
        return keccak256(abi.encode("HOOKEMON_TEST_POOL_V1", launcher, usdc_, token_, hook_, uint24(3000), int24(60)));
    }

    function launchHashFor(address launcher, bytes32 launchId_, bytes32 configurationHash, bytes32 poolId)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode("HOOKEMON_TEST_LAUNCH_HASH_V1", launcher, launchId_, configurationHash, poolId));
    }

    function _context(IProgrammableExactHookemonNormalCreateProfileV1.LaunchConfigV1 memory config)
        private
        view
        returns (HookemonLifecycleMockTypesV1.ComponentContextV1 memory context)
    {
        context.launcher = address(this);
        context.poolManager = config.poolManager;
        context.positionManager = config.positionManager;
        context.usdc = config.usdc;
        context.fundingWallet = config.fundingWallet;
        context.approvedMultisig = config.approvedMultisig;
        context.executor = config.executor;
        context.artifactAuthorizer = config.artifactAuthorizer;
        context.token = token;
        context.hook = hook;
        context.distributor = rewardsDistributor;
        context.bridgeAdapter = bridgeAdapter;
        context.returnAdapter = returnAdapter;
        context.cycleVault = cycleVault;
        context.treasuryVesting = treasuryVesting;
        context.positionTimelock = positionTimelock;
        context.launchId = launchId;
        context.launchConfigHash = launchConfigHash;
        context.launchHash = launchHash;
        context.canonicalPoolId = canonicalPoolId;
        context.launchTimestamp = launchTimestamp;
        context.positionTokenId = positionTokenId;
        context.tokenRoundingDust = tokenRoundingDust;
        context.expectedPositionLiquidity = config.expectedPositionLiquidity;
        context.cycleBootstrapUsdcAmount = config.cycleBootstrapUsdcAmount;
        context.selectedTotalFee = HookemonHookFactoryMockV1(hookFactory).selectedTotalFee();
        context.tokenName = config.tokenName;
        context.tokenSymbol = config.tokenSymbol;
        context.tokenNameHash = tokenNameHash;
        context.tokenSymbolHash = tokenSymbolHash;
    }
}

contract HookemonExpectedStateCalculatorV1 {
    bytes20 private constant SOURCE_COMMIT_ID = bytes20(hex"55fd47cec3ed8e61e59d5a919d98aeec2e269549");
    bytes20 private constant SOURCE_TREE_ID = bytes20(hex"2667ff1bee70dd082596d5f65b3ed4cb2c1ce387");
    address private constant PROGRAMMABLE_FEE_OWNER = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    bytes32 private constant ARCHITECTURE_TYPEHASH = keccak256(
        "ExactHookemonArchitectureV1(bytes20 sourceCommit,bytes20 sourceTree,address launcher,bytes32 launcherRuntimeCodeHash,bytes32 identityHead,bytes32 exclusiveHead,bytes32 sharedHead,bytes32 factoryHead)"
    );
    bytes32 private constant POOL_STATE_TYPEHASH =
        keccak256("ExactHookemonPoolStateV1(bytes32 identityHead,bytes32 positionHead,bytes32 fundingHead)");
    bytes32 private constant REVENUE_STATE_TYPEHASH = keccak256(
        "ExactHookemonRevenueStateV1(bytes32 identityHead,bytes32 directionalRatesHead,uint24 lpFeePips,bool lpFeeSeparate)"
    );

    function expectedStateHashes(
        HookemonLifecycleMockTypesV1.ComponentContextV1 calldata context,
        address[9] calldata exclusive,
        bytes32[9] calldata exclusiveRuntimeHashes,
        address[14] calldata shared,
        bytes32[14] calldata sharedRuntimeHashes,
        bytes32 launcherRuntimeHash
    ) external pure returns (bytes32 architectureHash, bytes32 poolHash, bytes32 revenueHash) {
        (bytes32 exclusiveHead, bytes32 sharedHead, bytes32 factoryHead) =
            _componentHeads(exclusive, exclusiveRuntimeHashes, shared, sharedRuntimeHashes);
        bytes32 identityHead = _architectureIdentityHead(context);
        architectureHash = keccak256(
            abi.encode(
                ARCHITECTURE_TYPEHASH,
                SOURCE_COMMIT_ID,
                SOURCE_TREE_ID,
                context.launcher,
                launcherRuntimeHash,
                identityHead,
                exclusiveHead,
                sharedHead,
                factoryHead
            )
        );
        (poolHash, revenueHash) = _economicStateHashes(context);
    }

    function _componentHeads(
        address[9] calldata exclusive,
        bytes32[9] calldata exclusiveRuntimeHashes,
        address[14] calldata shared,
        bytes32[14] calldata sharedRuntimeHashes
    ) private pure returns (bytes32 exclusiveHead, bytes32 sharedHead, bytes32 factoryHead) {
        for (uint256 i; i < 9; ++i) {
            exclusiveHead = keccak256(abi.encode(exclusiveHead, i, exclusive[i], exclusiveRuntimeHashes[i]));
        }
        bytes32 sharedBase = keccak256(abi.encode(bytes32(0), uint256(0), shared[0], sharedRuntimeHashes[0]));
        sharedBase = keccak256(abi.encode(sharedBase, uint256(1), shared[1], sharedRuntimeHashes[1]));
        bytes32 factoriesSharedHead;
        for (uint8 kind = 1; kind <= 6; ++kind) {
            uint256 index = kind - 1;
            factoriesSharedHead = keccak256(
                abi.encode(factoriesSharedHead, uint256(2 + index), shared[2 + index], sharedRuntimeHashes[2 + index])
            );
            factoriesSharedHead = keccak256(
                abi.encode(factoriesSharedHead, uint256(8 + index), shared[8 + index], sharedRuntimeHashes[8 + index])
            );
            bytes32 factoryLeaf = _factoryLeaf(
                shared[2 + index], shared[8 + index], sharedRuntimeHashes[8 + index], exclusive[3 + index]
            );
            factoryHead = keccak256(abi.encode(factoryHead, kind, factoryLeaf));
        }
        sharedHead = keccak256(abi.encode(sharedBase, factoriesSharedHead));
    }

    function _factoryLeaf(address factory, address codeChunk, bytes32 codeChunkRuntimeHash, address child)
        private
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                factory,
                keccak256(type(HookemonExactComponentMockV1).creationCode),
                keccak256(type(HookemonExactComponentMockV1).runtimeCode),
                codeChunk,
                codeChunkRuntimeHash,
                child
            )
        );
    }

    function _architectureIdentityHead(HookemonLifecycleMockTypesV1.ComponentContextV1 calldata context)
        private
        pure
        returns (bytes32)
    {
        bytes32 launchHead = keccak256(
            abi.encode(
                context.launchConfigHash,
                context.launchId,
                context.launchHash,
                context.launchTimestamp,
                context.positionManager,
                context.usdc
            )
        );
        bytes32 authorityHead = keccak256(
            abi.encode(context.fundingWallet, context.approvedMultisig, context.executor, context.artifactAuthorizer)
        );
        return keccak256(abi.encode(launchHead, authorityHead, context.tokenNameHash, context.tokenSymbolHash));
    }

    function _economicStateHashes(HookemonLifecycleMockTypesV1.ComponentContextV1 calldata context)
        private
        pure
        returns (bytes32 poolHash, bytes32 revenueHash)
    {
        return (_poolStateHash(context), _revenueStateHash(context));
    }

    function _poolStateHash(HookemonLifecycleMockTypesV1.ComponentContextV1 calldata context)
        private
        pure
        returns (bytes32)
    {
        bytes32 positionHead = keccak256(
            abi.encode(
                uint24(3000),
                int24(60),
                int24(-887_220),
                int24(887_220),
                context.expectedPositionLiquidity,
                context.tokenRoundingDust,
                context.launchTimestamp,
                context.launchTimestamp + 2 * 365 days
            )
        );
        uint256 reserve = context.cycleBootstrapUsdcAmount < 50e6 ? context.cycleBootstrapUsdcAmount : 50e6;
        uint256 available = context.cycleBootstrapUsdcAmount - reserve;
        bytes32 fundingHead = keccak256(
            abi.encode(
                context.fundingWallet, context.approvedMultisig, reserve, available, context.cycleBootstrapUsdcAmount
            )
        );
        bytes32 assetHead = keccak256(
            abi.encode(
                context.canonicalPoolId,
                context.positionManager,
                context.positionTokenId,
                context.token,
                context.hook,
                context.usdc
            )
        );
        bytes32 custodyHead = keccak256(
            abi.encode(context.positionTimelock, context.treasuryVesting, context.launchConfigHash, context.launchHash)
        );
        bytes32 poolIdentityHead = keccak256(abi.encode(assetHead, custodyHead));
        return keccak256(abi.encode(POOL_STATE_TYPEHASH, poolIdentityHead, positionHead, fundingHead));
    }

    function _revenueStateHash(HookemonLifecycleMockTypesV1.ComponentContextV1 calldata context)
        private
        pure
        returns (bytes32)
    {
        bytes32 directionalRatesHead = keccak256(
            abi.encode(
                uint32(30_000),
                uint32(30_000),
                uint32(30_000),
                uint32(30_000),
                uint32(29_000),
                uint32(29_000),
                uint32(1000),
                uint32(1000)
            )
        );
        bytes32 revenueIdentityHead = keccak256(
            abi.encode(
                context.hook,
                context.poolManager,
                context.launcher,
                context.usdc,
                context.canonicalPoolId,
                context.cycleVault,
                PROGRAMMABLE_FEE_OWNER
            )
        );
        return
            keccak256(abi.encode(REVENUE_STATE_TYPEHASH, revenueIdentityHead, directionalRatesHead, uint24(3000), true));
    }
}

contract ProgrammableExactHookemonNormalCreateProfileV1Test is Test {
    bytes32 private constant SECURITY_HEAD = keccak256("hookemon-security-head-v1");
    bytes32 private constant SECURITY_EPOCH_HASH = keccak256("hookemon-security-epoch-v1");
    bytes32 private constant POLICY_EPOCH_HASH = keccak256("hookemon-policy-epoch-v1");
    bytes32 private constant REVIEW_GENERATION_HASH = keccak256("hookemon-review-generation-v1");
    bytes32 private constant PROFILE_KEY = keccak256("HOOKEMON:EXACT_NORMAL_CREATE:v1");
    bytes32 private constant SOURCE_LAUNCH_ID = keccak256("hookemon-source-launch-v1");
    bytes20 private constant SOURCE_COMMIT_ID = bytes20(hex"55fd47cec3ed8e61e59d5a919d98aeec2e269549");
    bytes20 private constant SOURCE_TREE_ID = bytes20(hex"2667ff1bee70dd082596d5f65b3ed4cb2c1ce387");
    uint256 private constant LIQUIDITY_USDC = 100e6;
    uint256 private constant CYCLE_BOOTSTRAP_USDC = 75e6;
    uint256 private constant EXACT_APPROVAL = LIQUIDITY_USDC + CYCLE_BOOTSTRAP_USDC;
    uint256 private constant REVIEWED_EXACT_LAUNCHER_GAS_GATE = 29_400_000;

    struct Fixture {
        ProgrammableUniversalLaunchKernelV1 kernel;
        ProgrammableUniversalLaunchPreflightV1 preflight;
        ProgrammableExactHookemonLauncherCodeStoreV1 codeStore;
        ProgrammableExactHookemonPostconditionVerifierV1 verifier;
        HookemonNormalCreateProfileHarnessV1 profile;
        HookemonApplicantWalletV1 applicant;
        HookemonUsdcMockV1 usdc;
        HookemonHookFactoryMockV1 hookFactory;
        HookemonChildFactoryRegistryMockV1 registry;
        HookemonGithubRepositoryLineageRegistryMockV1 repositoryLineageRegistry;
        HookemonReentryProbeV1 probe;
        HookemonTestAuthorityV1 governance;
    }

    struct PreparedLaunch {
        IProgrammableExactHookemonNormalCreateProfileV1.ExactHookemonPlanV1 plan;
        IProgrammableUniversalLaunchKernelV1.LaunchGrantV1 grant;
        bytes32 grantDigest;
        IProgrammableUniversalLaunchKernelV1.ExecutionCurrentnessV1 currentness;
        IProgrammableUniversalLaunchKernelV1.ApplicantWalletIntentV1 intent;
    }

    function testAtomicLifecycleUsesNonceOneAndFinalizesExactTwentyFourComponentGraph() external {
        (Fixture memory fixture, PreparedLaunch memory prepared) = _fixture(30_000);
        assertEq(vm.getNonce(address(fixture.profile)), 1, "profile nonce before launch");
        assertEq(prepared.plan.exclusive.accounts.length, 9, "exclusive components");
        assertEq(prepared.plan.shared.accounts.length, 14, "shared components");
        assertEq(address(prepared.plan.config.poolManager) == address(0), false, "pool manager component");
        assertEq(fixture.profile.exactHookemonReservationsV1(prepared.plan).length, 29, "reservation bound");

        uint256 gasBefore = gasleft();
        bytes32 receiptHash = _launch(fixture, prepared);
        uint256 launchGas = gasBefore - gasleft();
        assertLt(launchGas, REVIEWED_EXACT_LAUNCHER_GAS_GATE, "wrapped lifecycle gas gate");
        assertTrue(receiptHash != bytes32(0), "receipt");
        assertEq(fixture.profile.launched(), fixture.profile.predictedLauncherV1(), "nonce-one launcher");
        assertEq(HookemonExactComponentMockV1(prepared.plan.exclusive.accounts[1]).name(), "Hookemon Community");
        assertEq(HookemonExactComponentMockV1(prepared.plan.exclusive.accounts[1]).symbol(), "HKMN");
        assertEq(vm.getNonce(address(fixture.profile)), 2, "one create consumed");
        IProgrammableUniversalLaunchKernelV1.CanonicalLaunchReceiptV1 memory receipt =
            fixture.kernel.canonicalLaunchReceiptV1(prepared.grantDigest);
        assertEq(uint8(receipt.status), uint8(IProgrammableUniversalLaunchKernelV1.ReceiptStatus.Executed));
        assertEq(receipt.componentGraphHash, prepared.grant.componentGraphHash);
        assertEq(receipt.revenueBindingHash, fixture.profile.REVENUE_POLICY_HASH());
        IProgrammableGithubRepositoryLineageRegistryV1.RepositoryConsumptionV1 memory consumption =
            fixture.repositoryLineageRegistry.consumption(prepared.plan.repositoryKey);
        assertEq(consumption.githubRepositoryId, prepared.plan.githubRepositoryId, "repository id consumed");
        assertEq(consumption.launchId, prepared.grant.stampLaunchId, "repository launch id");
        assertEq(consumption.routeId, PROFILE_KEY, "repository route id");
        assertEq(consumption.consumer, address(fixture.profile), "repository consumer");
    }

    function testReusableVerifierReadsDynamicIdentityAndExactGraphWithoutPerLaunchDeployment() external {
        (Fixture memory fixture, PreparedLaunch memory prepared) =
            _fixtureWithIdentity(unicode"Hookémon Community", "HKMN2");
        ProgrammableExactHookemonPostconditionVerifierV2 reusableVerifier =
            new ProgrammableExactHookemonPostconditionVerifierV2();
        bytes32 verifierRuntimeHash = address(reusableVerifier).codehash;
        bytes32 verifierBindingHash = reusableVerifier.runtimeBindingHashV1();

        _launch(fixture, prepared);
        (bytes32 architectureHash, bytes32 poolHash, bytes32 revenueHash) = reusableVerifier.verifyExactHookemonPostconditionsV2(
            prepared.plan.exclusive.accounts[0],
            prepared.plan.exclusive.runtimeCodeHashes[0],
            prepared.plan.tokenNameHash,
            prepared.plan.tokenSymbolHash
        );
        assertEq(architectureHash, prepared.plan.expectedArchitectureStateHash, "dynamic architecture");
        assertEq(poolHash, prepared.plan.expectedPoolStateHash, "dynamic pool");
        assertEq(revenueHash, prepared.plan.expectedRevenueStateHash, "dynamic revenue");
        assertEq(address(reusableVerifier).codehash, verifierRuntimeHash, "verifier runtime drift");
        assertEq(reusableVerifier.runtimeBindingHashV1(), verifierBindingHash, "verifier binding drift");

        vm.expectRevert();
        reusableVerifier.verifyExactHookemonPostconditionsV2(
            prepared.plan.exclusive.accounts[0],
            prepared.plan.exclusive.runtimeCodeHashes[0],
            keccak256("changed-name"),
            prepared.plan.tokenSymbolHash
        );
        vm.expectRevert();
        reusableVerifier.verifyExactHookemonPostconditionsV2(
            prepared.plan.exclusive.accounts[0],
            prepared.plan.exclusive.runtimeCodeHashes[0],
            prepared.plan.tokenNameHash,
            keccak256("CHANGED")
        );
        vm.expectRevert();
        reusableVerifier.verifyExactHookemonPostconditionsV2(
            prepared.plan.exclusive.accounts[0],
            keccak256("changed-launcher-runtime"),
            prepared.plan.tokenNameHash,
            prepared.plan.tokenSymbolHash
        );
    }

    function testReviewedConfigurableLauncherArtifactReconstructsExactly() external {
        ProgrammableExactHookemonLauncherCodeStoreV1 codeStore = _reviewedCodeStore();
        assertEq(codeStore.creationCodeLengthV1(), 45_393, "reviewed creation length");
        assertEq(
            codeStore.creationCodeHashV1(),
            0xc2314bf561f2304acb421eefb441e3a908542629cc6fd910896cbc48dbd1664e,
            "reviewed creation hash"
        );
        bytes memory creationCode = codeStore.readCreationCodeV1();
        assertEq(creationCode.length, 45_393, "reconstructed creation length");
        assertEq(keccak256(creationCode), codeStore.creationCodeHashV1(), "reconstructed creation hash");
        assertEq(creationCode.length + 1472, 46_865, "maximum reviewed complete initcode bytes");
    }

    function testMaximumWebsiteIdentityUsesExactDynamicConstructorEncoding() external {
        string memory maximumName = unicode"AAAAAAAAAAAAAAAAéééééééééééééééé";
        (Fixture memory fixture, PreparedLaunch memory prepared) = _fixtureWithIdentity(maximumName, "ABCDEFGHIJ");
        bytes memory constructorArguments =
            abi.encode(prepared.plan.shared.accounts[0], prepared.plan.shared.accounts[1], prepared.plan.config);
        assertEq(constructorArguments.length, 1472, "maximum constructor argument bytes");
        bytes memory mockInitCode =
            bytes.concat(type(HookemonAtomicLauncherLifecycleMockV1).creationCode, constructorArguments);
        assertEq(keccak256(mockInitCode), prepared.plan.completeInitCodeHash, "dynamic initcode binding");
        _launch(fixture, prepared);
        assertEq(HookemonExactComponentMockV1(prepared.plan.exclusive.accounts[1]).name(), maximumName);
        assertEq(HookemonExactComponentMockV1(prepared.plan.exclusive.accounts[1]).symbol(), "ABCDEFGHIJ");
    }

    function testProductionProfileBindsOnlyReviewedConfigurableLauncherArtifact() external {
        HookemonGithubRepositoryLineageRegistryMockV1 lineageRegistry =
            new HookemonGithubRepositoryLineageRegistryMockV1();
        IProgrammableExactHookemonNormalCreateProfileV1.SharedComponentsV1 memory ignored;
        Fixture memory fixture;
        (fixture, ignored) = _baseFixture(30_000, lineageRegistry);
        fixture.codeStore = _reviewedCodeStore();
        bytes32 nameHash = keccak256("Hookemon Community");
        bytes32 symbolHash = keccak256("HKMN");
        fixture.verifier = new ProgrammableExactHookemonPostconditionVerifierV1(
            keccak256("reviewed-launcher-runtime"),
            keccak256("architecture"),
            keccak256("pool"),
            keccak256("revenue"),
            nameHash,
            symbolHash
        );
        ProgrammableExactHookemonNormalCreateProfileV1 productionProfile =
            new ProgrammableExactHookemonNormalCreateProfileV1(_deploymentConfig(fixture));
        assertEq(productionProfile.REVIEWED_LAUNCHER_CREATION_CODE_LENGTH(), 45_393);
        assertEq(
            productionProfile.REVIEWED_LAUNCHER_CREATION_CODE_HASH(),
            0xc2314bf561f2304acb421eefb441e3a908542629cc6fd910896cbc48dbd1664e
        );

        Fixture memory wrongFixture;
        (wrongFixture, ignored) = _baseFixture(30_000, new HookemonGithubRepositoryLineageRegistryMockV1());
        wrongFixture.verifier = new ProgrammableExactHookemonPostconditionVerifierV1(
            keccak256("reviewed-launcher-runtime"),
            keccak256("architecture"),
            keccak256("pool"),
            keccak256("revenue"),
            nameHash,
            symbolHash
        );
        ProgrammableExactHookemonNormalCreateProfileBaseV1.DeploymentConfigV1 memory wrongDeployment =
            _deploymentConfig(wrongFixture);
        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableExactHookemonNormalCreateProfileBaseV1.InvalidField.selector, uint256(2))
        );
        new ProgrammableExactHookemonNormalCreateProfileV1(wrongDeployment);
    }

    function testReplayAndReentryFailClosed() external {
        (Fixture memory fixture, PreparedLaunch memory prepared) = _fixture(30_000);
        bytes memory reentry = abi.encodeCall(
            HookemonApplicantWalletV1.launch,
            (fixture.profile, prepared.grantDigest, prepared.plan, prepared.currentness, prepared.intent)
        );
        fixture.probe.arm(address(fixture.applicant), reentry);
        _launch(fixture, prepared);
        assertTrue(fixture.probe.attempted(), "reentry not attempted");
        assertTrue(fixture.probe.blocked(), "reentry escaped");
        (bool replay,) = address(fixture.applicant).call(reentry);
        assertFalse(replay, "replay accepted");
    }

    function testWrongPlanCodeBlobAndFeeRollbackWithoutConsumingRetry() external {
        _assertMutationRollsBack(1);
        _assertMutationRollsBack(2);
        _assertMutationRollsBack(3);

        (Fixture memory fixture, PreparedLaunch memory prepared) = _fixture(31_000);
        (bool wrongFee,) = _tryLaunch(fixture, prepared);
        assertFalse(wrongFee, "wrong inclusive fee accepted");
        assertEq(fixture.profile.predictedLauncherV1().code.length, 0, "launcher rollback");
        assertEq(fixture.repositoryLineageRegistry.consumptionCount(), 0, "repository consumed on rollback");
        _assertActive(fixture.kernel, prepared.grantDigest);
        assertEq(
            fixture.usdc.allowance(address(fixture.applicant), fixture.profile.predictedLauncherV1()), EXACT_APPROVAL
        );
        fixture.hookFactory.setSelectedTotalFee(30_000);
        assertTrue(_launch(fixture, prepared) != bytes32(0), "retry failed");
        assertEq(fixture.repositoryLineageRegistry.consumptionCount(), 1, "repository not consumed on success");
    }

    function testRepositoryIdKeyAndSharedRegistryBindingMutationsFailClosed() external {
        _assertMutationRollsBack(4);
        _assertMutationRollsBack(5);
        _assertMutationRollsBack(6);
    }

    function testSharedRepositoryLineageRejectsSecondProfileGrant() external {
        (Fixture memory first, PreparedLaunch memory firstPrepared) = _fixture(30_000);
        (Fixture memory second, PreparedLaunch memory secondPrepared) =
            _fixtureWithLineageRegistry(30_000, first.repositoryLineageRegistry);
        _launch(first, firstPrepared);
        (bool secondLaunch,) = _tryLaunch(second, secondPrepared);
        assertFalse(secondLaunch, "second launch from same repository accepted");
        for (uint256 i; i < secondPrepared.plan.exclusive.accounts.length; ++i) {
            assertEq(secondPrepared.plan.exclusive.accounts[i].code.length, 0, "second launcher/token/graph survived");
        }
        _assertActive(second.kernel, secondPrepared.grantDigest);
        assertEq(first.repositoryLineageRegistry.consumptionCount(), 1, "repository consumed twice");
    }

    function testSharedRepositoryLineageAuthorizationIsRequiredAtLaunch() external {
        (Fixture memory fixture, PreparedLaunch memory prepared) = _fixture(30_000);
        fixture.repositoryLineageRegistry.setConsumerAuthorized(false);
        (bool launched,) = _tryLaunch(fixture, prepared);
        assertFalse(launched, "unauthorized profile consumed repository");
        assertEq(fixture.repositoryLineageRegistry.consumptionCount(), 0, "unauthorized consumption recorded");
        _assertActive(fixture.kernel, prepared.grantDigest);
    }

    function testWebsiteSelectedTokenIdentityAndPresentationHashBinding() external {
        (Fixture memory fixture, PreparedLaunch memory prepared) = _fixture(30_000);
        assertEq(
            uint8(fixture.profile.tokenIdentityPolicyV1()),
            uint8(IProgrammableExactHookemonNormalCreateProfileV1.TokenIdentityPolicyV1.PlatformSelectedBounded)
        );
        assertEq(fixture.profile.TOKEN_IDENTITY_POLICY_HASH(), keccak256("platform_selected_bounded_identity_v1"));
        assertTrue(fixture.profile.tokenIdentityConstraintsHashV1() != bytes32(0), "identity constraints missing");
        assertEq(prepared.plan.tokenNameHash, keccak256(bytes(prepared.plan.config.tokenName)));
        assertEq(prepared.plan.tokenSymbolHash, keccak256(bytes(prepared.plan.config.tokenSymbol)));
        bytes4 nameSelector = bytes4(keccak256("setTokenName(string)"));
        bytes4 symbolSelector = bytes4(keccak256("setTokenSymbol(string)"));
        bytes4 metadataSelector = bytes4(keccak256("setPresentationMetadata(bytes)"));
        (bool nameAccepted,) = address(fixture.profile).call(abi.encodeWithSelector(nameSelector, "Other"));
        (bool symbolAccepted,) = address(fixture.profile).call(abi.encodeWithSelector(symbolSelector, "OTHER"));
        (bool metadataAccepted,) = address(fixture.profile).call(abi.encodeWithSelector(metadataSelector, hex"1234"));
        assertFalse(nameAccepted || symbolAccepted || metadataAccepted, "arbitrary identity or metadata surface");
        assertTrue(prepared.plan.presentationBindingHash != bytes32(0), "presentation binding missing");

        bytes32 priorPlanHash = fixture.profile.computeExactHookemonPlanCommitmentsV1(prepared.plan).planHash;
        prepared.plan.config.tokenName = "Other Monsters";
        prepared.plan.tokenNameHash = keccak256(bytes(prepared.plan.config.tokenName));
        bytes32 identityMutatedPlanHash = fixture.profile.computeExactHookemonPlanCommitmentsV1(prepared.plan).planHash;
        assertTrue(priorPlanHash != identityMutatedPlanHash, "token name selection not bound");
        prepared.plan.config.tokenName = "Hookemon Community";
        prepared.plan.tokenNameHash = keccak256(bytes(prepared.plan.config.tokenName));
        prepared.plan.presentationBindingHash = keccak256("different-image-description-and-links");
        bytes32 mutatedPlanHash = fixture.profile.computeExactHookemonPlanCommitmentsV1(prepared.plan).planHash;
        assertTrue(priorPlanHash != mutatedPlanHash, "presentation selection not bound");
    }

    function testTokenIdentityTamperAndWebsitePolicyViolationsFailClosed() external {
        (Fixture memory fixture, PreparedLaunch memory prepared) = _fixture(30_000);
        prepared.plan.tokenNameHash = keccak256("wrong-name");
        (bool wrongHash,) = _tryLaunch(fixture, prepared);
        assertFalse(wrongHash, "name hash tamper accepted");
        assertEq(fixture.profile.predictedLauncherV1().code.length, 0, "tamper launcher survived");

        (fixture, prepared) = _fixture(30_000);
        prepared.plan.config.tokenName = " Leading";
        prepared.plan.tokenNameHash = keccak256(bytes(prepared.plan.config.tokenName));
        (bool leadingSpace,) = _tryLaunch(fixture, prepared);
        assertFalse(leadingSpace, "trim boundary accepted");

        (fixture, prepared) = _fixture(30_000);
        prepared.plan.config.tokenSymbol = "lowercase";
        prepared.plan.tokenSymbolHash = keccak256(bytes(prepared.plan.config.tokenSymbol));
        (bool invalidSymbol,) = _tryLaunch(fixture, prepared);
        assertFalse(invalidSymbol, "invalid symbol class accepted");
    }

    function _fixture(uint32 selectedTotalFee)
        private
        returns (Fixture memory fixture, PreparedLaunch memory prepared)
    {
        return _fixtureWithLineageRegistry(selectedTotalFee, new HookemonGithubRepositoryLineageRegistryMockV1());
    }

    function _fixtureWithLineageRegistry(
        uint32 selectedTotalFee,
        HookemonGithubRepositoryLineageRegistryMockV1 repositoryLineageRegistry
    ) private returns (Fixture memory fixture, PreparedLaunch memory prepared) {
        IProgrammableExactHookemonNormalCreateProfileV1.SharedComponentsV1 memory shared;
        (fixture, shared) = _baseFixture(selectedTotalFee, repositoryLineageRegistry);
        (fixture, prepared.plan) = _deployProfile(fixture, shared);
        fixture.governance.registerProfile(fixture.kernel, _descriptor(fixture, _control()));
        prepared = _prepareLaunch(fixture, prepared.plan);
    }

    function _fixtureWithIdentity(string memory tokenName, string memory tokenSymbol)
        private
        returns (Fixture memory fixture, PreparedLaunch memory prepared)
    {
        IProgrammableExactHookemonNormalCreateProfileV1.SharedComponentsV1 memory shared;
        (fixture, shared) = _baseFixture(30_000, new HookemonGithubRepositoryLineageRegistryMockV1());
        (fixture, prepared.plan) = _deployProfileWithIdentity(fixture, shared, tokenName, tokenSymbol);
        fixture.governance.registerProfile(fixture.kernel, _descriptor(fixture, _control()));
        prepared = _prepareLaunch(fixture, prepared.plan);
    }

    function _baseFixture(
        uint32 selectedTotalFee,
        HookemonGithubRepositoryLineageRegistryMockV1 repositoryLineageRegistry
    )
        private
        returns (
            Fixture memory fixture,
            IProgrammableExactHookemonNormalCreateProfileV1.SharedComponentsV1 memory shared
        )
    {
        fixture.applicant = new HookemonApplicantWalletV1();
        fixture.usdc = new HookemonUsdcMockV1();
        fixture.probe = new HookemonReentryProbeV1();
        fixture.repositoryLineageRegistry = repositoryLineageRegistry;
        fixture.hookFactory = new HookemonHookFactoryMockV1();
        fixture.hookFactory.setSelectedTotalFee(selectedTotalFee);
        (fixture.registry, shared) = _sharedInfrastructure(fixture.hookFactory);
        fixture.preflight = new ProgrammableUniversalLaunchPreflightV1();
        (fixture.kernel, fixture.governance) = _newKernel(fixture.preflight, _control());
        fixture.codeStore = _codeStore();
    }

    function _deployProfile(
        Fixture memory fixture,
        IProgrammableExactHookemonNormalCreateProfileV1.SharedComponentsV1 memory shared
    )
        private
        returns (Fixture memory, IProgrammableExactHookemonNormalCreateProfileV1.ExactHookemonPlanV1 memory plan)
    {
        return _deployProfileWithIdentity(fixture, shared, "Hookemon Community", "HKMN");
    }

    function _deployProfileWithIdentity(
        Fixture memory fixture,
        IProgrammableExactHookemonNormalCreateProfileV1.SharedComponentsV1 memory shared,
        string memory tokenName,
        string memory tokenSymbol
    )
        private
        returns (Fixture memory, IProgrammableExactHookemonNormalCreateProfileV1.ExactHookemonPlanV1 memory plan)
    {
        HookemonExpectedStateCalculatorV1 calculator = new HookemonExpectedStateCalculatorV1();
        IProgrammableExactHookemonNormalCreateProfileV1.LaunchConfigV1 memory config = _fixtureConfig(fixture, shared);
        config.tokenName = tokenName;
        config.tokenSymbol = tokenSymbol;
        uint256 nextNonce = vm.getNonce(address(this));
        address predictedProfile = vm.computeCreateAddress(address(this), nextNonce + 1);
        address predictedLauncher = vm.computeCreateAddress(predictedProfile, 1);
        plan = _plan(shared, fixture.hookFactory, fixture.registry, calculator, predictedLauncher, config);
        plan.repositoryLineageRegistry = address(fixture.repositoryLineageRegistry);

        fixture.verifier = new ProgrammableExactHookemonPostconditionVerifierV1(
            plan.exclusive.runtimeCodeHashes[0],
            plan.expectedArchitectureStateHash,
            plan.expectedPoolStateHash,
            plan.expectedRevenueStateHash,
            plan.tokenNameHash,
            plan.tokenSymbolHash
        );
        fixture.profile = new HookemonNormalCreateProfileHarnessV1(
            _deploymentConfig(fixture), fixture.codeStore.creationCodeHashV1(), fixture.codeStore.creationCodeLengthV1()
        );
        assertEq(address(fixture.profile), predictedProfile, "profile prediction");
        assertEq(fixture.profile.predictedLauncherV1(), predictedLauncher, "launcher prediction");
        return (fixture, plan);
    }

    function _deploymentConfig(Fixture memory fixture)
        private
        view
        returns (ProgrammableExactHookemonNormalCreateProfileBaseV1.DeploymentConfigV1 memory deployment)
    {
        deployment = ProgrammableExactHookemonNormalCreateProfileBaseV1.DeploymentConfigV1({
            kernel: fixture.kernel,
            kernelRuntimeCodeHash: address(fixture.kernel).codehash,
            codeStore: fixture.codeStore,
            codeStoreRuntimeCodeHash: address(fixture.codeStore).codehash,
            codeStoreBindingHash: fixture.codeStore.runtimeBindingHashV1(),
            postconditionVerifier: fixture.verifier,
            postconditionVerifierRuntimeCodeHash: address(fixture.verifier).codehash,
            verifierBindingHash: fixture.verifier.runtimeBindingHashV1(),
            repositoryLineageRegistry: fixture.repositoryLineageRegistry,
            repositoryLineageRegistryRuntimeCodeHash: address(fixture.repositoryLineageRegistry).codehash,
            profileKey: PROFILE_KEY,
            verifierGasLimit: 2_000_000
        });
    }

    function _fixtureConfig(
        Fixture memory fixture,
        IProgrammableExactHookemonNormalCreateProfileV1.SharedComponentsV1 memory shared
    ) private returns (IProgrammableExactHookemonNormalCreateProfileV1.LaunchConfigV1 memory config) {
        HookemonRuntimeDependencyMockV1 poolManager = new HookemonRuntimeDependencyMockV1();
        HookemonPositionManagerMockV1 positionManager = new HookemonPositionManagerMockV1();
        config = _config(fixture, poolManager, positionManager, shared, _mineHookSalt(address(fixture.hookFactory)));
    }

    function _prepareLaunch(
        Fixture memory fixture,
        IProgrammableExactHookemonNormalCreateProfileV1.ExactHookemonPlanV1 memory plan
    ) private returns (PreparedLaunch memory prepared) {
        prepared.plan = plan;
        IProgrammableExactHookemonNormalCreateProfileV1.PlanCommitmentsV1 memory commitments =
            fixture.profile.computeExactHookemonPlanCommitmentsV1(prepared.plan);
        prepared.grant = _grant(fixture, prepared.plan, commitments);
        prepared.grant.stampLaunchId = fixture.kernel.computeStampLaunchIdV1(prepared.grant);
        prepared.grantDigest = fixture.kernel.activateLaunchGrantV1(prepared.grant, hex"01");
        fixture.applicant.approve(fixture.usdc, fixture.profile.predictedLauncherV1(), EXACT_APPROVAL);
        IProgrammableUniversalLaunchKernelV1.ReservationV1[] memory reservations =
            fixture.profile.exactHookemonReservationsV1(prepared.plan);
        bytes32 kernelPreflightHash = fixture.preflight
            .atomicPreflightHashV1(
                address(fixture.kernel), address(fixture.kernel).codehash, prepared.grantDigest, reservations
            );
        bytes32 profilePreflightHash = fixture.profile.computeExactHookemonPreflightHashV1(prepared.plan);
        prepared.currentness =
            _currentness(prepared.grantDigest, commitments.planHash, kernelPreflightHash, profilePreflightHash);
        prepared.intent = IProgrammableUniversalLaunchKernelV1.ApplicantWalletIntentV1({
            grantDigest: prepared.grantDigest,
            stampLaunchId: prepared.grant.stampLaunchId,
            antiReplayNonce: prepared.grant.antiReplayNonce,
            profileModule: address(fixture.profile),
            intentNonce: keccak256(abi.encode(prepared.grantDigest, "wallet-intent")),
            validAfter: uint64(block.timestamp),
            deadline: uint64(block.timestamp + 300)
        });
    }

    function _newKernel(
        ProgrammableUniversalLaunchPreflightV1 preflight,
        IProgrammableUniversalLaunchKernelV1.ControlStateV1 memory control
    ) private returns (ProgrammableUniversalLaunchKernelV1 kernel, HookemonTestAuthorityV1 governance) {
        HookemonTestAuthorityV1 reviewer = new HookemonTestAuthorityV1();
        governance = new HookemonTestAuthorityV1();
        HookemonTestAuthorityV1 finality = new HookemonTestAuthorityV1();
        HookemonTestAuthorityV1 indexer = new HookemonTestAuthorityV1();
        kernel = new ProgrammableUniversalLaunchKernelV1(
            address(reviewer),
            address(reviewer).codehash,
            address(governance),
            address(governance).codehash,
            address(finality),
            address(finality).codehash,
            address(indexer),
            address(indexer).codehash,
            address(preflight),
            address(preflight).codehash,
            control
        );
    }

    function _sharedInfrastructure(HookemonHookFactoryMockV1 hookFactory)
        private
        returns (
            HookemonChildFactoryRegistryMockV1 registry,
            IProgrammableExactHookemonNormalCreateProfileV1.SharedComponentsV1 memory shared
        )
    {
        address[6] memory childChunks;
        address[6] memory factories;
        for (uint8 kind = 1; kind <= 6; ++kind) {
            childChunks[kind - 1] = address(new HookemonRawCodeChunkV1(abi.encode(kind, "child-code")));
            factories[kind - 1] = address(new HookemonFixedFactoryMockV1(kind, childChunks[kind - 1]));
        }
        registry = new HookemonChildFactoryRegistryMockV1(factories);
        shared.accounts[0] = address(hookFactory);
        shared.accounts[1] = address(registry);
        shared.runtimeCodeHashes[0] = address(hookFactory).codehash;
        shared.runtimeCodeHashes[1] = address(registry).codehash;
        for (uint256 i; i < 6; ++i) {
            shared.accounts[2 + i] = factories[i];
            shared.accounts[8 + i] = childChunks[i];
            shared.runtimeCodeHashes[2 + i] = factories[i].codehash;
            shared.runtimeCodeHashes[8 + i] = childChunks[i].codehash;
        }
    }

    function _codeStore() private returns (ProgrammableExactHookemonLauncherCodeStoreV1 codeStore) {
        bytes memory creationCode = type(HookemonAtomicLauncherLifecycleMockV1).creationCode;
        uint256 split = creationCode.length / 2;
        HookemonRawCodeChunkV1 part0 = new HookemonRawCodeChunkV1(_slice(creationCode, 0, split));
        HookemonRawCodeChunkV1 part1 =
            new HookemonRawCodeChunkV1(_slice(creationCode, split, creationCode.length - split));
        codeStore = new ProgrammableExactHookemonLauncherCodeStoreV1(address(part0), address(part1));
        assertEq(codeStore.creationCodeHashV1(), keccak256(creationCode), "creation code reconstruction");
    }

    function _reviewedCodeStore() private returns (ProgrammableExactHookemonLauncherCodeStoreV1 codeStore) {
        bytes memory creationCode =
            vm.parseBytes(vm.trim(vm.readFile("dependencies/hookemon/HookemonAtomicLauncher.creation.bin")));
        uint256 split = creationCode.length / 2;
        HookemonRawCodeChunkV1 part0 = new HookemonRawCodeChunkV1(_slice(creationCode, 0, split));
        HookemonRawCodeChunkV1 part1 =
            new HookemonRawCodeChunkV1(_slice(creationCode, split, creationCode.length - split));
        codeStore = new ProgrammableExactHookemonLauncherCodeStoreV1(address(part0), address(part1));
    }

    function _config(
        Fixture memory fixture,
        HookemonRuntimeDependencyMockV1 poolManager,
        HookemonPositionManagerMockV1 positionManager,
        IProgrammableExactHookemonNormalCreateProfileV1.SharedComponentsV1 memory shared,
        bytes32 hookSalt
    ) private view returns (IProgrammableExactHookemonNormalCreateProfileV1.LaunchConfigV1 memory config) {
        config.poolManager = address(poolManager);
        config.positionManager = address(positionManager);
        config.usdc = address(fixture.usdc);
        config.tokenMessengerV2 = address(0x1001);
        config.messageTransmitterV2 = address(0x1002);
        config.fundingWallet = address(fixture.applicant);
        config.approvedMultisig = address(0x1003);
        config.executor = address(fixture.probe);
        config.artifactAuthorizer = address(0x1004);
        config.solanaUsdcAta = keccak256("solana-usdc-ata");
        config.solanaUsdcMint = keccak256("solana-usdc-mint");
        config.solanaReturnAuthority = keccak256("solana-return-authority");
        config.solanaTokenMessenger = keccak256("solana-token-messenger");
        config.solanaDomain = 5;
        config.outboundProtocolFeeCapBps = 1;
        config.outboundForwardFeeCapMicroUsdc = 2_000_000;
        config.scheduleAnchor = uint64(block.timestamp + 1 days);
        config.tokenSalt = keccak256("hookemon-token-salt");
        config.hookSalt = hookSalt;
        config.launcherMode = 2;
        config.distributorFactory = shared.accounts[2];
        config.outboundBridgeFactory = shared.accounts[3];
        config.returnAdapterFactory = shared.accounts[4];
        config.cycleVaultFactory = shared.accounts[5];
        config.treasuryVestingFactory = shared.accounts[6];
        config.positionTimelockFactory = shared.accounts[7];
        config.poolFee = 3000;
        config.tickSpacing = 60;
        config.tickLower = -887_220;
        config.tickUpper = 887_220;
        config.initialSqrtPriceX96 = uint160(1 << 96);
        config.liquidityUsdcAmount = LIQUIDITY_USDC;
        config.cycleBootstrapUsdcAmount = CYCLE_BOOTSTRAP_USDC;
        config.positionRoundingDust = 1000;
        config.positionUnlockAt = config.scheduleAnchor + 2 * 365 days;
        config.expectedPositionLiquidity = 123_456;
        config.tokenName = "Hookemon Community";
        config.tokenSymbol = "HKMN";
    }

    function _plan(
        IProgrammableExactHookemonNormalCreateProfileV1.SharedComponentsV1 memory shared,
        HookemonHookFactoryMockV1 hookFactory,
        HookemonChildFactoryRegistryMockV1 registry,
        HookemonExpectedStateCalculatorV1 calculator,
        address launcher,
        IProgrammableExactHookemonNormalCreateProfileV1.LaunchConfigV1 memory config
    ) private view returns (IProgrammableExactHookemonNormalCreateProfileV1.ExactHookemonPlanV1 memory plan) {
        bytes32 componentCreationHash = keccak256(type(HookemonExactComponentMockV1).creationCode);
        bytes32 componentRuntimeHash = keccak256(type(HookemonExactComponentMockV1).runtimeCode);
        address token = _create2Address(launcher, config.tokenSalt, componentCreationHash);
        address hook = hookFactory.predict(config.hookSalt);
        bytes32 launchConfigHash =
            keccak256(abi.encode("HOOKEMON_TEST_LAUNCH_CONFIG_V1", block.chainid, launcher, config));
        bytes32 launchId = keccak256(
            abi.encode("HOOKEMON_TEST_LAUNCH_V1", block.chainid, launcher, config.scheduleAnchor, launchConfigHash)
        );
        bytes32 poolId =
            keccak256(abi.encode("HOOKEMON_TEST_POOL_V1", launcher, config.usdc, token, hook, uint24(3000), int24(60)));
        bytes32 launchHash =
            keccak256(abi.encode("HOOKEMON_TEST_LAUNCH_HASH_V1", launcher, launchId, launchConfigHash, poolId));

        plan.schemaVersion = 1;
        plan.applicantWallet = config.fundingWallet;
        plan.sourceLaunchId = SOURCE_LAUNCH_ID;
        plan.githubRepositoryId = 1_324_982_531;
        plan.repositoryKey = keccak256(abi.encode("programmable.github.repository.v1", uint256(1_324_982_531)));
        plan.repositoryLineageRegistry = address(0);
        plan.presentationBindingHash = keccak256("hookemon-presentation:image-description-links:v1");
        plan.tokenNameHash = keccak256(bytes(config.tokenName));
        plan.tokenSymbolHash = keccak256(bytes(config.tokenSymbol));
        plan.poolManagerRuntimeCodeHash = config.poolManager.codehash;
        plan.canonicalPoolId = poolId;
        plan.expectedPositionTokenId = HookemonPositionManagerMockV1(config.positionManager).nextTokenId();
        plan.expectedLaunchConfigHash = launchConfigHash;
        plan.expectedLaunchId = launchId;
        plan.expectedLaunchHash = launchHash;
        plan.config = config;
        plan.shared = shared;
        plan.exclusive.accounts[0] = launcher;
        plan.exclusive.accounts[1] = token;
        plan.exclusive.accounts[2] = hook;
        plan.exclusive.runtimeCodeHashes[0] = keccak256(type(HookemonAtomicLauncherLifecycleMockV1).runtimeCode);
        plan.exclusive.runtimeCodeHashes[1] = componentRuntimeHash;
        plan.exclusive.runtimeCodeHashes[2] = componentRuntimeHash;
        for (uint8 kind = 1; kind <= 6; ++kind) {
            address child =
                HookemonFixedFactoryMockV1(registry.factory(kind)).predictChild(launchId, launcher, launchConfigHash);
            plan.exclusive.accounts[2 + kind] = child;
            plan.exclusive.runtimeCodeHashes[2 + kind] = componentRuntimeHash;
        }
        plan.completeInitCodeHash = keccak256(
            bytes.concat(
                type(HookemonAtomicLauncherLifecycleMockV1).creationCode, abi.encode(hookFactory, registry, config)
            )
        );
        HookemonLifecycleMockTypesV1.ComponentContextV1 memory context = HookemonLifecycleMockTypesV1.ComponentContextV1({
            launcher: launcher,
            poolManager: config.poolManager,
            positionManager: config.positionManager,
            usdc: config.usdc,
            fundingWallet: config.fundingWallet,
            approvedMultisig: config.approvedMultisig,
            executor: config.executor,
            artifactAuthorizer: config.artifactAuthorizer,
            token: token,
            hook: hook,
            distributor: plan.exclusive.accounts[3],
            bridgeAdapter: plan.exclusive.accounts[4],
            returnAdapter: plan.exclusive.accounts[5],
            cycleVault: plan.exclusive.accounts[6],
            treasuryVesting: plan.exclusive.accounts[7],
            positionTimelock: plan.exclusive.accounts[8],
            launchId: launchId,
            launchConfigHash: launchConfigHash,
            launchHash: launchHash,
            canonicalPoolId: poolId,
            launchTimestamp: config.scheduleAnchor,
            positionTokenId: plan.expectedPositionTokenId,
            tokenRoundingDust: config.positionRoundingDust,
            expectedPositionLiquidity: config.expectedPositionLiquidity,
            cycleBootstrapUsdcAmount: config.cycleBootstrapUsdcAmount,
            selectedTotalFee: 30_000,
            tokenName: config.tokenName,
            tokenSymbol: config.tokenSymbol,
            tokenNameHash: plan.tokenNameHash,
            tokenSymbolHash: plan.tokenSymbolHash
        });
        (plan.expectedArchitectureStateHash, plan.expectedPoolStateHash, plan.expectedRevenueStateHash) =
            _expectedStateHashes(calculator, context, plan);
    }

    function _expectedStateHashes(
        HookemonExpectedStateCalculatorV1 calculator,
        HookemonLifecycleMockTypesV1.ComponentContextV1 memory context,
        IProgrammableExactHookemonNormalCreateProfileV1.ExactHookemonPlanV1 memory plan
    ) private pure returns (bytes32 architectureHash, bytes32 poolHash, bytes32 revenueHash) {
        return calculator.expectedStateHashes(
            context,
            plan.exclusive.accounts,
            plan.exclusive.runtimeCodeHashes,
            plan.shared.accounts,
            plan.shared.runtimeCodeHashes,
            plan.exclusive.runtimeCodeHashes[0]
        );
    }

    function _descriptor(Fixture memory fixture, IProgrammableUniversalLaunchKernelV1.ControlStateV1 memory control)
        private
        view
        returns (IProgrammableUniversalLaunchKernelV1.ProfileDescriptorV1 memory descriptor)
    {
        descriptor = IProgrammableUniversalLaunchKernelV1.ProfileDescriptorV1({
            profileKey: PROFILE_KEY,
            schemaId: keccak256("EXACT_HOOKEMON_NORMAL_CREATE_SCHEMA_V1"),
            profileVersion: 1,
            capabilitySemantics: IProgrammableUniversalLaunchKernelV1.CapabilitySemantics.Execute,
            module: address(fixture.profile),
            moduleRuntimeCodeHash: address(fixture.profile).codehash,
            actionTypeHash: fixture.profile.PLAN_TYPEHASH(),
            exactContractBindingHash: fixture.profile.EXACT_CONTRACT_BINDING_HASH(),
            providerBindingHash: fixture.profile.PROVIDER_BINDING_HASH(),
            revenuePolicyHash: fixture.profile.REVENUE_POLICY_HASH(),
            securityControlHeadHash: control.securityControlHeadHash,
            securityEpoch: control.securityEpoch,
            securityEpochHash: control.securityEpochHash,
            policyEpoch: control.policyEpoch,
            policyEpochHash: control.policyEpochHash,
            reviewGeneration: control.reviewGeneration,
            reviewGenerationHash: control.reviewGenerationHash,
            status: IProgrammableUniversalLaunchKernelV1.ProfileStatus.Active
        });
    }

    function _grant(
        Fixture memory fixture,
        IProgrammableExactHookemonNormalCreateProfileV1.ExactHookemonPlanV1 memory plan,
        IProgrammableExactHookemonNormalCreateProfileV1.PlanCommitmentsV1 memory commitments
    ) private view returns (IProgrammableUniversalLaunchKernelV1.LaunchGrantV1 memory grant) {
        grant = IProgrammableUniversalLaunchKernelV1.LaunchGrantV1({
            schemaVersion: 1,
            applicantWallet: address(fixture.applicant),
            applicantIdHash: keccak256(abi.encode(address(fixture.applicant), "hookemon-applicant")),
            profileKey: PROFILE_KEY,
            planHash: commitments.planHash,
            sourceRepoHash: plan.repositoryKey,
            sourceCommit: SOURCE_COMMIT_ID,
            sourceTree: SOURCE_TREE_ID,
            sourceLaunchId: SOURCE_LAUNCH_ID,
            stampLaunchId: bytes32(uint256(1)),
            antiReplayNonce: keccak256(abi.encode(address(fixture.applicant), commitments.planHash, "anti-replay")),
            componentGraphHash: commitments.componentGraphHash,
            componentRuntimeSetHash: commitments.componentRuntimeSetHash,
            configurationHash: commitments.configurationHash,
            builderEvidenceHash: keccak256("hookemon-builder-evidence"),
            reviewerAttestationHash: keccak256("hookemon-reviewer-attestation"),
            exactContractBindingHash: fixture.profile.EXACT_CONTRACT_BINDING_HASH(),
            providerBindingHash: fixture.profile.PROVIDER_BINDING_HASH(),
            revenueBindingHash: fixture.profile.REVENUE_POLICY_HASH(),
            securityControlHeadHash: SECURITY_HEAD,
            securityEpoch: 1,
            securityEpochHash: SECURITY_EPOCH_HASH,
            policyEpoch: 1,
            policyEpochHash: POLICY_EPOCH_HASH,
            reviewGeneration: 1,
            reviewGenerationHash: REVIEW_GENERATION_HASH
        });
        assertEq(plan.applicantWallet, grant.applicantWallet, "grant applicant");
    }

    function _currentness(
        bytes32 grantDigest,
        bytes32 planHash,
        bytes32 kernelPreflightHash,
        bytes32 profilePreflightHash
    ) private view returns (IProgrammableUniversalLaunchKernelV1.ExecutionCurrentnessV1 memory currentness) {
        currentness = IProgrammableUniversalLaunchKernelV1.ExecutionCurrentnessV1({
            grantDigest: grantDigest,
            profileKey: PROFILE_KEY,
            planHash: planHash,
            executionMode: IProgrammableUniversalLaunchKernelV1.CapabilitySemantics.Execute,
            kernelPreflightReadbackHash: kernelPreflightHash,
            profilePreflightReadbackHash: profilePreflightHash,
            dualProviderQuorumEvidenceHash: keccak256(abi.encode(grantDigest, "dual-provider")),
            simulationEvidenceHash: keccak256(abi.encode(grantDigest, "simulation")),
            serviceDeploymentBindingHash: keccak256(abi.encode(grantDigest, "service")),
            currentnessNonce: keccak256(abi.encode(grantDigest, "currentness")),
            securityControlHeadHash: SECURITY_HEAD,
            securityEpoch: 1,
            securityEpochHash: SECURITY_EPOCH_HASH,
            policyEpoch: 1,
            policyEpochHash: POLICY_EPOCH_HASH,
            reviewGeneration: 1,
            reviewGenerationHash: REVIEW_GENERATION_HASH,
            validAfter: uint64(block.timestamp),
            deadline: uint64(block.timestamp + 600)
        });
    }

    function _control() private pure returns (IProgrammableUniversalLaunchKernelV1.ControlStateV1 memory control) {
        control = IProgrammableUniversalLaunchKernelV1.ControlStateV1({
            securityControlHeadHash: SECURITY_HEAD,
            securityEpoch: 1,
            securityEpochHash: SECURITY_EPOCH_HASH,
            policyEpoch: 1,
            policyEpochHash: POLICY_EPOCH_HASH,
            reviewGeneration: 1,
            reviewGenerationHash: REVIEW_GENERATION_HASH,
            globalKilled: false
        });
    }

    function _launch(Fixture memory fixture, PreparedLaunch memory prepared) private returns (bytes32 receiptCoreHash) {
        receiptCoreHash = fixture.applicant
            .launch(fixture.profile, prepared.grantDigest, prepared.plan, prepared.currentness, prepared.intent);
    }

    function _tryLaunch(Fixture memory fixture, PreparedLaunch memory prepared)
        private
        returns (bool success, bytes memory reason)
    {
        (success, reason) = address(fixture.applicant)
            .call(
                abi.encodeCall(
                    HookemonApplicantWalletV1.launch,
                    (fixture.profile, prepared.grantDigest, prepared.plan, prepared.currentness, prepared.intent)
                )
            );
    }

    function _assertMutationRollsBack(uint8 mutation) private {
        (Fixture memory fixture, PreparedLaunch memory prepared) = _fixture(30_000);
        if (mutation == 1) {
            prepared.plan.config.positionRoundingDust += 1;
        } else if (mutation == 2) {
            prepared.plan.completeInitCodeHash = keccak256("wrong-complete-initcode");
        } else if (mutation == 3) {
            (address part,,) = fixture.codeStore.partV1(0);
            vm.etch(part, hex"00");
        } else if (mutation == 4) {
            prepared.plan.githubRepositoryId += 1;
        } else if (mutation == 5) {
            prepared.plan.repositoryKey = keccak256("wrong-repository-key");
        } else {
            prepared.plan.repositoryLineageRegistry = address(new HookemonRuntimeDependencyMockV1());
        }
        (bool success,) = _tryLaunch(fixture, prepared);
        assertFalse(success, "mutated launch accepted");
        assertEq(fixture.profile.predictedLauncherV1().code.length, 0, "mutated launcher survived");
        assertEq(vm.getNonce(address(fixture.profile)), 1, "failed create consumed nonce");
        assertEq(fixture.repositoryLineageRegistry.consumptionCount(), 0, "repository consumed on failed launch");
        _assertActive(fixture.kernel, prepared.grantDigest);
        assertEq(
            fixture.usdc.allowance(address(fixture.applicant), fixture.profile.predictedLauncherV1()),
            EXACT_APPROVAL,
            "approval consumed on rollback"
        );
    }

    function _assertActive(ProgrammableUniversalLaunchKernelV1 kernel, bytes32 grantDigest) private view {
        IProgrammableUniversalLaunchKernelV1.LaunchGrantStateHeadV1 memory head =
            kernel.launchGrantStateHeadV1(grantDigest);
        assertEq(uint8(head.status), uint8(IProgrammableUniversalLaunchKernelV1.LaunchGrantStatus.Active));
    }

    function _mineHookSalt(address factory) private pure returns (bytes32 salt) {
        bytes32 initCodeHash = keccak256(type(HookemonExactComponentMockV1).creationCode);
        for (uint256 i = 1; i < 200_000; ++i) {
            salt = bytes32(i);
            address candidate = _create2Address(factory, salt, initCodeHash);
            if (uint160(candidate) & ((1 << 14) - 1) == 0x20cc) return salt;
        }
        revert("hook salt not found");
    }

    function _create2Address(address deployer, bytes32 salt, bytes32 initCodeHash) private pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(hex"ff", deployer, salt, initCodeHash)))));
    }

    function _slice(bytes memory source, uint256 start, uint256 length) private pure returns (bytes memory result) {
        result = new bytes(length);
        for (uint256 i; i < length; ++i) {
            result[i] = source[start + i];
        }
    }
}
