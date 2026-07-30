// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { IBeacon } from "@openzeppelin/contracts/proxy/beacon/IBeacon.sol";
import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { Script } from "forge-std/Script.sol";

import { LockedPositionFeeForwarderFactoryV1 } from "../src/LockedPositionFeeForwarderFactoryV1.sol";
import { QuoteAssetCreatorFeeHookFactoryV1 } from "../src/QuoteAssetCreatorFeeHookFactoryV1.sol";
import { QuoteAssetCreatorFeeHookV1 } from "../src/QuoteAssetCreatorFeeHookV1.sol";
import { QuoteAssetFeeSplitVaultFactoryV1 } from "../src/QuoteAssetFeeSplitVaultFactoryV1.sol";
import {
    IUniswapV3FactoryLikeV3,
    IUniswapV3SwapRouterLikeV3,
    StockPairedEthLaunchCoordinatorV3
} from "../src/StockPairedEthLaunchCoordinatorV3.sol";
import { StockPairedLaunchV3 } from "../src/StockPairedLaunchV3.sol";
import { StockPairedPositionPlannerV3 } from "../src/StockPairedPositionPlannerV3.sol";
import { StockQuoteRegistryV1 } from "../src/StockQuoteRegistryV1.sol";

interface IUniswapV3PoolLikeStockPairedV3 {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        );
}

