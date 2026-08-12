// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test, Vm } from "forge-std/Test.sol";
import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";
import { PoolManager } from "@uniswap/v4-core/src/PoolManager.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";

import { ProgrammableExactShardsRouteGatedFactoryV2 } from "../src/ProgrammableExactShardsRouteGatedFactoryV2.sol";
import { IProgrammableExactShardsLaunchFactoryV1 } from "../src/interfaces/IProgrammableExactShardsLaunchFactoryV1.sol";
import {
    IProgrammableExactShardsRouteGatedFactoryV2
} from "../src/interfaces/IProgrammableExactShardsRouteGatedFactoryV2.sol";
import { ShardHookV1 } from "shards-v1/src/ShardHookV1.sol";
import { ShardLaunchFactoryV1 } from "shards-v1/src/ShardLaunchFactoryV1.sol";
import { ShardNFTV1 } from "shards-v1/src/ShardNFTV1.sol";
import { ShardTokenV1 } from "shards-v1/src/ShardTokenV1.sol";

contract ReviewedShardsFactoryLaunchHarnessV1 {
    ProgrammableExactShardsRouteGatedFactoryV2 public immutable FACTORY;

    constructor(ProgrammableExactShardsRouteGatedFactoryV2 factory) {
        FACTORY = factory;
    }

    function launch(
        bytes32 tokenSalt,
        bytes32 hookSalt,
        bytes calldata hookCreationCode,
        IProgrammableExactShardsLaunchFactoryV1.LaunchParams calldata params
    ) external returns (address hook, address shard, address nft) {
        return FACTORY.launch(tokenSalt, hookSalt, hookCreationCode, params);
    }
}

contract ReviewedRendererMarkerV1 { }

/// @dev Metadata-only implementation used to place the exact wrapper predictor runtime at the fixed JS vector address.
contract ExactShardsPredictorGoldenMetadataV1 {
    function poolManager() external pure returns (address) {
        return 0x000000000004444c5dc75cB358380D2e3dE08A90;
    }

    function renderer() external pure returns (address) {
        return 0x2222222222222222222222222222222222222222;
    }

    function launcherFeeRecipient() external pure returns (address) {
        return 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    }

    function builderFeeRecipient() external pure returns (address) {
        return 0xceeBB3A6543CeBEB2ED66963897A0abEA52A50cC;
    }

    function hookCreationCodeHash() external pure returns (bytes32) {
        return 0x3fbdbc069ee5bfcb1ded77a8d4e550f1bb0692a488b6eb5d23dac090fbca0716;
    }
}

contract ReviewedShardsFactoryHarnessCoordinatorV1 {
    function deploy(address implementation, bytes32 implementationRuntimeCodeHash)
        external
        returns (ProgrammableExactShardsRouteGatedFactoryV2 factory, ReviewedShardsFactoryLaunchHarnessV1 harness)
    {
        address predictedFactory = _createAddress(address(this), 1);
        address predictedHarness = _createAddress(address(this), 2);
        factory = new ProgrammableExactShardsRouteGatedFactoryV2(
            implementation, implementationRuntimeCodeHash, predictedHarness
        );
        require(address(factory) == predictedFactory);
        harness = new ReviewedShardsFactoryLaunchHarnessV1(factory);
        require(address(harness) == predictedHarness);
    }

    function _createAddress(address deployer, uint8 nonce) private pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(hex"d694", deployer, nonce)))));
    }
}

