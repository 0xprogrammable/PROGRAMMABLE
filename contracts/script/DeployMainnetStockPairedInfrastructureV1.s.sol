// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { IBeacon } from "@openzeppelin/contracts/proxy/beacon/IBeacon.sol";
import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { Script } from "forge-std/Script.sol";

import { LockedPositionFeeForwarderFactoryV1 } from "../src/LockedPositionFeeForwarderFactoryV1.sol";
import { QuoteAssetCreatorFeeHookFactoryV1 } from "../src/QuoteAssetCreatorFeeHookFactoryV1.sol";
import { QuoteAssetCreatorFeeHookV1 } from "../src/QuoteAssetCreatorFeeHookV1.sol";
import { QuoteAssetFeeSplitVaultFactoryV1 } from "../src/QuoteAssetFeeSplitVaultFactoryV1.sol";
import { StockPairedLaunchV1 } from "../src/StockPairedLaunchV1.sol";
import { StockPairedPositionPlannerV1 } from "../src/StockPairedPositionPlannerV1.sol";
import { StockQuoteRegistryV1 } from "../src/StockQuoteRegistryV1.sol";

/// @title DeployMainnetStockPairedInfrastructureV1
/// @notice Deterministic, fail-closed deployment path for Stock-Paired V1 on Ethereum Mainnet.
/// @dev A normal Forge script run only simulates. Broadcasting requires an explicit `--broadcast` flag and an
///      operator-controlled signer. The reviewed sequence is exactly six broadcaster transactions.
contract DeployMainnetStockPairedInfrastructureV1 is Script {
    uint256 internal constant MAINNET_CHAIN_ID = 1;
    uint256 internal constant MAX_LAUNCHER_RUNTIME_BYTES = 23_000;

    address public constant LAUNCHER_TREASURY = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    address public constant POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address public constant POSITION_MANAGER = 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e;
    address public constant STATE_VIEW = 0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227;
    address public constant V4_QUOTER = 0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203;
    address public constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address public constant UNIVERSAL_ROUTER = 0x4C82D1fBFe28C977cBB58D8C7FF8FCF9F70a2cCA;
    address public constant UERC20_FACTORY = 0x000000e200088D55C39a11F609E5F667729ad49b;
    address public constant POSITION_FORWARDER_FACTORY = 0x291a9ff1059d225d02B1659430804486404dB507;

    address public constant ONDO_BEACON = 0x985462C9aA4D6c3Ad59Ae6e1e9c0C11347ED1598;
    address public constant ONDO_IMPLEMENTATION = 0xebBcb2cEE51c2FeE4062c9C1270dcb98B0b22250;

    bytes32 public constant POOL_MANAGER_CODE_HASH = 0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293;
    bytes32 public constant POSITION_MANAGER_CODE_HASH =
        0x77e36c08b19959a30dde46dec9abe6208e371ff2f56884a56fe1e1a53615528b;
    bytes32 public constant STATE_VIEW_CODE_HASH = 0xd7947778589cf4aac9a092a4451292a2056380941635ab7006d3c691d8dfd878;
    bytes32 public constant V4_QUOTER_CODE_HASH = 0x06de58fa119c5deaa7a667fb92d3894e25d9160e62fb82c8d86d43b47eefe441;
    bytes32 public constant PERMIT2_CODE_HASH = 0xc67d1657868aa5146eaf24fb879fb1fdec3d2d493b3683a61c9c2f4fb2851131;
    bytes32 public constant UNIVERSAL_ROUTER_CODE_HASH =
        0x70c9ea2b275087aea3d57ae48e2d30e272a07ff5b6c7974bd47c21478b37face;
    bytes32 public constant UERC20_FACTORY_CODE_HASH =
        0x9f042af1533641f048ced56b55898d9e87b2ccb0ec6854292e2cd8ea733e6aeb;
    bytes32 public constant POSITION_FORWARDER_FACTORY_CODE_HASH =
        0xcefd10b60f990984bb60c98eb53e66048bfd36da9b48200e8535f5ca39d58fb2;

    bytes32 public constant ONDO_TOKEN_CODE_HASH = 0x9806c8207a455c012b2799be651ac0146d54866f92db90b502e5e2efa283bee9;
    bytes32 public constant ONDO_BEACON_CODE_HASH = 0xfeff50d5e739b863fc9e0db874d5558375a3e2c81bc20c24923a685263d639bd;
    bytes32 public constant ONDO_IMPLEMENTATION_CODE_HASH =
        0x7480293a8fad3f98f01f39aa59cd4e4c30d7fc4e7019e8f6e691eb5a9be53d11;

    uint160 public constant REQUIRED_HOOK_FLAGS = uint160(
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
    );

    struct DeploymentPlan {
        address broadcaster;
        uint64 startingNonce;
        address quoteRegistry;
        address positionPlanner;
        address feeSplitVaultFactory;
        address hookFactory;
        address feeHook;
        address launcher;
        bytes32 hookSalt;
        bytes32 sourceCommitment;
    }

    struct DeploymentResult {
        StockQuoteRegistryV1 quoteRegistry;
        StockPairedPositionPlannerV1 positionPlanner;
        QuoteAssetFeeSplitVaultFactoryV1 feeSplitVaultFactory;
        QuoteAssetCreatorFeeHookFactoryV1 hookFactory;
        QuoteAssetCreatorFeeHookV1 feeHook;
        StockPairedLaunchV1 launcher;
        bytes32 hookSalt;
        bytes32 sourceCommitment;
        uint64 startingNonce;
    }

    error DeploymentAddressOccupied(address target);
    error InvalidBroadcaster(address broadcaster);
    error UnexpectedAddress(bytes32 field, address actual, address expected);
    error UnexpectedChain(uint256 actual, uint256 expected);
    error UnexpectedCodeHash(address target, bytes32 actual, bytes32 expected);
    error UnexpectedHookFlags(uint160 actual, uint160 expected);
    error UnexpectedNonce(address broadcaster, uint64 actual, uint64 expected);
    error UnexpectedSymbol(address token, bytes32 actual, bytes32 expected);
    error UnexpectedTreasury(address actual, address expected);
    error UnexpectedValue(bytes32 field, uint256 actual, uint256 expected);

    function run() external returns (DeploymentResult memory result) {
        address broadcaster = vm.envAddress("STOCK_PAIRED_MAINNET_DEPLOYER");
        address configuredTreasury = vm.envAddress("STOCK_PAIRED_MAINNET_TREASURY");
        uint256 configuredNonce = vm.envUint("STOCK_PAIRED_MAINNET_START_NONCE");
        if (configuredNonce > type(uint64).max) {
            revert UnexpectedValue(keccak256("startingNonce"), configuredNonce, type(uint64).max);
        }

        // The explicit bound above makes this narrowing conversion lossless.
        // forge-lint: disable-next-line(unsafe-typecast)
        return deployReviewed(broadcaster, uint64(configuredNonce), configuredTreasury);
    }

    function deployReviewed(address broadcaster, uint64 startingNonce, address configuredTreasury)
        public
        returns (DeploymentResult memory result)
    {
        validateOfficialDependencies();
        if (broadcaster == address(0)) revert InvalidBroadcaster(broadcaster);
        if (configuredTreasury != LAUNCHER_TREASURY) {
            revert UnexpectedTreasury(configuredTreasury, LAUNCHER_TREASURY);
        }

        uint64 actualNonce = vm.getNonce(broadcaster);
        if (actualNonce != startingNonce) revert UnexpectedNonce(broadcaster, actualNonce, startingNonce);

        DeploymentPlan memory plan = deploymentPlan(broadcaster, startingNonce);
        _assertVacant(plan.quoteRegistry);
        _assertVacant(plan.positionPlanner);
        _assertVacant(plan.feeSplitVaultFactory);
        _assertVacant(plan.hookFactory);
        _assertVacant(plan.feeHook);
        _assertVacant(plan.launcher);

        vm.startBroadcast(broadcaster);
        result.quoteRegistry = new StockQuoteRegistryV1(
            _assets(),
            _symbolHashes(),
            ONDO_BEACON,
            ONDO_IMPLEMENTATION,
            ONDO_TOKEN_CODE_HASH,
            ONDO_BEACON_CODE_HASH,
            ONDO_IMPLEMENTATION_CODE_HASH
        );
        result.positionPlanner = new StockPairedPositionPlannerV1();
        result.feeSplitVaultFactory = new QuoteAssetFeeSplitVaultFactoryV1();
        result.hookFactory = new QuoteAssetCreatorFeeHookFactoryV1();
        result.feeHook = result.hookFactory
            .deploy(
                plan.hookSalt,
                IPoolManager(POOL_MANAGER),
                configuredTreasury,
                result.quoteRegistry,
                result.feeSplitVaultFactory
            );
        result.launcher = new StockPairedLaunchV1(
            IPoolManager(POOL_MANAGER),
            IPositionManager(POSITION_MANAGER),
            UERC20Factory(UERC20_FACTORY),
            result.feeHook,
            result.quoteRegistry,
            result.positionPlanner,
            result.feeSplitVaultFactory,
            LockedPositionFeeForwarderFactoryV1(POSITION_FORWARDER_FACTORY)
        );
        vm.stopBroadcast();

        _assertAddress(keccak256("quoteRegistry"), address(result.quoteRegistry), plan.quoteRegistry);
        _assertAddress(keccak256("positionPlanner"), address(result.positionPlanner), plan.positionPlanner);
        _assertAddress(
            keccak256("feeSplitVaultFactory"), address(result.feeSplitVaultFactory), plan.feeSplitVaultFactory
        );
        _assertAddress(keccak256("hookFactory"), address(result.hookFactory), plan.hookFactory);
        _assertAddress(keccak256("feeHook"), address(result.feeHook), plan.feeHook);
        _assertAddress(keccak256("launcher"), address(result.launcher), plan.launcher);

        result.hookSalt = plan.hookSalt;
        result.sourceCommitment = plan.sourceCommitment;
        result.startingNonce = startingNonce;
        _validateDeployedStack(result);

        uint64 finalNonce = vm.getNonce(broadcaster);
        if (finalNonce != startingNonce + 6) {
            revert UnexpectedNonce(broadcaster, finalNonce, startingNonce + 6);
        }
    }

    function deploymentPlan(address broadcaster, uint64 startingNonce)
        public
        view
        returns (DeploymentPlan memory plan)
    {
        if (broadcaster == address(0)) revert InvalidBroadcaster(broadcaster);

        plan.broadcaster = broadcaster;
        plan.startingNonce = startingNonce;
        plan.quoteRegistry = vm.computeCreateAddress(broadcaster, startingNonce);
        plan.positionPlanner = vm.computeCreateAddress(broadcaster, uint256(startingNonce) + 1);
        plan.feeSplitVaultFactory = vm.computeCreateAddress(broadcaster, uint256(startingNonce) + 2);
        plan.hookFactory = vm.computeCreateAddress(broadcaster, uint256(startingNonce) + 3);
        (plan.feeHook, plan.hookSalt) = HookMiner.find(
            plan.hookFactory,
            REQUIRED_HOOK_FLAGS,
            type(QuoteAssetCreatorFeeHookV1).creationCode,
            abi.encode(
                IPoolManager(POOL_MANAGER),
                LAUNCHER_TREASURY,
                StockQuoteRegistryV1(plan.quoteRegistry),
                QuoteAssetFeeSplitVaultFactoryV1(plan.feeSplitVaultFactory)
            )
        );
        plan.launcher = vm.computeCreateAddress(broadcaster, uint256(startingNonce) + 5);
        plan.sourceCommitment = deploymentSourceCommitment();
    }

    function predictHook(address hookFactory, address quoteRegistry, address feeSplitVaultFactory, bytes32 hookSalt)
        public
        pure
        returns (address)
    {
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(
                type(QuoteAssetCreatorFeeHookV1).creationCode,
                abi.encode(
                    IPoolManager(POOL_MANAGER),
                    LAUNCHER_TREASURY,
                    StockQuoteRegistryV1(quoteRegistry),
                    QuoteAssetFeeSplitVaultFactoryV1(feeSplitVaultFactory)
                )
            )
        );
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), hookFactory, hookSalt, initCodeHash)))));
    }

    function validateOfficialDependencies() public view {
        if (block.chainid != MAINNET_CHAIN_ID) revert UnexpectedChain(block.chainid, MAINNET_CHAIN_ID);
        _assertCodeHash(POOL_MANAGER, POOL_MANAGER_CODE_HASH);
        _assertCodeHash(POSITION_MANAGER, POSITION_MANAGER_CODE_HASH);
        _assertCodeHash(STATE_VIEW, STATE_VIEW_CODE_HASH);
        _assertCodeHash(V4_QUOTER, V4_QUOTER_CODE_HASH);
        _assertCodeHash(PERMIT2, PERMIT2_CODE_HASH);
        _assertCodeHash(UNIVERSAL_ROUTER, UNIVERSAL_ROUTER_CODE_HASH);
        _assertCodeHash(UERC20_FACTORY, UERC20_FACTORY_CODE_HASH);
        _assertCodeHash(POSITION_FORWARDER_FACTORY, POSITION_FORWARDER_FACTORY_CODE_HASH);
        _assertCodeHash(ONDO_BEACON, ONDO_BEACON_CODE_HASH);
        _assertCodeHash(ONDO_IMPLEMENTATION, ONDO_IMPLEMENTATION_CODE_HASH);
        _assertAddress(
            keccak256("ondo.beaconImplementation"), IBeacon(ONDO_BEACON).implementation(), ONDO_IMPLEMENTATION
        );

        address[] memory assets = _assets();
        bytes32[] memory symbols = _symbolHashes();
        for (uint256 index; index < assets.length; index++) {
            address asset = assets[index];
            _assertCodeHash(asset, ONDO_TOKEN_CODE_HASH);
            _assertValue(keccak256(abi.encode("ondo.decimals", asset)), IERC20Metadata(asset).decimals(), 18);
            bytes32 actualSymbol = keccak256(bytes(IERC20Metadata(asset).symbol()));
            if (actualSymbol != symbols[index]) revert UnexpectedSymbol(asset, actualSymbol, symbols[index]);
        }
    }

    function deploymentSourceCommitment() public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("programmable.stock-paired.infrastructure.v1.ethereum"),
                _bytecodeCommitment(),
                _dependencyCommitment(),
                _assetCommitment(),
                _economicsCommitment()
            )
        );
    }

    function _bytecodeCommitment() private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(type(StockQuoteRegistryV1).creationCode),
                keccak256(type(StockPairedPositionPlannerV1).creationCode),
                keccak256(type(QuoteAssetFeeSplitVaultFactoryV1).creationCode),
                keccak256(type(QuoteAssetCreatorFeeHookFactoryV1).creationCode),
                keccak256(type(QuoteAssetCreatorFeeHookV1).creationCode),
                keccak256(type(StockPairedLaunchV1).creationCode)
            )
        );
    }

    function _dependencyCommitment() private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                _coreDependencyCommitment(),
                _routingDependencyCommitment(),
                _lockingDependencyCommitment(),
                LAUNCHER_TREASURY
            )
        );
    }

    function _coreDependencyCommitment() private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                POOL_MANAGER,
                POOL_MANAGER_CODE_HASH,
                POSITION_MANAGER,
                POSITION_MANAGER_CODE_HASH,
                STATE_VIEW,
                STATE_VIEW_CODE_HASH,
                V4_QUOTER,
                V4_QUOTER_CODE_HASH
            )
        );
    }

    function _routingDependencyCommitment() private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                PERMIT2,
                PERMIT2_CODE_HASH,
                UNIVERSAL_ROUTER,
                UNIVERSAL_ROUTER_CODE_HASH,
                UERC20_FACTORY,
                UERC20_FACTORY_CODE_HASH
            )
        );
    }

    function _lockingDependencyCommitment() private pure returns (bytes32) {
        return keccak256(abi.encode(POSITION_FORWARDER_FACTORY, POSITION_FORWARDER_FACTORY_CODE_HASH));
    }

    function _assetCommitment() private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                _assets(),
                _symbolHashes(),
                ONDO_TOKEN_CODE_HASH,
                ONDO_BEACON,
                ONDO_BEACON_CODE_HASH,
                ONDO_IMPLEMENTATION,
                ONDO_IMPLEMENTATION_CODE_HASH
            )
        );
    }

    function _economicsCommitment() private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                uint256(1_000_000_000 ether),
                uint256(0.01 ether),
                uint256(100),
                uint256(90),
                uint256(10),
                uint256(0),
                uint256(0),
                int256(191_200),
                int256(200),
                uint256(8),
                uint256(10_000),
                keccak256("permanently-locked-one-sided-position"),
                keccak256("immutable-beneficiaries-and-shares"),
                keccak256("beneficiary-authorized-claim-and-payout-update")
            )
        );
    }

    function _validateDeployedStack(DeploymentResult memory result) private view {
        _assertCodeHash(address(result.positionPlanner), keccak256(type(StockPairedPositionPlannerV1).runtimeCode));
        _assertCodeHash(
            address(result.feeSplitVaultFactory), keccak256(type(QuoteAssetFeeSplitVaultFactoryV1).runtimeCode)
        );
        _assertCodeHash(address(result.hookFactory), keccak256(type(QuoteAssetCreatorFeeHookFactoryV1).runtimeCode));
        if (address(result.launcher).code.length > MAX_LAUNCHER_RUNTIME_BYTES) {
            revert UnexpectedValue(
                keccak256("launcher.runtimeBytes"), address(result.launcher).code.length, MAX_LAUNCHER_RUNTIME_BYTES
            );
        }

        _assertValue(keccak256("quoteRegistry.assetCount"), result.quoteRegistry.assetCount(), 7);
        _assertAddress(keccak256("quoteRegistry.beacon"), result.quoteRegistry.beacon(), ONDO_BEACON);
        _assertAddress(
            keccak256("quoteRegistry.implementation"),
            result.quoteRegistry.reviewedImplementation(),
            ONDO_IMPLEMENTATION
        );
        _assertAddress(keccak256("hook.poolManager"), address(result.feeHook.poolManager()), POOL_MANAGER);
        _assertAddress(keccak256("hook.launcherFeeRecipient"), result.feeHook.launcherFeeRecipient(), LAUNCHER_TREASURY);
        _assertAddress(
            keccak256("hook.quoteRegistry"), address(result.feeHook.quoteRegistry()), address(result.quoteRegistry)
        );
        _assertAddress(
            keccak256("hook.feeSplitVaultFactory"),
            address(result.feeHook.feeSplitVaultFactory()),
            address(result.feeSplitVaultFactory)
        );
        uint160 actualFlags = uint160(address(result.feeHook)) & result.hookFactory.ALL_HOOK_MASK();
        if (actualFlags != REQUIRED_HOOK_FLAGS) revert UnexpectedHookFlags(actualFlags, REQUIRED_HOOK_FLAGS);
        if (!result.hookFactory.isFactoryHook(address(result.feeHook))) {
            revert UnexpectedAddress(keccak256("hookFactory.provenance"), address(0), address(result.feeHook));
        }

        _assertAddress(keccak256("launcher.poolManager"), address(result.launcher.poolManager()), POOL_MANAGER);
        _assertAddress(
            keccak256("launcher.positionManager"), address(result.launcher.positionManager()), POSITION_MANAGER
        );
        _assertAddress(keccak256("launcher.tokenFactory"), address(result.launcher.tokenFactory()), UERC20_FACTORY);
        _assertAddress(keccak256("launcher.feeHook"), address(result.launcher.feeHook()), address(result.feeHook));
        _assertAddress(
            keccak256("launcher.quoteRegistry"), address(result.launcher.quoteRegistry()), address(result.quoteRegistry)
        );
        _assertAddress(
            keccak256("launcher.positionPlanner"),
            address(result.launcher.positionPlanner()),
            address(result.positionPlanner)
        );
        _assertAddress(
            keccak256("launcher.feeSplitVaultFactory"),
            address(result.launcher.feeSplitVaultFactory()),
            address(result.feeSplitVaultFactory)
        );
        _assertAddress(
            keccak256("launcher.positionForwarderFactory"),
            address(result.launcher.positionForwarderFactory()),
            POSITION_FORWARDER_FACTORY
        );
        _assertValue(keccak256("hook.totalSwapFeeBps"), result.feeHook.TOTAL_SWAP_FEE_BPS(), 100);
        _assertValue(keccak256("hook.creatorFeeBps"), result.feeHook.CREATOR_FEE_BPS(), 90);
        _assertValue(keccak256("hook.launcherFeeBps"), result.feeHook.LAUNCHER_FEE_BPS(), 10);
        _assertValue(keccak256("hook.transferTaxBps"), result.feeHook.TRANSFER_TAX_BPS(), 0);
        _assertValue(keccak256("hook.lpFeePips"), result.feeHook.LP_FEE_PIPS(), 0);
        _assertValue(
            keccak256("launcher.minimumInitialBuyQuote"), result.launcher.MIN_INITIAL_BUY_QUOTE_AMOUNT(), 0.01 ether
        );
    }

    function _assets() private pure returns (address[] memory values) {
        values = new address[](7);
        values[0] = 0x2D1F7226Bd1F780AF6B9A49DCC0aE00E8Df4bDEE;
        values[1] = 0xFeDC5f4a6c38211c1338aa411018DFAf26612c08;
        values[2] = 0xbA47214eDd2bb43099611b208f75E4b42FDcfEDc;
        values[3] = 0xF3e4872e6a4cF365888D93b6146a2bAA7348F1A4;
        values[4] = 0x0e397938C1Aa0680954093495B70A9F5e2249aBa;
        values[5] = 0xf6b1117ec07684D3958caD8BEb1b302bfD21103f;
        values[6] = 0x14c3abF95Cb9C93a8b82C1CdCB76D72Cb87b2d4c;
    }

    function _symbolHashes() private pure returns (bytes32[] memory values) {
        values = new bytes32[](7);
        values[0] = keccak256("NVDAon");
        values[1] = keccak256("SPYon");
        values[2] = keccak256("GOOGLon");
        values[3] = keccak256("SLVon");
        values[4] = keccak256("QQQon");
        values[5] = keccak256("TSLAon");
        values[6] = keccak256("AAPLon");
    }

    function _assertVacant(address target) private view {
        if (target.code.length != 0) revert DeploymentAddressOccupied(target);
    }

    function _assertCodeHash(address target, bytes32 expected) private view {
        bytes32 actual = target.codehash;
        if (actual != expected) revert UnexpectedCodeHash(target, actual, expected);
    }

    function _assertAddress(bytes32 field, address actual, address expected) private pure {
        if (actual != expected) revert UnexpectedAddress(field, actual, expected);
    }

    function _assertValue(bytes32 field, uint256 actual, uint256 expected) private pure {
        if (actual != expected) revert UnexpectedValue(field, actual, expected);
    }
}