/// @title DeployMainnetStockPairedInfrastructureV3
/// @notice Deterministic, fail-closed three-transaction deployment path for Stock-Paired V3 on Ethereum Mainnet.
/// @dev Reuses the reviewed ownerless registry, shared fee hook and custody factories. A normal Forge run only
///      simulates. Broadcasting still requires an explicit `--broadcast` flag and an operator-controlled signer.
contract DeployMainnetStockPairedInfrastructureV3 is Script {
    uint256 internal constant MAINNET_CHAIN_ID = 1;
    uint256 internal constant EIP170_RUNTIME_LIMIT = 24_576;
    uint256 internal constant PRICE_RATIO_SCALE = 1_000_000_000;
    uint256 internal constant Q96 = 0x1000000000000000000000000;
    uint16 public constant MAX_CURRENT_PRICE_DRIFT_BPS = 500;
    uint256 public constant CLASSIC_TARGET_FDV_WEI = 1.355_657_760_817_103_798 ether;
    uint256 public constant PRICE_CALIBRATION_BLOCK = 25_642_460;
    bytes32 public constant PRICE_CALIBRATION_BLOCK_HASH =
        0xefb6c45e3523ffc588d4c498cd6fd5ab528371f293eebc70375857a53fe12718;

    address public constant REVIEWED_DEPLOYER = 0x2Bb333d48DFAF1596D9036671d2E43168994249E;
    uint64 public constant REVIEWED_STARTING_NONCE = 126;
    address public constant REVIEWED_POSITION_PLANNER = 0x92555fb6d357f95fdBc5AAAEC55912626297782D;
    address public constant REVIEWED_LAUNCHER = 0x0573879f72d8eE8B0e5a4Ec5E8bcDb2fCab9E51c;
    address public constant REVIEWED_ETH_LAUNCH_COORDINATOR = 0xdDC3ABbAB0df7F1189310a4f70e7e365796B74E2;

    address public constant LAUNCHER_TREASURY = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    address public constant POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address public constant POSITION_MANAGER = 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e;
    address public constant STATE_VIEW = 0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227;
    address public constant V4_QUOTER = 0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203;
    address public constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address public constant UNIVERSAL_ROUTER = 0x4C82D1fBFe28C977cBB58D8C7FF8FCF9F70a2cCA;
    address public constant UERC20_FACTORY = 0x000000e200088D55C39a11F609E5F667729ad49b;
    address public constant POSITION_FORWARDER_FACTORY = 0x291a9ff1059d225d02B1659430804486404dB507;

    address public constant V3_FACTORY = 0x1F98431c8aD98523631AE4a59f267346ea31F984;
    address public constant V3_SWAP_ROUTER = 0xE592427A0AEce92De3Edee1F18E0157C05861564;
    address public constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address public constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address public constant WETH_USDC_POOL = 0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640;
    address public constant QQQ = 0x0e397938C1Aa0680954093495B70A9F5e2249aBa;

    StockQuoteRegistryV1 public constant QUOTE_REGISTRY =
        StockQuoteRegistryV1(0xd38Fbc171C1a842dc3F6d10cf5642BAe097D9239);
    QuoteAssetFeeSplitVaultFactoryV1 public constant FEE_SPLIT_VAULT_FACTORY =
        QuoteAssetFeeSplitVaultFactoryV1(0x52d70971D6653a754c29385a2a6f241A481952d4);
    QuoteAssetCreatorFeeHookFactoryV1 public constant HOOK_FACTORY =
        QuoteAssetCreatorFeeHookFactoryV1(0x5C2704C6eEaA2063d7a969BA7E557c87AEb1fBcB);
    QuoteAssetCreatorFeeHookV1 public constant FEE_HOOK =
        QuoteAssetCreatorFeeHookV1(0x90c67C1E866f86526F0e338459cD435E1F23A0cc);

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

    bytes32 public constant V3_FACTORY_CODE_HASH = 0x4d7b8525cd5d14343fa67a732fba5b24cddba11620ca88392f4ec6c52f91fd69;
    bytes32 public constant V3_SWAP_ROUTER_CODE_HASH =
        0xbb90113d2f9a5e9b7feb15a1d1fff06c1ee1575b3f9b1181778ffd0cf633e7ea;
    bytes32 public constant WETH_CODE_HASH = 0xd0a06b12ac47863b5c7be4185c2deaad1c61557033f56c7d4ea74429cbb25e23;
    bytes32 public constant USDC_CODE_HASH = 0xd80d4b7c890cb9d6a4893e6b52bc34b56b25335cb13716e0d1d31383e6b41505;
    bytes32 public constant WETH_USDC_POOL_CODE_HASH =
        0xa981b66c747a3d9fa29d7e200d5faaa2826960523d0e5a0df8148e8868c480b4;

    bytes32 public constant QUOTE_REGISTRY_CODE_HASH =
        0xdc64e2b2eb251347649c527f3d143b1a2d41312b90c6718f13c3ff7ea07f7e4f;
    bytes32 public constant FEE_SPLIT_VAULT_FACTORY_CODE_HASH =
        0x14a1e46cbb829712c7ba64ce018537aed9385d6116b939ef3d355fa2fdc0f2b6;
    bytes32 public constant HOOK_FACTORY_CODE_HASH = 0x6f4fb8e100039d4f9dd488f625b7ecb2e8d4d389b914d9031c6c5e6b228ad79d;
    bytes32 public constant FEE_HOOK_CODE_HASH = 0x3e292c9ddc64cc3a9c45f79d9d239ab2b8196f10efbdbc74b4f9b37dba53981d;
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
        address positionPlanner;
        address launcher;
        address ethLaunchCoordinator;
        bytes32 sourceCommitment;
        bytes32 economicsCommitment;
        bytes32 priceCommitment;
    }

    struct DeploymentResult {
        StockPairedPositionPlannerV3 positionPlanner;
        StockPairedLaunchV3 launcher;
        StockPairedEthLaunchCoordinatorV3 ethLaunchCoordinator;
        bytes32 sourceCommitment;
        bytes32 economicsCommitment;
        bytes32 priceCommitment;
        bytes32 preDeploymentPriceObservation;
        bytes32 postDeploymentPriceObservation;
        uint64 startingNonce;
    }

    error CurrentPriceDriftExceeded(address quoteAsset, uint256 actualRootRatio, uint256 minimum, uint256 maximum);
    error DeploymentAddressOccupied(address target);
    error InvalidBroadcaster(address broadcaster);
    error InvalidPriceObservation(address pool);
    error UnexpectedAddress(bytes32 field, address actual, address expected);
    error UnexpectedChain(uint256 actual, uint256 expected);
    error UnexpectedCodeHash(address target, bytes32 actual, bytes32 expected);
    error UnexpectedCommitment(bytes32 field, bytes32 actual, bytes32 expected);
    error UnexpectedHookFlags(uint160 actual, uint160 expected);
    error UnexpectedNonce(address broadcaster, uint64 actual, uint64 expected);
    error UnexpectedSymbol(address token, bytes32 actual, bytes32 expected);
    error UnexpectedTreasury(address actual, address expected);
    error UnexpectedValue(bytes32 field, uint256 actual, uint256 expected);

    /// @notice Simulates or broadcasts the reviewed three-transaction sequence.
    /// @dev Required environment: STOCK_PAIRED_V3_MAINNET_DEPLOYER, STOCK_PAIRED_V3_MAINNET_START_NONCE,
    ///      STOCK_PAIRED_V3_MAINNET_TREASURY and STOCK_PAIRED_V3_PRICE_COMMITMENT.
    function run() external returns (DeploymentResult memory result) {
        address broadcaster = vm.envAddress("STOCK_PAIRED_V3_MAINNET_DEPLOYER");
        address configuredTreasury = vm.envAddress("STOCK_PAIRED_V3_MAINNET_TREASURY");
        uint256 configuredNonce = vm.envUint("STOCK_PAIRED_V3_MAINNET_START_NONCE");
        bytes32 configuredPriceCommitment = vm.envBytes32("STOCK_PAIRED_V3_PRICE_COMMITMENT");
        if (configuredNonce > type(uint64).max) {
            revert UnexpectedValue(keccak256("startingNonce"), configuredNonce, type(uint64).max);
        }
        bytes32 reviewedPriceCommitment = priceCommitment();
        if (configuredPriceCommitment != reviewedPriceCommitment) {
            revert UnexpectedCommitment(
                keccak256("priceCommitment"), configuredPriceCommitment, reviewedPriceCommitment
            );
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
        validateSharedDependencies();
        if (broadcaster == address(0)) revert InvalidBroadcaster(broadcaster);
        _assertAddress(keccak256("broadcaster"), broadcaster, REVIEWED_DEPLOYER);
        _assertValue(keccak256("startingNonce"), startingNonce, REVIEWED_STARTING_NONCE);
        if (configuredTreasury != LAUNCHER_TREASURY) {
            revert UnexpectedTreasury(configuredTreasury, LAUNCHER_TREASURY);
        }

        uint64 actualNonce = vm.getNonce(broadcaster);
        if (actualNonce != startingNonce) revert UnexpectedNonce(broadcaster, actualNonce, startingNonce);

        DeploymentPlan memory plan = deploymentPlan(broadcaster, startingNonce);
        _assertAddress(keccak256("reviewed.positionPlanner"), plan.positionPlanner, REVIEWED_POSITION_PLANNER);
        _assertAddress(keccak256("reviewed.launcher"), plan.launcher, REVIEWED_LAUNCHER);
        _assertAddress(
            keccak256("reviewed.ethLaunchCoordinator"), plan.ethLaunchCoordinator, REVIEWED_ETH_LAUNCH_COORDINATOR
        );
        _assertVacant(plan.positionPlanner);
        _assertVacant(plan.launcher);
        _assertVacant(plan.ethLaunchCoordinator);
        result.preDeploymentPriceObservation = validateCurrentPriceDrift();

        vm.startBroadcast(broadcaster);
        result.positionPlanner = new StockPairedPositionPlannerV3();
        result.launcher = new StockPairedLaunchV3(
            IPoolManager(POOL_MANAGER),
            IPositionManager(POSITION_MANAGER),
            UERC20Factory(UERC20_FACTORY),
            FEE_HOOK,
            QUOTE_REGISTRY,
            result.positionPlanner,
            FEE_SPLIT_VAULT_FACTORY,
            LockedPositionFeeForwarderFactoryV1(POSITION_FORWARDER_FACTORY),
            _priceConfiguration()
        );
        result.ethLaunchCoordinator = new StockPairedEthLaunchCoordinatorV3(
            result.launcher,
            IUniswapV3SwapRouterLikeV3(V3_SWAP_ROUTER),
            IUniswapV3FactoryLikeV3(V3_FACTORY),
            WETH,
            USDC,
            _launchAssets(),
            _stockPoolFees()
        );
        vm.stopBroadcast();

        _assertAddress(keccak256("positionPlanner"), address(result.positionPlanner), plan.positionPlanner);
        _assertAddress(keccak256("launcher"), address(result.launcher), plan.launcher);
        _assertAddress(
            keccak256("ethLaunchCoordinator"), address(result.ethLaunchCoordinator), plan.ethLaunchCoordinator
        );

        result.sourceCommitment = plan.sourceCommitment;
        result.economicsCommitment = plan.economicsCommitment;
        result.priceCommitment = plan.priceCommitment;
        result.startingNonce = startingNonce;
        _validateDeployedStack(result);
        result.postDeploymentPriceObservation = validateCurrentPriceDrift();

        uint64 finalNonce = vm.getNonce(broadcaster);
        if (finalNonce != startingNonce + 3) {
            revert UnexpectedNonce(broadcaster, finalNonce, startingNonce + 3);
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
        plan.positionPlanner = vm.computeCreateAddress(broadcaster, startingNonce);
        plan.launcher = vm.computeCreateAddress(broadcaster, uint256(startingNonce) + 1);
        plan.ethLaunchCoordinator = vm.computeCreateAddress(broadcaster, uint256(startingNonce) + 2);
        plan.sourceCommitment = deploymentSourceCommitment();
        plan.economicsCommitment = economicsCommitment();
        plan.priceCommitment = priceCommitment();
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
        _assertCodeHash(V3_FACTORY, V3_FACTORY_CODE_HASH);
        _assertCodeHash(V3_SWAP_ROUTER, V3_SWAP_ROUTER_CODE_HASH);
        _assertCodeHash(WETH, WETH_CODE_HASH);
        _assertCodeHash(USDC, USDC_CODE_HASH);
        _assertCodeHash(WETH_USDC_POOL, WETH_USDC_POOL_CODE_HASH);

        _assertAddress(
            keccak256("v3SwapRouter.factory"), IUniswapV3SwapRouterLikeV3(V3_SWAP_ROUTER).factory(), V3_FACTORY
        );
        _assertAddress(keccak256("v3SwapRouter.WETH9"), IUniswapV3SwapRouterLikeV3(V3_SWAP_ROUTER).WETH9(), WETH);
        _assertPool(WETH_USDC_POOL, WETH, USDC, 500, WETH_USDC_POOL_CODE_HASH);

        address[6] memory assets = _launchAssetsFixed();
        address[6] memory pools = _stockPools();
        uint24[6] memory fees = _stockPoolFeesFixed();
        bytes32[6] memory codeHashes = _stockPoolCodeHashes();
        for (uint256 index; index < assets.length; index++) {
            _assertPool(pools[index], USDC, assets[index], fees[index], codeHashes[index]);
            _assertAddress(
                keccak256(abi.encode("v3Factory.stockPool", assets[index])),
                IUniswapV3FactoryLikeV3(V3_FACTORY).getPool(USDC, assets[index], fees[index]),
                pools[index]
            );
        }
    }

    function validateSharedDependencies() public view {
        _assertCodeHash(address(QUOTE_REGISTRY), QUOTE_REGISTRY_CODE_HASH);
        _assertCodeHash(address(FEE_SPLIT_VAULT_FACTORY), FEE_SPLIT_VAULT_FACTORY_CODE_HASH);
        _assertCodeHash(address(HOOK_FACTORY), HOOK_FACTORY_CODE_HASH);
        _assertCodeHash(address(FEE_HOOK), FEE_HOOK_CODE_HASH);
        _assertCodeHash(POSITION_FORWARDER_FACTORY, POSITION_FORWARDER_FACTORY_CODE_HASH);
        _assertCodeHash(ONDO_BEACON, ONDO_BEACON_CODE_HASH);
        _assertCodeHash(ONDO_IMPLEMENTATION, ONDO_IMPLEMENTATION_CODE_HASH);

        _assertAddress(keccak256("quoteRegistry.beacon"), QUOTE_REGISTRY.beacon(), ONDO_BEACON);
        _assertAddress(
            keccak256("quoteRegistry.implementation"), QUOTE_REGISTRY.reviewedImplementation(), ONDO_IMPLEMENTATION
        );
        _assertAddress(
            keccak256("ondo.beaconImplementation"), IBeacon(ONDO_BEACON).implementation(), ONDO_IMPLEMENTATION
        );
        _assertCommitment(
            keccak256("quoteRegistry.tokenCodeHash"), QUOTE_REGISTRY.expectedTokenCodeHash(), ONDO_TOKEN_CODE_HASH
        );
        _assertValue(keccak256("quoteRegistry.assetCount"), QUOTE_REGISTRY.assetCount(), 11);

        address[] memory registryAssets = _registryAssets();
        bytes32[] memory symbols = _symbolHashes();
        for (uint256 index; index < registryAssets.length; index++) {
            address asset = registryAssets[index];
            _assertAddress(keccak256(abi.encode("quoteRegistry.assetAt", index)), QUOTE_REGISTRY.assetAt(index), asset);
            if (!QUOTE_REGISTRY.isSupported(asset)) {
                revert UnexpectedAddress(keccak256(abi.encode("quoteRegistry.support", asset)), address(0), asset);
            }
            bytes32 actualSymbol = keccak256(bytes(IERC20Metadata(asset).symbol()));
            if (actualSymbol != symbols[index]) revert UnexpectedSymbol(asset, actualSymbol, symbols[index]);
            _assertValue(keccak256(abi.encode("quoteAsset.decimals", asset)), IERC20Metadata(asset).decimals(), 18);
            _assertCodeHash(asset, ONDO_TOKEN_CODE_HASH);
            bytes32 assetConfigurationHash = QUOTE_REGISTRY.assertAssetReady(asset);
            if (assetConfigurationHash == bytes32(0)) {
                revert UnexpectedCommitment(
                    keccak256(abi.encode("quoteRegistry.assetConfiguration", asset)), bytes32(0), bytes32(uint256(1))
                );
            }
        }

        _assertAddress(keccak256("hook.poolManager"), address(FEE_HOOK.poolManager()), POOL_MANAGER);
        _assertAddress(keccak256("hook.launcherFeeRecipient"), FEE_HOOK.launcherFeeRecipient(), LAUNCHER_TREASURY);
        _assertAddress(keccak256("hook.quoteRegistry"), address(FEE_HOOK.quoteRegistry()), address(QUOTE_REGISTRY));
        _assertAddress(
            keccak256("hook.feeSplitVaultFactory"),
            address(FEE_HOOK.feeSplitVaultFactory()),
            address(FEE_SPLIT_VAULT_FACTORY)
        );
        _assertValue(keccak256("hook.totalSwapFeeBps"), FEE_HOOK.TOTAL_SWAP_FEE_BPS(), 100);
        _assertValue(keccak256("hook.creatorFeeBps"), FEE_HOOK.CREATOR_FEE_BPS(), 90);
        _assertValue(keccak256("hook.launcherFeeBps"), FEE_HOOK.LAUNCHER_FEE_BPS(), 10);
        _assertValue(keccak256("hook.transferTaxBps"), FEE_HOOK.TRANSFER_TAX_BPS(), 0);
        _assertValue(keccak256("hook.lpFeePips"), FEE_HOOK.LP_FEE_PIPS(), 0);
        _assertValue(keccak256("hook.tickSpacing"), uint24(FEE_HOOK.TICK_SPACING()), 200);

        uint160 actualFlags = uint160(address(FEE_HOOK)) & HOOK_FACTORY.ALL_HOOK_MASK();
        if (actualFlags != REQUIRED_HOOK_FLAGS) revert UnexpectedHookFlags(actualFlags, REQUIRED_HOOK_FLAGS);
        if (!HOOK_FACTORY.isFactoryHook(address(FEE_HOOK))) {
            revert UnexpectedAddress(keccak256("hookFactory.provenance"), address(0), address(FEE_HOOK));
        }
        _assertAddress(
            keccak256("positionForwarderFactory.positionManager"),
            address(LockedPositionFeeForwarderFactoryV1(POSITION_FORWARDER_FACTORY).positionManager()),
            POSITION_MANAGER
        );
    }

    /// @notice Rechecks current official v3 pool midprices against the immutable five-percent activation envelope.
    /// @dev The envelope incorporates each tick's small calibration drift from the exact Classic target. QQQ is
    ///      intentionally absent. This deployment gate is not an oracle used by launched pools.
    function validateCurrentPriceDrift() public view returns (bytes32 observationCommitment) {
        (uint160 wethUsdcSqrtPriceX96,,,,,,) = IUniswapV3PoolLikeStockPairedV3(WETH_USDC_POOL).slot0();
        if (wethUsdcSqrtPriceX96 == 0) revert InvalidPriceObservation(WETH_USDC_POOL);

        address[6] memory assets = _launchAssetsFixed();
        address[6] memory pools = _stockPools();
        uint160[6] memory referenceStockSqrtPrices = _referenceStockSqrtPrices();
        uint256[6] memory minimumRootRatios = _minimumRootRatios();
        uint256[6] memory maximumRootRatios = _maximumRootRatios();
        uint160[6] memory observedStockSqrtPrices;

        for (uint256 index; index < assets.length; index++) {
            (uint160 currentStockSqrtPriceX96,,,,,,) = IUniswapV3PoolLikeStockPairedV3(pools[index]).slot0();
            if (currentStockSqrtPriceX96 == 0) revert InvalidPriceObservation(pools[index]);
            observedStockSqrtPrices[index] = currentStockSqrtPriceX96;

            uint256 currentRootMetric =
                _quotePerEthRootMetric(assets[index], wethUsdcSqrtPriceX96, currentStockSqrtPriceX96);
            uint256 referenceRootMetric = _quotePerEthRootMetric(
                assets[index], _referenceWethUsdcSqrtPriceX96(), referenceStockSqrtPrices[index]
            );
            uint256 actualRootRatio = FullMath.mulDiv(currentRootMetric, PRICE_RATIO_SCALE, referenceRootMetric);
            if (actualRootRatio < minimumRootRatios[index] || actualRootRatio > maximumRootRatios[index]) {
                revert CurrentPriceDriftExceeded(
                    assets[index], actualRootRatio, minimumRootRatios[index], maximumRootRatios[index]
                );
            }
        }

        observationCommitment = keccak256(
            abi.encode(
                block.chainid,
                block.number,
                WETH_USDC_POOL,
                wethUsdcSqrtPriceX96,
                pools,
                observedStockSqrtPrices,
                priceCommitment()
            )
        );
    }

    function deploymentSourceCommitment() public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("programmable.stock-paired.infrastructure.v3.ethereum"),
                _bytecodeCommitment(),
                _dependencyCommitment(),
                economicsCommitment(),
                priceCommitment()
            )
        );
    }

    function economicsCommitment() public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                uint256(1_000_000_000 ether),
                uint256(0.01 ether),
                uint256(100),
                uint256(90),
                uint256(10),
                uint256(0),
                int256(200),
                uint256(8),
                uint256(10_000),
                keccak256("fixed-supply"),
                keccak256("permanently-locked-one-sided-position"),
                keccak256("atomic-eth-to-quote-to-initial-token-buy"),
                keccak256("immutable-beneficiaries-and-shares"),
                keccak256("beneficiary-authorized-claim-and-payout-update")
            )
        );
    }

    function priceCommitment() public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("programmable.stock-paired.price-policy.v3"),
                _priceCalibrationCommitment(),
                _priceRouteCommitment(),
                _priceBoundsCommitment(),
                keccak256("qqq-unsupported-unlaunchable")
            )
        );
    }

    function _priceCalibrationCommitment() private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                CLASSIC_TARGET_FDV_WEI,
                PRICE_CALIBRATION_BLOCK,
                PRICE_CALIBRATION_BLOCK_HASH,
                MAX_CURRENT_PRICE_DRIFT_BPS,
                _targetQuoteFdvRaw(),
                _tickImpliedQuoteFdvRaw()
            )
        );
    }

    function _priceRouteCommitment() private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                WETH_USDC_POOL,
                _referenceWethUsdcSqrtPriceX96(),
                _launchAssetsFixed(),
                _initialAbsoluteTicks(),
                _stockPools(),
                _stockPoolFeesFixed(),
                _referenceStockSqrtPrices()
            )
        );
    }

    function _priceBoundsCommitment() private pure returns (bytes32) {
        return keccak256(abi.encode(_minimumRootRatios(), _maximumRootRatios()));
    }

    function _bytecodeCommitment() private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(type(StockPairedPositionPlannerV3).creationCode),
                keccak256(type(StockPairedLaunchV3).creationCode),
                keccak256(type(StockPairedEthLaunchCoordinatorV3).creationCode)
            )
        );
    }

    function _dependencyCommitment() private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                _officialDependencyCommitment(),
                _sharedDependencyCommitment(),
                _routeDependencyCommitment(),
                LAUNCHER_TREASURY
            )
        );
    }

    function _officialDependencyCommitment() private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(
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
                ),
                keccak256(
                    abi.encode(
                        PERMIT2,
                        PERMIT2_CODE_HASH,
                        UNIVERSAL_ROUTER,
                        UNIVERSAL_ROUTER_CODE_HASH,
                        UERC20_FACTORY,
                        UERC20_FACTORY_CODE_HASH
                    )
                )
            )
        );
    }

    function _sharedDependencyCommitment() private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(
                    abi.encode(
                        address(QUOTE_REGISTRY),
                        QUOTE_REGISTRY_CODE_HASH,
                        address(FEE_SPLIT_VAULT_FACTORY),
                        FEE_SPLIT_VAULT_FACTORY_CODE_HASH,
                        address(HOOK_FACTORY),
                        HOOK_FACTORY_CODE_HASH,
                        address(FEE_HOOK),
                        FEE_HOOK_CODE_HASH
                    )
                ),
                keccak256(
                    abi.encode(
                        POSITION_FORWARDER_FACTORY,
                        POSITION_FORWARDER_FACTORY_CODE_HASH,
                        ONDO_BEACON,
                        ONDO_BEACON_CODE_HASH,
                        ONDO_IMPLEMENTATION,
                        ONDO_IMPLEMENTATION_CODE_HASH,
                        ONDO_TOKEN_CODE_HASH
                    )
                ),
                keccak256(abi.encode(_registryAssets(), _symbolHashes()))
            )
        );
    }

    function _routeDependencyCommitment() private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(
                    abi.encode(
                        V3_FACTORY,
                        V3_FACTORY_CODE_HASH,
                        V3_SWAP_ROUTER,
                        V3_SWAP_ROUTER_CODE_HASH,
                        WETH,
                        WETH_CODE_HASH,
                        USDC,
                        USDC_CODE_HASH,
                        WETH_USDC_POOL,
                        WETH_USDC_POOL_CODE_HASH
                    )
                ),
                keccak256(
                    abi.encode(_launchAssetsFixed(), _stockPools(), _stockPoolFeesFixed(), _stockPoolCodeHashes())
                )
            )
        );
    }

    function _validateDeployedStack(DeploymentResult memory result) private view {
        _assertCodeHash(address(result.positionPlanner), keccak256(type(StockPairedPositionPlannerV3).runtimeCode));
        _assertRuntimeWithinLimit(address(result.positionPlanner));
        _assertRuntimeWithinLimit(address(result.launcher));
        _assertRuntimeWithinLimit(address(result.ethLaunchCoordinator));
        _validateLauncher(result);
        _validateCoordinator(result);

        _assertCommitment(keccak256("result.sourceCommitment"), result.sourceCommitment, deploymentSourceCommitment());
        _assertCommitment(keccak256("result.economicsCommitment"), result.economicsCommitment, economicsCommitment());
        _assertCommitment(keccak256("result.priceCommitment"), result.priceCommitment, priceCommitment());
    }

    function _validateLauncher(DeploymentResult memory result) private view {
        _assertAddress(keccak256("launcher.poolManager"), address(result.launcher.poolManager()), POOL_MANAGER);
        _assertAddress(
            keccak256("launcher.positionManager"), address(result.launcher.positionManager()), POSITION_MANAGER
        );
        _assertAddress(keccak256("launcher.tokenFactory"), address(result.launcher.tokenFactory()), UERC20_FACTORY);
        _assertAddress(keccak256("launcher.feeHook"), address(result.launcher.feeHook()), address(FEE_HOOK));
        _assertAddress(
            keccak256("launcher.quoteRegistry"), address(result.launcher.quoteRegistry()), address(QUOTE_REGISTRY)
        );
        _assertAddress(
            keccak256("launcher.positionPlanner"),
            address(result.launcher.positionPlanner()),
            address(result.positionPlanner)
        );
        _assertAddress(
            keccak256("launcher.feeSplitVaultFactory"),
            address(result.launcher.feeSplitVaultFactory()),
            address(FEE_SPLIT_VAULT_FACTORY)
        );
        _assertAddress(
            keccak256("launcher.positionForwarderFactory"),
            address(result.launcher.positionForwarderFactory()),
            POSITION_FORWARDER_FACTORY
        );
        _assertValue(
            keccak256("launcher.minimumInitialBuyQuote"), result.launcher.MIN_INITIAL_BUY_QUOTE_AMOUNT(), 0.01 ether
        );
        _assertValue(keccak256("launcher.configuredQuoteAssetCount"), result.launcher.CONFIGURED_QUOTE_ASSET_COUNT(), 6);
        _assertValue(keccak256("launcher.tickSpacing"), uint24(result.launcher.TICK_SPACING()), 200);
        _assertValue(keccak256("launcher.lpFeePips"), result.launcher.LP_FEE_PIPS(), 0);

        address[6] memory assets = _launchAssetsFixed();
        int24[6] memory ticks = _initialAbsoluteTicks();
        for (uint256 index; index < assets.length; index++) {
            _assertAddress(
                keccak256(abi.encode("launcher.quoteAsset", index)),
                _launcherQuoteAsset(result.launcher, index),
                assets[index]
            );
            int24 actualTick = result.launcher.initialAbsoluteTickFor(assets[index]);
            if (actualTick != ticks[index]) {
                revert UnexpectedValue(
                    keccak256(abi.encode("launcher.initialAbsoluteTick", assets[index])),
                    uint24(actualTick),
                    uint24(ticks[index])
                );
            }
        }
        _assertCommitment(
            keccak256("launcher.priceConfigurationHash"),
            result.launcher.priceConfigurationHash(),
            keccak256(abi.encode(assets, ticks))
        );
        _assertQqqUnlaunchable(result.launcher);
    }

    function _validateCoordinator(DeploymentResult memory result) private view {
        _assertAddress(
            keccak256("coordinator.launcher"), address(result.ethLaunchCoordinator.launcher()), address(result.launcher)
        );
        _assertAddress(
            keccak256("coordinator.v3SwapRouter"), address(result.ethLaunchCoordinator.v3SwapRouter()), V3_SWAP_ROUTER
        );
        _assertAddress(keccak256("coordinator.v3Factory"), address(result.ethLaunchCoordinator.v3Factory()), V3_FACTORY);
        _assertAddress(keccak256("coordinator.weth"), result.ethLaunchCoordinator.weth(), WETH);
        _assertAddress(keccak256("coordinator.usdc"), result.ethLaunchCoordinator.usdc(), USDC);
        address[6] memory assets = _launchAssetsFixed();
        uint24[6] memory fees = _stockPoolFeesFixed();
        for (uint256 index; index < assets.length; index++) {
            _assertValue(
                keccak256(abi.encode("coordinator.stockPoolFee", assets[index])),
                result.ethLaunchCoordinator.stockPoolFee(assets[index]),
                fees[index]
            );
            bytes memory expectedPath = abi.encodePacked(WETH, uint24(500), USDC, fees[index], assets[index]);
            _assertCommitment(
                keccak256(abi.encode("coordinator.routePath", assets[index])),
                keccak256(result.ethLaunchCoordinator.routePath(assets[index])),
                keccak256(expectedPath)
            );
        }
    }

    function _assertQqqUnlaunchable(StockPairedLaunchV3 launcher) private view {
        if (QUOTE_REGISTRY.isSupported(QQQ)) {
            revert UnexpectedAddress(keccak256("quoteRegistry.qqqUnsupported"), QQQ, address(0));
        }
        bool rejected;
        try launcher.initialAbsoluteTickFor(QQQ) returns (int24 configuredTick) {
            configuredTick;
        } catch {
            rejected = true;
        }
        if (!rejected) {
            revert UnexpectedAddress(keccak256("launcher.qqqUnlaunchable"), QQQ, address(0));
        }
    }

    function _launcherQuoteAsset(StockPairedLaunchV3 launcher, uint256 index) private view returns (address) {
        if (index == 0) return launcher.quoteAsset0();
        if (index == 1) return launcher.quoteAsset1();
        if (index == 2) return launcher.quoteAsset2();
        if (index == 3) return launcher.quoteAsset3();
        if (index == 4) return launcher.quoteAsset4();
        return launcher.quoteAsset5();
    }

    function _assertPool(address pool, address assetA, address assetB, uint24 fee, bytes32 codeHash) private view {
        _assertCodeHash(pool, codeHash);
        (address expectedToken0, address expectedToken1) = assetA < assetB ? (assetA, assetB) : (assetB, assetA);
        _assertAddress(
            keccak256(abi.encode("v3Pool.token0", pool)), IUniswapV3PoolLikeStockPairedV3(pool).token0(), expectedToken0
        );
        _assertAddress(
            keccak256(abi.encode("v3Pool.token1", pool)), IUniswapV3PoolLikeStockPairedV3(pool).token1(), expectedToken1
        );
        _assertValue(keccak256(abi.encode("v3Pool.fee", pool)), IUniswapV3PoolLikeStockPairedV3(pool).fee(), fee);
    }

    function _quotePerEthRootMetric(address quoteAsset, uint160 wethUsdcSqrtPriceX96, uint160 stockSqrtPriceX96)
        private
        pure
        returns (uint256)
    {
        if (quoteAsset > USDC) {
            // Both pools have USDC as currency0: sqrt(quote / ETH) = stockSqrt / wethSqrt.
            return FullMath.mulDiv(uint256(stockSqrtPriceX96), Q96, uint256(wethUsdcSqrtPriceX96));
        }

        // The stock pool has the quote asset as currency0:
        // sqrt(quote / ETH) = 1 / (sqrt(ETH / USDC) * sqrt(USDC / quote)).
        uint256 ethPerQuoteRootX96 = FullMath.mulDiv(uint256(wethUsdcSqrtPriceX96), uint256(stockSqrtPriceX96), Q96);
        if (ethPerQuoteRootX96 == 0) revert InvalidPriceObservation(address(0));
        return FullMath.mulDiv(Q96, Q96, ethPerQuoteRootX96);
    }

    function _priceConfiguration() private pure returns (StockPairedLaunchV3.PriceConfiguration memory configuration) {
        configuration.quoteAssets = _launchAssetsFixed();
        configuration.initialAbsoluteTicks = _initialAbsoluteTicks();
    }

    function _launchAssets() private pure returns (address[] memory values) {
        address[6] memory fixedValues = _launchAssetsFixed();
        values = new address[](fixedValues.length);
        for (uint256 index; index < fixedValues.length; index++) {
            values[index] = fixedValues[index];
        }
    }

    function _stockPoolFees() private pure returns (uint24[] memory values) {
        uint24[6] memory fixedValues = _stockPoolFeesFixed();
        values = new uint24[](fixedValues.length);
        for (uint256 index; index < fixedValues.length; index++) {
            values[index] = fixedValues[index];
        }
    }

    function _launchAssetsFixed() private pure returns (address[6] memory values) {
        values = [
            address(0x2D1F7226Bd1F780AF6B9A49DCC0aE00E8Df4bDEE),
            address(0xFeDC5f4a6c38211c1338aa411018DFAf26612c08),
            address(0xbA47214eDd2bb43099611b208f75E4b42FDcfEDc),
            address(0xF3e4872e6a4cF365888D93b6146a2bAA7348F1A4),
            address(0xf6b1117ec07684D3958caD8BEb1b302bfD21103f),
            address(0x14c3abF95Cb9C93a8b82C1CdCB76D72Cb87b2d4c)
        ];
    }

    function _initialAbsoluteTicks() private pure returns (int24[6] memory values) {
        values = [int24(181_200), int24(194_600), int24(186_800), int24(168_200), int24(185_600), int24(187_000)];
    }

    function _stockPools() private pure returns (address[6] memory values) {
        values = [
            address(0xf5294094BCe435bFbd0eC488be5C462aAF32Bc7A),
            address(0x5638bbDE046EC2EFC7C8f3fd8DC5A9A1016f7EEB),
            address(0x39FCB1935f6Ccb0A106D05eB928205C59646af57),
            address(0xEeb8F880EAd7281A301ef2E6791A6bBe790603eD),
            address(0x31227b50eCCDC9C589826AA2D9E7C5619B1895Da),
            address(0xad82C9EB065a5CFed71DB087e4a52C8a09c69921)
        ];
    }

    function _stockPoolFeesFixed() private pure returns (uint24[6] memory values) {
        values = [uint24(10_000), uint24(3000), uint24(10_000), uint24(10_000), uint24(10_000), uint24(10_000)];
    }

    function _stockPoolCodeHashes() private pure returns (bytes32[6] memory values) {
        values = [
            bytes32(0x0c488df5bd90182f1e19b3c300eab4f99ab3c68d756250fd22589441b7c67e06),
            bytes32(0x9ce9b74c4e3e51f9bcf2ad9d28f09df179f96f7d17e423aa9207a69dc1558252),
            bytes32(0x1d93fa3dcce7502a231f47d3c9fcf22545d604735365a13d2b5823abd5ec85ee),
            bytes32(0x78981bb1657e3a587ec8a74460e263f638f051511c62431b090277d38698ea79),
            bytes32(0x8924e50b838c5e1ee3ec68c18a41e29c4d1403a03384f900c5659184e00d03d9),
            bytes32(0x1ef0d1ec03b74d0240a743a2ac44941fad4401a3600a219afdc25f6b3d816b2a)
        ];
    }

    function _referenceWethUsdcSqrtPriceX96() private pure returns (uint160) {
        return 1_811_374_274_676_982_379_548_779_438_342_942;
    }

    function _referenceStockSqrtPrices() private pure returns (uint160[6] memory values) {
        values = [
            uint160(1_097_232_669_160_320_469_452_120),
            uint160(2_916_328_541_485_761_273_243_512_415_623_187),
            uint160(4_333_169_358_295_491_299_367_655_972_972_817),
            uint160(10_945_964_930_190_207_783_395_284_454_387_554),
            uint160(4_606_653_194_514_316_027_371_695_360_813_116),
            uint160(1_463_596_069_436_987_983_672_637)
        ];
    }

    function _targetQuoteFdvRaw() private pure returns (uint256[6] memory values) {
        values = [
            uint256(13_522_423_984_475_316_997),
            uint256(3_514_038_942_016_415_531),
            uint256(7_757_914_703_760_536_694),
            uint256(49_504_169_414_249_328_797),
            uint256(8_768_084_165_472_772_643),
            uint256(7_599_929_078_251_473_378)
        ];
    }

    function _tickImpliedQuoteFdvRaw() private pure returns (uint256[6] memory values) {
        values = [
            uint256(13_520_023_064_276_052_820),
            uint256(3_540_396_661_305_328_988),
            uint256(7_722_975_943_643_816_421),
            uint256(49_605_751_312_209_836_038),
            uint256(8_707_578_819_134_800_530),
            uint256(7_570_058_343_489_581_718)
        ];
    }

    function _minimumRootRatios() private pure returns (uint256[6] memory values) {
        values = [
            uint256(975_813_434),
            uint256(979_553_198),
            uint256(973_700_048),
            uint256(976_900_827),
            uint256(972_527_079),
            uint256(973_980_348)
        ];
    }

    function _maximumRootRatios() private pure returns (uint256[6] memory values) {
        values = [
            uint256(1_025_887_266),
            uint256(1_029_818_936),
            uint256(1_023_665_432),
            uint256(1_027_030_459),
            uint256(1_022_432_273),
            uint256(1_023_960_116)
        ];
    }

    function _registryAssets() private pure returns (address[] memory values) {
        values = new address[](11);
        values[0] = 0x2D1F7226Bd1F780AF6B9A49DCC0aE00E8Df4bDEE;
        values[1] = 0xFeDC5f4a6c38211c1338aa411018DFAf26612c08;
        values[2] = 0xbA47214eDd2bb43099611b208f75E4b42FDcfEDc;
        values[3] = 0xF3e4872e6a4cF365888D93b6146a2bAA7348F1A4;
        values[4] = 0xf6b1117ec07684D3958caD8BEb1b302bfD21103f;
        values[5] = 0x14c3abF95Cb9C93a8b82C1CdCB76D72Cb87b2d4c;
        values[6] = 0x41765F0FCddC276309195166C7A62AE522FA09ef;
        values[7] = 0x423A63dfE8d82CD9C6568C92210AA537d8Ef6885;
        values[8] = 0x3632DEa96A953C11dac2f00b4A05a32CD1063fAE;
        values[9] = 0x992651BFeB9A0DCC4457610E284ba66D86489d4d;
        values[10] = 0x1F5fc5c3c8B0F15c7E21AF623936FF2b210b6415;
    }

    function _symbolHashes() private pure returns (bytes32[] memory values) {
        values = new bytes32[](11);
        values[0] = keccak256("NVDAon");
        values[1] = keccak256("SPYon");
        values[2] = keccak256("GOOGLon");
        values[3] = keccak256("SLVon");
        values[4] = keccak256("TSLAon");
        values[5] = keccak256("AAPLon");
        values[6] = keccak256("BABAon");
        values[7] = keccak256("COPXon");
        values[8] = keccak256("CRCLon");
        values[9] = keccak256("TLTon");
        values[10] = keccak256("USOon");
    }

    function _assertVacant(address target) private view {
        if (target.code.length != 0) revert DeploymentAddressOccupied(target);
    }

    function _assertRuntimeWithinLimit(address target) private view {
        uint256 runtimeBytes = target.code.length;
        if (runtimeBytes == 0 || runtimeBytes > EIP170_RUNTIME_LIMIT) {
            revert UnexpectedValue(keccak256(abi.encode("runtimeBytes", target)), runtimeBytes, EIP170_RUNTIME_LIMIT);
        }
    }

    function _assertCodeHash(address target, bytes32 expected) private view {
        bytes32 actual = target.codehash;
        if (actual != expected) revert UnexpectedCodeHash(target, actual, expected);
    }

    function _assertAddress(bytes32 field, address actual, address expected) private pure {
        if (actual != expected) revert UnexpectedAddress(field, actual, expected);
    }

    function _assertCommitment(bytes32 field, bytes32 actual, bytes32 expected) private pure {
        if (actual != expected) revert UnexpectedCommitment(field, actual, expected);
    }

    function _assertValue(bytes32 field, uint256 actual, uint256 expected) private pure {
        if (actual != expected) revert UnexpectedValue(field, actual, expected);
    }
}