contract ProgrammableExactShardsRouteGatedFactoryV2Test is Test {
    struct ConfigurationDataV1 {
        uint256 chainId;
        address factory;
        address poolManager;
        address renderer;
        address launcherFeeRecipient;
        address builderFeeRecipient;
        address shard;
        address hook;
        address nft;
        int24 tickLower;
        int24 tickBand;
        int24 tickUpper;
        uint160 startSqrtPriceX96;
        bytes32 tokenNameHash;
        bytes32 tokenSymbolHash;
        bytes32 nftNameHash;
        bytes32 nftSymbolHash;
        bytes32 tokenSalt;
        bytes32 effectiveTokenSalt;
        bytes32 hookSalt;
        bytes32 hookCreationCodeHash;
    }

    uint160 internal constant ALL_HOOK_MASK = uint160((1 << 14) - 1);
    uint160 internal constant REQUIRED_HOOK_FLAGS = uint160(
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
    );
    bytes32 internal constant SHARD_LAUNCHED_TOPIC =
        keccak256("ShardLaunched(address,address,address,bytes32,bytes32,address,address,bytes32)");

    ShardLaunchFactoryV1 internal implementation;
    ProgrammableExactShardsRouteGatedFactoryV2 internal factory;
    ReviewedShardsFactoryLaunchHarnessV1 internal harness;
    IProgrammableExactShardsLaunchFactoryV1.LaunchParams internal params;
    bytes internal hookCreationCode;
    bytes32 internal tokenSalt;
    bytes32 internal hookSalt;
    address internal predictedShard;
    address internal predictedHook;
    address internal predictedNft;

    function setUp() public {
        vm.chainId(1);
        IPoolManager manager = IPoolManager(address(new PoolManager(address(this))));
        hookCreationCode = type(ShardHookV1).creationCode;
        implementation = new ShardLaunchFactoryV1(manager, keccak256(hookCreationCode));
        ReviewedShardsFactoryHarnessCoordinatorV1 coordinator = new ReviewedShardsFactoryHarnessCoordinatorV1();
        (factory, harness) = coordinator.deploy(address(implementation), address(implementation).codehash);
        params = IProgrammableExactShardsLaunchFactoryV1.LaunchParams({
            tickLower: TickMath.minUsableTick(60),
            tickBand: 22_980,
            tickUpper: 115_080,
            startSqrtPriceX96: TickMath.getSqrtPriceAtTick(115_080),
            renderer: address(0),
            tokenName: "Website Shard",
            tokenSymbol: "WSHARD",
            nftName: "Website Shard Pieces",
            nftSymbol: "WSHARDN"
        });
        tokenSalt = keccak256("route-gated-token-salt");
        (hookSalt, predictedShard, predictedHook, predictedNft) = _mine(bytes32(0));
    }

    function test_exactReviewedImplementationExecutesOnlyThroughPinnedCallerAndPersistsConfiguration() public {
        IProgrammableExactShardsRouteGatedFactoryV2.LaunchPredictionV2 memory prediction =
            factory.predictLaunch(tokenSalt, hookSalt, hookCreationCode, params);
        assertEq(prediction.hook, predictedHook);
        assertEq(prediction.shard, predictedShard);
        assertEq(prediction.nft, predictedNft);
        assertEq(
            prediction.deploymentConfigurationHash, _configurationHash(predictedHook, predictedShard, predictedNft)
        );
        assertEq(
            prediction.innerCalldataKeccak256,
            factory.computeInnerExecutionCalldataKeccak256(tokenSalt, hookSalt, hookCreationCode, params)
        );
        assertTrue(factory.hasRequiredHookFlags(prediction.hook));
        vm.recordLogs();
        (address hook, address shard, address nft) = harness.launch(tokenSalt, hookSalt, hookCreationCode, params);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(hook, predictedHook);
        assertEq(shard, predictedShard);
        assertEq(nft, predictedNft);
        assertEq(ShardTokenV1(shard).name(), params.tokenName);
        assertEq(ShardTokenV1(shard).symbol(), params.tokenSymbol);
        assertEq(ShardHookV1(payable(hook)).deployer(), address(factory));
        assertEq(ShardTokenV1(shard).balanceOf(address(factory)), 0);
        assertEq(ShardNFTV1(nft).name(), params.nftName);
        assertEq(ShardNFTV1(nft).symbol(), params.nftSymbol);
        assertEq(address(ShardNFTV1(nft).renderer()), address(implementation.renderer()));
        assertEq(address(factory).balance, 0);
        assertEq(factory.configurationHashOf(hook), _configurationHash(hook, shard, nft));
        assertEq(implementation.configurationHashOf(hook), bytes32(0));
        _assertExactLaunchEvent(logs, hook, shard, nft, address(implementation.renderer()));
    }

    function test_javascriptPredictorGoldenMatchesExactSolidityFactorySurface() public {
        ExactShardsPredictorGoldenMetadataV1 metadata = new ExactShardsPredictorGoldenMetadataV1();
        ProgrammableExactShardsRouteGatedFactoryV2 template = new ProgrammableExactShardsRouteGatedFactoryV2(
            address(metadata), address(metadata).codehash, address(0xA11CE)
        );
        address goldenAddress = 0x1111111111111111111111111111111111111111;
        vm.etch(goldenAddress, address(template).code);
        ProgrammableExactShardsRouteGatedFactoryV2 golden =
            ProgrammableExactShardsRouteGatedFactoryV2(payable(goldenAddress));

        assertEq(
            keccak256(type(ShardTokenV1).creationCode),
            0xa6461c32c0121f0090519945d9c22ed6406a783994e020f72a20e85796cad107
        );
        assertEq(
            keccak256(type(ShardHookV1).creationCode),
            0x3fbdbc069ee5bfcb1ded77a8d4e550f1bb0692a488b6eb5d23dac090fbca0716
        );
        assertEq(
            keccak256(type(ShardNFTV1).creationCode), 0x888e18b33ff193b65eb61f44bc578d8d9365b505014af3782762a9d61fa39150
        );

        IProgrammableExactShardsLaunchFactoryV1.LaunchParams memory goldenParams =
            IProgrammableExactShardsLaunchFactoryV1.LaunchParams({
                tickLower: -887_220,
                tickBand: 22_980,
                tickUpper: 115_080,
                startSqrtPriceX96: 25_054_144_837_504_793_118_641_380_156_947,
                renderer: address(0),
                tokenName: "Website Shard",
                tokenSymbol: "WSHARD",
                nftName: "Website Shard Pieces",
                nftSymbol: "WSHARDN"
            });
        bytes32 goldenTokenSalt = 0xfe9ef1c901ff8ef4524c0b3f9a9aa5a5134bada183857dd44cbff850b3ca238f;
        bytes32 goldenHookSalt = bytes32(uint256(0x5e3f));
        IProgrammableExactShardsRouteGatedFactoryV2.LaunchPredictionV2 memory prediction =
            golden.predictLaunch(goldenTokenSalt, goldenHookSalt, type(ShardHookV1).creationCode, goldenParams);

        assertEq(prediction.effectiveTokenSalt, 0xcc7626fbe5708a49b432b1604bf3b08795ad0029288b199b678e1c031586f886);
        assertEq(prediction.shard, 0xAF97C665ee1201211E87198Bb77b67314D081A87);
        assertEq(prediction.hook, 0xe8AF239d50B80F65218A434b3F2258D0f39ee0Cc);
        assertEq(prediction.nft, 0x3E886B951DFA516A6956EBB4FfA1b29D4b3Bd265);
        assertEq(prediction.tokenInitCodeHash, 0xa7519cca9ec2db12e7c4a0c35f0a6b779594f7eaa1010d51e2d1731526cfbc2a);
        assertEq(prediction.hookInitCodeHash, 0x12c243ba325747547433106c081571a258aba231053e405b069a5ba2267c45d1);
        assertEq(prediction.nftInitCodeHash, 0xbaed98e59901033757923ff3bdd167532447cf86815a678d2b8501564e3f58f8);
        assertEq(
            prediction.deploymentConfigurationHash, 0x8c9a7bec67d3a378de8dd422d7930673337147e99ca7e9da72facc61c735a27b
        );
        assertEq(prediction.innerCalldataKeccak256, 0xceecc8db31d20bdc7f82581af751f22407e017dc54c95818d183ae9ad8626e26);
        assertTrue(golden.hasRequiredHookFlags(prediction.hook));
        assertEq(golden.REQUIRED_HOOK_FLAGS(), 0x20cc);
    }

    function test_customRendererIsBoundIntoWrapperGraphConfigurationAndEvent() public {
        address customRenderer = address(new ReviewedRendererMarkerV1());
        params.renderer = customRenderer;
        tokenSalt = keccak256("route-gated-custom-renderer-token-salt");
        (hookSalt, predictedShard, predictedHook, predictedNft) = _mine(keccak256("custom-renderer-start"));

        vm.recordLogs();
        (address hook, address shard, address nft) = harness.launch(tokenSalt, hookSalt, hookCreationCode, params);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(address(ShardNFTV1(nft).renderer()), customRenderer);
        assertEq(factory.configurationHashOf(hook), _configurationHash(hook, shard, nft));
        _assertExactLaunchEvent(logs, hook, shard, nft, customRenderer);
    }

    function test_copiedLaunchAndArbitraryImplementationSelectorsCannotReachDelegateExecution() public {
        vm.expectPartialRevert(ProgrammableExactShardsRouteGatedFactoryV2.UnauthorizedLaunchCaller.selector);
        factory.launch(tokenSalt, hookSalt, hookCreationCode, params);
        assertEq(predictedShard.code.length, 0);
        assertEq(predictedHook.code.length, 0);
        assertEq(predictedNft.code.length, 0);

        (bool ok,) = address(factory)
            .call(abi.encodeWithSelector(ShardLaunchFactoryV1.predictToken.selector, tokenSalt, _upstreamParams()));
        assertFalse(ok);
        (ok,) = address(factory).call(hex"deadbeef");
        assertFalse(ok);
        (ok,) = address(factory).call("");
        assertFalse(ok);
    }

    function test_directImplementationGraphCannotOccupyWrapperGraph() public view {
        ShardLaunchFactoryV1.LaunchParams memory upstreamParams = _upstreamParams();
        address implementationShard = implementation.predictToken(tokenSalt, hookSalt, upstreamParams);
        address implementationHook =
            implementation.predictHook(hookSalt, hookCreationCode, implementationShard, upstreamParams);
        assertTrue(implementationShard != predictedShard);
        assertTrue(implementationHook != predictedHook);
    }

    function test_implementationRuntimeMutationFailsBeforeAnyGraphDeployment() public {
        vm.etch(address(implementation), hex"00");
        vm.expectPartialRevert(
            ProgrammableExactShardsRouteGatedFactoryV2.ImplementationRuntimeCodeHashMismatch.selector
        );
        harness.launch(tokenSalt, hookSalt, hookCreationCode, params);
        assertEq(predictedShard.code.length, 0);
        assertEq(predictedHook.code.length, 0);
        assertEq(predictedNft.code.length, 0);
    }

    function _mine(bytes32 start) private view returns (bytes32 minedSalt, address shard, address hook, address nft) {
        bytes32 tokenInitCodeHash =
            keccak256(bytes.concat(type(ShardTokenV1).creationCode, abi.encode(params.tokenName, params.tokenSymbol)));
        address renderer = implementation.resolveRenderer(params.renderer);
        bytes32[11] memory effectiveSaltWords;
        effectiveSaltWords[0] = tokenSalt;
        effectiveSaltWords[2] = bytes32(uint256(int256(params.tickLower)));
        effectiveSaltWords[3] = bytes32(uint256(int256(params.tickBand)));
        effectiveSaltWords[4] = bytes32(uint256(int256(params.tickUpper)));
        effectiveSaltWords[5] = bytes32(uint256(params.startSqrtPriceX96));
        effectiveSaltWords[6] = bytes32(uint256(uint160(renderer)));
        effectiveSaltWords[7] = keccak256(bytes(params.tokenName));
        effectiveSaltWords[8] = keccak256(bytes(params.tokenSymbol));
        effectiveSaltWords[9] = keccak256(bytes(params.nftName));
        effectiveSaltWords[10] = keccak256(bytes(params.nftSymbol));
        bytes memory hookInitCode = bytes.concat(
            hookCreationCode,
            abi.encode(
                implementation.poolManager(),
                ShardTokenV1(address(0)),
                params.tickLower,
                params.tickBand,
                params.tickUpper,
                params.startSqrtPriceX96,
                address(factory),
                implementation.launcherFeeRecipient(),
                implementation.builderFeeRecipient()
            )
        );
        uint256 shardWordOffset = hookCreationCode.length + 64;
        uint256 candidate = uint256(start);
        while (true) {
            minedSalt = bytes32(candidate);
            effectiveSaltWords[1] = minedSalt;
            bytes32 effectiveSalt;
            assembly ("memory-safe") {
                effectiveSalt := keccak256(effectiveSaltWords, 0x160)
            }
            shard = Create2.computeAddress(effectiveSalt, tokenInitCodeHash, address(factory));
            assembly ("memory-safe") {
                mstore(add(hookInitCode, shardWordOffset), shard)
            }
            hook = Create2.computeAddress(minedSalt, keccak256(hookInitCode), address(factory));
            if (uint160(hook) & ALL_HOOK_MASK == REQUIRED_HOOK_FLAGS) {
                bytes memory nftInitCode = bytes.concat(
                    type(ShardNFTV1).creationCode, abi.encode(hook, renderer, params.nftName, params.nftSymbol)
                );
                nft = Create2.computeAddress(keccak256(abi.encode(hook)), keccak256(nftInitCode), address(factory));
                return (minedSalt, shard, hook, nft);
            }
            unchecked {
                candidate++;
            }
        }
    }

    function _effectiveTokenSalt(bytes32 minedSalt, address renderer) private view returns (bytes32) {
        return keccak256(
            abi.encode(
                tokenSalt,
                minedSalt,
                params.tickLower,
                params.tickBand,
                params.tickUpper,
                params.startSqrtPriceX96,
                renderer,
                keccak256(bytes(params.tokenName)),
                keccak256(bytes(params.tokenSymbol)),
                keccak256(bytes(params.nftName)),
                keccak256(bytes(params.nftSymbol))
            )
        );
    }

    function _configurationHash(address hook, address shard, address nft) private view returns (bytes32) {
        ConfigurationDataV1 memory data;
        data.chainId = block.chainid;
        data.factory = address(factory);
        data.poolManager = address(implementation.poolManager());
        data.renderer = implementation.resolveRenderer(params.renderer);
        data.launcherFeeRecipient = implementation.launcherFeeRecipient();
        data.builderFeeRecipient = implementation.builderFeeRecipient();
        data.shard = shard;
        data.hook = hook;
        data.nft = nft;
        data.tickLower = params.tickLower;
        data.tickBand = params.tickBand;
        data.tickUpper = params.tickUpper;
        data.startSqrtPriceX96 = params.startSqrtPriceX96;
        data.tokenNameHash = keccak256(bytes(params.tokenName));
        data.tokenSymbolHash = keccak256(bytes(params.tokenSymbol));
        data.nftNameHash = keccak256(bytes(params.nftName));
        data.nftSymbolHash = keccak256(bytes(params.nftSymbol));
        data.tokenSalt = tokenSalt;
        data.effectiveTokenSalt = _effectiveTokenSalt(hookSalt, data.renderer);
        data.hookSalt = hookSalt;
        data.hookCreationCodeHash = keccak256(hookCreationCode);
        return keccak256(abi.encode(data));
    }

    function _upstreamParams() private view returns (ShardLaunchFactoryV1.LaunchParams memory upstream) {
        upstream = ShardLaunchFactoryV1.LaunchParams({
            tickLower: params.tickLower,
            tickBand: params.tickBand,
            tickUpper: params.tickUpper,
            startSqrtPriceX96: params.startSqrtPriceX96,
            renderer: params.renderer,
            tokenName: params.tokenName,
            tokenSymbol: params.tokenSymbol,
            nftName: params.nftName,
            nftSymbol: params.nftSymbol
        });
    }

    function _assertExactLaunchEvent(Vm.Log[] memory logs, address hook, address shard, address nft, address renderer)
        private
    {
        for (uint256 i; i < logs.length; ++i) {
            if (
                logs[i].emitter == address(factory) && logs[i].topics.length == 4
                    && logs[i].topics[0] == SHARD_LAUNCHED_TOPIC
            ) {
                assertEq(address(uint160(uint256(logs[i].topics[1]))), hook);
                assertEq(address(uint160(uint256(logs[i].topics[2]))), shard);
                assertEq(address(uint160(uint256(logs[i].topics[3]))), nft);
                (
                    bytes32 eventTokenSalt,
                    bytes32 eventHookSalt,
                    address eventBuilderRecipient,
                    address eventRenderer,
                    bytes32 eventConfigurationHash
                ) = abi.decode(logs[i].data, (bytes32, bytes32, address, address, bytes32));
                assertEq(eventTokenSalt, tokenSalt);
                assertEq(eventHookSalt, hookSalt);
                assertEq(eventBuilderRecipient, implementation.builderFeeRecipient());
                assertEq(eventRenderer, renderer);
                assertEq(eventConfigurationHash, factory.configurationHashOf(hook));
                return;
            }
        }
        fail();
    }
}
