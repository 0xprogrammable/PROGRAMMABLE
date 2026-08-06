// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test, console2 } from "forge-std/Test.sol";
import { Vm, VmSafe } from "forge-std/Vm.sol";

import { PoolManager } from "@uniswap/v4-core/src/PoolManager.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";

import { LaunchShardsV1 } from "../script/LaunchShardsV1.s.sol";
import { GeometricRendererV1 } from "../src/GeometricRendererV1.sol";
import { ShardErrorsV1 } from "../src/ShardErrorsV1.sol";
import { ShardHookV1 } from "../src/ShardHookV1.sol";
import { ShardLaunchFactoryV1 } from "../src/ShardLaunchFactoryV1.sol";
import { ShardNFTV1 } from "../src/ShardNFTV1.sol";
import { ShardTokenV1 } from "../src/ShardTokenV1.sol";
import { IShardNFTV1 } from "../src/interfaces/IShardNFTV1.sol";
import { ShardLaunchLib } from "./utils/ShardLaunchLib.sol";

contract FalseTransferConfiguringHook {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    constructor(IPoolManager, ShardTokenV1 shard, int24, int24, int24, uint160, address, address, address) {
        VM.mockCall(
            address(shard),
            abi.encodeWithSelector(bytes4(keccak256("transfer(address,uint256)")), address(this), 10_000 ether),
            abi.encode(false)
        );
    }

    function setNFT(IShardNFTV1) external { }

    function initialise() external pure returns (uint128) {
        return 1;
    }
}

contract ShardLaunchFactoryV1Test is Test {
    event ShardLaunched(
        address indexed hook,
        address indexed shard,
        address indexed nft,
        bytes32 tokenSalt,
        bytes32 hookSalt,
        address builderFeeRecipient,
        address renderer,
        bytes32 configurationHash
    );

    uint160 internal constant ALL_HOOK_MASK = uint160((1 << 14) - 1);
    uint160 internal constant REQUIRED_HOOK_FLAGS = uint160(
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
    );
    int24 internal constant TICK_BAND = 22_980;
    int24 internal constant TICK_UPPER = 115_080;

    IPoolManager internal manager;
    ShardLaunchFactoryV1 internal factory;
    ShardLaunchFactoryV1.LaunchParams internal params;
    bytes internal hookCreationCode;
    bytes32 internal hookCreationCodeHash;
    bytes32 internal tokenSalt = keccak256("canonical token salt");
    bytes32 internal hookSalt;
    address internal predictedShard;
    address internal predictedHook;
    address internal launcher = makeAddr("factory launcher");
    address internal builder = makeAddr("factory builder");

    function setUp() public {
        manager = IPoolManager(address(new PoolManager(address(this))));
        hookCreationCode = type(ShardHookV1).creationCode;
        hookCreationCodeHash = keccak256(hookCreationCode);
        factory = new ShardLaunchFactoryV1(manager, launcher, hookCreationCodeHash);
        params = ShardLaunchFactoryV1.LaunchParams({
            tickLower: TickMath.minUsableTick(60),
            tickBand: TICK_BAND,
            tickUpper: TICK_UPPER,
            startSqrtPriceX96: TickMath.getSqrtPriceAtTick(TICK_UPPER),
            builderFeeRecipient: builder
        });
        (hookSalt, predictedShard, predictedHook) =
            ShardLaunchLib.mine(factory, tokenSalt, bytes32(0), hookCreationCode, params);
    }

    function test_constructorPinsReviewedInputsAndDeploysOneRenderer() public view {
        assertEq(address(factory.poolManager()), address(manager));
        assertEq(factory.launcherFeeRecipient(), launcher);
        assertEq(factory.hookCreationCodeHash(), hookCreationCodeHash);
        assertTrue(address(factory.renderer()) != address(0));
        assertGt(address(factory.renderer()).code.length, 0);
    }

    function test_constructorRejectsZeroPoolManager() public {
        vm.expectRevert(ShardErrorsV1.ZeroAddress.selector);
        new ShardLaunchFactoryV1(IPoolManager(address(0)), launcher, hookCreationCodeHash);
    }

    function test_constructorRejectsZeroLauncher() public {
        vm.expectRevert(ShardErrorsV1.ZeroAddress.selector);
        new ShardLaunchFactoryV1(manager, address(0), hookCreationCodeHash);
    }

    function test_constructorRejectsZeroHookCodeHash() public {
        vm.expectRevert(ShardLaunchFactoryV1.ZeroHookCodeHash.selector);
        new ShardLaunchFactoryV1(manager, launcher, bytes32(0));
    }

    function test_predictionHelpersAreDeterministicAndUseExactInitCode() public view {
        address tokenA = factory.predictToken(tokenSalt, hookSalt, params);
        address tokenB = factory.predictToken(tokenSalt, hookSalt, params);
        assertEq(tokenA, tokenB);
        assertEq(tokenA, predictedShard);

        bytes memory initCodeA = factory.hookInitCode(hookCreationCode, tokenA, params);
        bytes memory initCodeB = factory.hookInitCode(hookCreationCode, tokenA, params);
        bytes memory expected = bytes.concat(
            hookCreationCode,
            abi.encode(
                manager,
                ShardTokenV1(tokenA),
                params.tickLower,
                params.tickBand,
                params.tickUpper,
                params.startSqrtPriceX96,
                address(factory),
                launcher,
                builder
            )
        );
        assertEq(initCodeA, initCodeB);
        assertEq(initCodeA, expected);
        assertEq(factory.hookInitCodeHash(hookCreationCode, tokenA, params), keccak256(expected));
        assertEq(factory.predictHook(hookSalt, hookCreationCode, tokenA, params), predictedHook);
        assertEq(factory.predictHook(hookSalt, hookCreationCode, tokenA, params), predictedHook);
    }

    function test_effectiveTokenSaltNamespacesTheBuilderRole() public {
        address otherBuilder = makeAddr("other builder namespace");
        bytes32 expected = keccak256(
            abi.encode(
                tokenSalt,
                hookSalt,
                params.tickLower,
                params.tickBand,
                params.tickUpper,
                params.startSqrtPriceX96,
                builder
            )
        );
        assertEq(factory.effectiveTokenSalt(tokenSalt, hookSalt, params), expected);
        ShardLaunchFactoryV1.LaunchParams memory other = params;
        other.builderFeeRecipient = otherBuilder;
        assertTrue(
            factory.effectiveTokenSalt(tokenSalt, hookSalt, params)
                != factory.effectiveTokenSalt(tokenSalt, hookSalt, other)
        );
        assertTrue(
            factory.predictToken(tokenSalt, hookSalt, params) != factory.predictToken(tokenSalt, hookSalt, other)
        );
    }

    function test_effectiveTokenSaltBindsHookSaltAndEveryLaunchParameter() public view {
        bytes32 baseline = factory.effectiveTokenSalt(tokenSalt, hookSalt, params);

        assertTrue(baseline != factory.effectiveTokenSalt(bytes32(uint256(tokenSalt) + 1), hookSalt, params));
        assertTrue(baseline != factory.effectiveTokenSalt(tokenSalt, bytes32(uint256(hookSalt) + 1), params));

        ShardLaunchFactoryV1.LaunchParams memory changed = params;
        changed.tickLower += 60;
        assertTrue(baseline != factory.effectiveTokenSalt(tokenSalt, hookSalt, changed));

        changed = params;
        changed.tickBand += 60;
        assertTrue(baseline != factory.effectiveTokenSalt(tokenSalt, hookSalt, changed));

        changed = params;
        changed.tickUpper += 60;
        assertTrue(baseline != factory.effectiveTokenSalt(tokenSalt, hookSalt, changed));

        changed = params;
        changed.startSqrtPriceX96 += 1;
        assertTrue(baseline != factory.effectiveTokenSalt(tokenSalt, hookSalt, changed));

        changed = params;
        changed.builderFeeRecipient = address(uint160(uint256(keccak256("changed builder"))));
        assertTrue(baseline != factory.effectiveTokenSalt(tokenSalt, hookSalt, changed));
    }

    function test_launchScriptPrecomputesEveryLaunchCommitment() public {
        LaunchShardsV1 launchScript = new LaunchShardsV1();
        (bytes32 scriptHookSalt, address scriptShard, address scriptHook, address scriptNft, bytes32 scriptConfig) =
            launchScript.predictAndMine(factory, tokenSalt, bytes32(0), params);

        assertEq(scriptHookSalt, hookSalt);
        assertEq(scriptShard, predictedShard);
        assertEq(scriptHook, predictedHook);
        assertEq(scriptNft, factory.predictNFT(scriptHook));
        assertEq(
            scriptConfig,
            factory.computeConfigurationHash(scriptHook, scriptShard, scriptNft, tokenSalt, scriptHookSalt, params)
        );
    }

    function test_deployedAddressesEqualPredictions() public {
        address expectedNft = factory.predictNFT(predictedHook);
        (address hook, address shard, address nft) = _launch();
        assertEq(shard, predictedShard);
        assertEq(hook, predictedHook);
        assertEq(nft, expectedNft);
    }

    function test_nftPredictionIsStableAcrossUnrelatedLaunches() public {
        address expectedNft = factory.predictNFT(predictedHook);
        bytes32 unrelatedTokenSalt = keccak256("unrelated token salt");
        (bytes32 unrelatedHookSalt,,) =
            ShardLaunchLib.mine(factory, unrelatedTokenSalt, bytes32(0), hookCreationCode, params);
        factory.launch(unrelatedTokenSalt, unrelatedHookSalt, hookCreationCode, params);

        assertEq(factory.predictNFT(predictedHook), expectedNft, "unrelated launch changed NFT prediction");
        (,, address nft) = _launch();
        assertEq(nft, expectedNft, "deployed NFT differed from deterministic prediction");
    }

    function test_launchStoresExactConfigurationHashAndEmitsExactEvent() public {
        address expectedNft = factory.predictNFT(predictedHook);
        bytes32 expectedConfiguration =
            _independentConfigurationHash(predictedHook, predictedShard, expectedNft, params);

        vm.expectEmit(true, true, true, true, address(factory));
        emit ShardLaunched(
            predictedHook,
            predictedShard,
            expectedNft,
            tokenSalt,
            hookSalt,
            builder,
            address(factory.renderer()),
            expectedConfiguration
        );
        (address hook,,) = _launch();

        assertEq(factory.configurationHashOf(hook), expectedConfiguration);
        assertEq(
            factory.computeConfigurationHash(hook, predictedShard, expectedNft, tokenSalt, hookSalt, params),
            expectedConfiguration
        );
    }

    function test_launchRejectsWrongCreationCode() public {
        bytes memory wrong = type(ShardTokenV1).creationCode;
        vm.expectRevert(
            abi.encodeWithSelector(ShardLaunchFactoryV1.WrongHookCode.selector, hookCreationCodeHash, keccak256(wrong))
        );
        factory.launch(tokenSalt, hookSalt, wrong, params);
    }

    function test_launchRejectsMalformedCreationCodeOfTheSameLength() public {
        bytes memory malformed = hookCreationCode;
        malformed[malformed.length / 2] = bytes1(uint8(malformed[malformed.length / 2]) ^ 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                ShardLaunchFactoryV1.WrongHookCode.selector, hookCreationCodeHash, keccak256(malformed)
            )
        );
        factory.launch(tokenSalt, hookSalt, malformed, params);
    }

    function test_launchRejectsHookSaltWithWrongPermissionBitsBeforeDeployment() public {
        bytes32 invalidSalt;
        address invalidShard = factory.predictToken(tokenSalt, invalidSalt, params);
        address invalidHook = factory.predictHook(invalidSalt, hookCreationCode, invalidShard, params);
        while (uint160(invalidHook) & ALL_HOOK_MASK == REQUIRED_HOOK_FLAGS) {
            invalidSalt = bytes32(uint256(invalidSalt) + 1);
            invalidShard = factory.predictToken(tokenSalt, invalidSalt, params);
            invalidHook = factory.predictHook(invalidSalt, hookCreationCode, invalidShard, params);
        }
        uint160 actual = uint160(invalidHook) & ALL_HOOK_MASK;
        vm.expectRevert(
            abi.encodeWithSelector(
                ShardLaunchFactoryV1.InvalidHookFlags.selector, invalidHook, REQUIRED_HOOK_FLAGS, actual
            )
        );
        factory.launch(tokenSalt, invalidSalt, hookCreationCode, params);
        assertEq(invalidShard.code.length, 0);
    }

    function test_launchRejectsOccupiedPredictedNftBeforeDeployingTokenOrHook() public {
        address predictedNft = factory.predictNFT(predictedHook);
        vm.etch(predictedNft, hex"00");

        vm.expectRevert(abi.encodeWithSelector(ShardLaunchFactoryV1.AddressOccupied.selector, predictedNft));
        factory.launch(tokenSalt, hookSalt, hookCreationCode, params);

        assertEq(predictedShard.code.length, 0, "token deployed before occupied NFT rejection");
        assertEq(predictedHook.code.length, 0, "hook deployed before occupied NFT rejection");
    }

    function test_launchRejectsZeroBuilder() public {
        ShardLaunchFactoryV1.LaunchParams memory invalid = params;
        invalid.builderFeeRecipient = address(0);
        vm.expectRevert(ShardErrorsV1.ZeroAddress.selector);
        factory.launch(tokenSalt, hookSalt, hookCreationCode, invalid);
    }

    function test_launchRejectsInvalidTicks() public {
        ShardLaunchFactoryV1.LaunchParams memory invalid = params;
        invalid.tickLower = invalid.tickBand;
        vm.expectRevert(ShardErrorsV1.InvalidTickRange.selector);
        factory.launch(tokenSalt, hookSalt, hookCreationCode, invalid);
    }

    function test_launchRejectsInvalidStartPrice() public {
        ShardLaunchFactoryV1.LaunchParams memory invalid = params;
        invalid.startSqrtPriceX96 = TickMath.getSqrtPriceAtTick(TICK_UPPER - 60);
        vm.expectRevert(ShardErrorsV1.InvalidStartPrice.selector);
        factory.launch(tokenSalt, hookSalt, hookCreationCode, invalid);
    }

    function test_duplicateTokenSaltForSameBuilderRevertsWithoutChangingFirstLaunch() public {
        (address firstHook, address firstShard, address firstNft) = _launch();
        bytes32 firstConfiguration = factory.configurationHashOf(firstHook);

        vm.expectRevert(abi.encodeWithSelector(ShardLaunchFactoryV1.AddressOccupied.selector, predictedShard));
        factory.launch(tokenSalt, hookSalt, hookCreationCode, params);

        assertEq(factory.configurationHashOf(firstHook), firstConfiguration);
        assertGt(firstShard.code.length, 0);
        assertGt(firstNft.code.length, 0);
    }

    function test_sameRawTokenSaltWithDifferentBuilderCreatesIndependentTokenAddress() public {
        (address firstHook, address firstShard, address firstNft) = _launch();
        ShardLaunchFactoryV1.LaunchParams memory other = params;
        other.builderFeeRecipient = makeAddr("second builder");
        (bytes32 otherHookSalt, address otherShard, address otherHook) =
            ShardLaunchLib.mine(factory, tokenSalt, bytes32(uint256(hookSalt) + 1), hookCreationCode, other);

        assertTrue(otherShard != firstShard);
        (address launchedHook, address launchedShard, address otherNft) =
            factory.launch(tokenSalt, otherHookSalt, hookCreationCode, other);
        assertEq(launchedHook, otherHook);
        assertEq(launchedShard, otherShard);
        assertTrue(launchedHook != firstHook);
        assertTrue(otherNft != firstNft);
    }

    function test_sameRawSaltAndBuilderWithDifferentConfigurationCannotConsumeIntendedToken() public {
        ShardLaunchFactoryV1.LaunchParams memory hostile = params;
        hostile.tickBand += 60;
        (bytes32 hostileHookSalt, address hostileShard,) =
            ShardLaunchLib.mine(factory, tokenSalt, bytes32(uint256(hookSalt) + 1), hookCreationCode, hostile);

        assertTrue(hostileShard != predictedShard, "changed configuration retained the intended token");
        factory.launch(tokenSalt, hostileHookSalt, hookCreationCode, hostile);
        assertEq(predictedShard.code.length, 0, "hostile launch consumed the intended token");

        (address intendedHook, address intendedShard,) = _launch();
        assertEq(intendedHook, predictedHook);
        assertEq(intendedShard, predictedShard);
    }

    function test_duplicateHookSaltAndConfigurationCannotOverwriteEvidence() public {
        (address firstHook,,) = _launch();
        bytes32 firstConfiguration = factory.configurationHashOf(firstHook);
        vm.expectRevert();
        factory.launch(tokenSalt, hookSalt, hookCreationCode, params);
        assertEq(factory.configurationHashOf(firstHook), firstConfiguration);
    }

    function test_failureAfterDeploymentsRollsBackTokenHookNftMappingAndEvent() public {
        bytes memory failingCode = type(FalseTransferConfiguringHook).creationCode;
        ShardLaunchFactoryV1 failingFactory = new ShardLaunchFactoryV1(manager, launcher, keccak256(failingCode));
        (bytes32 failingSalt, address failingShard, address failingHook) =
            ShardLaunchLib.mine(failingFactory, tokenSalt, bytes32(0), failingCode, params);
        address expectedNft = failingFactory.predictNFT(failingHook);
        uint64 nonceBefore = vm.getNonce(address(failingFactory));
        vm.recordLogs();
        vm.expectRevert(ShardLaunchFactoryV1.TokenTransferFailed.selector);
        failingFactory.launch(tokenSalt, failingSalt, failingCode, params);

        assertEq(failingShard.code.length, 0);
        assertEq(failingHook.code.length, 0);
        assertEq(expectedNft.code.length, 0);
        assertEq(failingFactory.configurationHashOf(failingHook), bytes32(0));
        assertEq(vm.getNonce(address(failingFactory)), nonceBefore);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 launchSignature = ShardLaunched.selector;
        for (uint256 i; i < logs.length; ++i) {
            assertTrue(logs[i].topics.length == 0 || logs[i].topics[0] != launchSignature);
        }
    }

    function test_factoryHoldsZeroShardAfterSuccess() public {
        (, address shard,) = _launch();
        assertEq(ShardTokenV1(shard).balanceOf(address(factory)), 0);
        assertEq(ShardTokenV1(shard).totalSupply(), 10_000 ether);
    }

    function test_hookDeployerIsFactoryAndBothOneShotPowersAreConsumed() public {
        (address hookAddress,, address nftAddress) = _launch();
        ShardHookV1 hook = ShardHookV1(payable(hookAddress));
        assertEq(hook.deployer(), address(factory));
        assertEq(address(hook.nft()), nftAddress);
        assertEq(IShardNFTV1(nftAddress).hook(), hookAddress);
        assertTrue(hook.initialised());

        vm.startPrank(address(factory));
        vm.expectRevert(ShardErrorsV1.AlreadyInitialised.selector);
        hook.setNFT(IShardNFTV1(nftAddress));
        vm.expectRevert(ShardErrorsV1.AlreadyInitialised.selector);
        hook.initialise();
        vm.stopPrank();
    }

    function test_twoCollectionsShareOneRendererAndRemainIndependent() public {
        (address firstHook, address firstShard, address firstNft) = _launch();
        bytes32 secondTokenSalt = keccak256("second token salt");
        (bytes32 secondHookSalt, address secondShard, address secondHook) =
            ShardLaunchLib.mine(factory, secondTokenSalt, bytes32(uint256(hookSalt) + 1), hookCreationCode, params);
        (address launchedHook, address launchedShard, address secondNft) =
            factory.launch(secondTokenSalt, secondHookSalt, hookCreationCode, params);

        assertEq(launchedHook, secondHook);
        assertEq(launchedShard, secondShard);
        assertTrue(firstHook != secondHook && firstShard != secondShard && firstNft != secondNft);
        assertEq(address(ShardNFTV1(firstNft).renderer()), address(factory.renderer()));
        assertEq(address(ShardNFTV1(secondNft).renderer()), address(factory.renderer()));
    }

    function test_sharedMinerIsDeterministicAndDeploysOnlyOnce() public {
        (bytes32 saltA, address shardA, address hookA) =
            ShardLaunchLib.mine(factory, tokenSalt, bytes32(0), hookCreationCode, params);
        (bytes32 saltB, address shardB, address hookB) =
            ShardLaunchLib.mine(factory, tokenSalt, bytes32(0), hookCreationCode, params);
        assertEq(saltA, saltB);
        assertEq(shardA, shardB);
        assertEq(hookA, hookB);

        (address launchedHook, address launchedShard,) = factory.launch(tokenSalt, saltA, hookCreationCode, params);
        assertEq(launchedHook, hookA);
        assertEq(launchedShard, shardA);
    }

    function test_factoryAndHookStayWithinEipSizeLimitsAndFactoryDoesNotEmbedHookBlob() public view {
        // `forge coverage` disables the optimizer, so its instrumented artifacts do not represent deployable bytecode.
        if (vm.isContext(VmSafe.ForgeContext.Coverage)) return;

        bytes memory factoryCreationCode = type(ShardLaunchFactoryV1).creationCode;
        bytes memory factoryInitCode =
            bytes.concat(factoryCreationCode, abi.encode(IPoolManager(address(1)), address(2), bytes32(uint256(3))));
        assertLe(address(factory).code.length, 24_576, "factory runtime exceeds EIP-170");
        assertLe(factoryInitCode.length, 49_152, "factory initcode exceeds EIP-3860");
        assertFalse(_contains(factoryCreationCode, type(ShardHookV1).creationCode), "factory embeds complete hook blob");
    }

    function test_logDeploymentAndLaunchGas() public {
        uint256 gasBefore = gasleft();
        ShardLaunchFactoryV1 measured = new ShardLaunchFactoryV1(manager, launcher, hookCreationCodeHash);
        uint256 constructorGas = gasBefore - gasleft();
        (bytes32 measuredSalt,,) = ShardLaunchLib.mine(measured, tokenSalt, bytes32(0), hookCreationCode, params);
        gasBefore = gasleft();
        measured.launch(tokenSalt, measuredSalt, hookCreationCode, params);
        uint256 launchGas = gasBefore - gasleft();
        console2.log("ShardLaunchFactoryV1 constructor gas", constructorGas);
        console2.log("ShardLaunchFactoryV1 launch gas", launchGas);
        assertGt(constructorGas, 0);
        assertGt(launchGas, 0);
    }

    function _launch() internal returns (address hook, address shard, address nft) {
        return factory.launch(tokenSalt, hookSalt, hookCreationCode, params);
    }

    function _independentConfigurationHash(
        address hook,
        address shard,
        address nft,
        ShardLaunchFactoryV1.LaunchParams memory launchParams
    ) internal view returns (bytes32) {
        ShardLaunchFactoryV1.ConfigurationData memory data;
        data.chainId = block.chainid;
        data.factory = address(factory);
        data.poolManager = address(manager);
        data.renderer = address(factory.renderer());
        data.launcherFeeRecipient = launcher;
        data.builderFeeRecipient = launchParams.builderFeeRecipient;
        data.shard = shard;
        data.hook = hook;
        data.nft = nft;
        data.tickLower = launchParams.tickLower;
        data.tickBand = launchParams.tickBand;
        data.tickUpper = launchParams.tickUpper;
        data.startSqrtPriceX96 = launchParams.startSqrtPriceX96;
        data.tokenSalt = tokenSalt;
        data.effectiveTokenSalt = factory.effectiveTokenSalt(tokenSalt, hookSalt, launchParams);
        data.hookSalt = hookSalt;
        data.hookCreationCodeHash = hookCreationCodeHash;
        return keccak256(abi.encode(data));
    }

    function _contains(bytes memory haystack, bytes memory needle) internal pure returns (bool) {
        if (needle.length == 0 || needle.length > haystack.length) return false;
        bytes32 first;
        assembly ("memory-safe") {
            first := mload(add(needle, 32))
        }
        uint256 last = haystack.length - needle.length;
        for (uint256 i; i <= last; ++i) {
            bytes32 candidate;
            assembly ("memory-safe") {
                candidate := mload(add(add(haystack, 32), i))
            }
            if (candidate != first) continue;
            bool match_ = true;
            for (uint256 j; j < needle.length; ++j) {
                if (haystack[i + j] != needle[j]) {
                    match_ = false;
                    break;
                }
            }
            if (match_) return true;
        }
        return false;
    }
}
