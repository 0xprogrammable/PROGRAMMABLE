// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC1271 } from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Test, Vm } from "forge-std/Test.sol";

import { GeometricRendererV1 } from "shards-v1/src/GeometricRendererV1.sol";
import { ShardHookV1 } from "shards-v1/src/ShardHookV1.sol";
import { ShardLaunchFactoryV1 } from "shards-v1/src/ShardLaunchFactoryV1.sol";
import { ShardNFTV1 } from "shards-v1/src/ShardNFTV1.sol";
import { ShardTokenV1 } from "shards-v1/src/ShardTokenV1.sol";

import { ProgrammableExactShardsProfileV1 } from "../src/ProgrammableExactShardsProfileV1.sol";
import { ProgrammableLaunchStampRouterV2 } from "../src/ProgrammableLaunchStampRouterV2.sol";
import { IProgrammableExactShardsProfileV1 } from "../src/interfaces/IProgrammableExactShardsProfileV1.sol";
import { IProgrammableLaunchStampRouterV2 } from "../src/interfaces/IProgrammableLaunchStampRouterV2.sol";
import { IProgrammableNestedFactoryV1 } from "../src/interfaces/IProgrammableNestedFactoryV1.sol";

contract RouterV2AuthorityMock is IERC1271 {
    mapping(bytes32 digest => bool approved) internal _approved;

    function setApproved(bytes32 digest, bool approved) external {
        _approved[digest] = approved;
    }

    function isValidSignature(bytes32 digest, bytes memory) external view returns (bytes4) {
        return _approved[digest] ? IERC1271.isValidSignature.selector : bytes4(0xffffffff);
    }
}

contract RouterV2ForceEther {
    constructor() payable { }

    function force(address payable recipient) external {
        selfdestruct(recipient);
    }
}

/// @notice Exact-revision Mainnet integration for the one Shards production route.
/// @dev Set ETHEREUM_RPC_URL to an archive endpoint. Default local runs skip rather than silently substituting mocks.
contract ProgrammableLaunchStampRouterV2Test is Test {
    using StateLibrary for IPoolManager;

    uint256 internal constant SNAPSHOT_BLOCK = 25_724_010;
    address internal constant POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    bytes32 internal constant POOL_MANAGER_RUNTIME = 0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293;
    address internal constant PROXY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    bytes32 internal constant PROXY_RUNTIME = 0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989;
    bytes32 internal constant FACTORY_SALT = 0x655a4b5a2b704bef84b4ff94adde0a7ac40ad0366c82ddca5290180fe4c3986d;
    address internal constant FACTORY = 0x9442a520e7b31D10177C75A363355C2C29141ac5;
    address internal constant RENDERER = 0x090DBD2FaB1a467f90ed82a443eFa9AAb658DE14;
    address internal constant TOKEN = 0x50d17EAaeB52c66E64b918385AbF6523fDAE57CF;
    address internal constant HOOK = 0xbA318baA8649962fD77CC7082d098f2C09Fd60cC;
    address internal constant NFT = 0x9fDA98dE1B7061ae02A9Aec7A6f8ed75a8Feb8F3;
    address internal constant LAUNCH_WALLET = 0xceeBB3A6543CeBEB2ED66963897A0abEA52A50cC;
    bytes32 internal constant FACTORY_RUNTIME = 0x134a9e5674f22e62e939c2238693077b8027c553bb26d6a4e9e3d8554e5f85b5;
    bytes32 internal constant RENDERER_RUNTIME = 0x9b54a61918b2ddf9b7daf41d9bf2d705cbef3a0fd618275762b99e19c53459bf;
    bytes32 internal constant TOKEN_RUNTIME = 0xb2737fd93f2ff31e850e2be773e6e7a92a239b28091be1d4b122ff864cd7aae8;
    bytes32 internal constant HOOK_RUNTIME = 0x2a2174aff52c3ea9ddf0a6081464c9c6dbc43ddc93609c74d9610f50f486c1e1;
    bytes32 internal constant NFT_RUNTIME = 0xc3e3ea6cf4d2e13fa07a3b053d57cd7d6a6ecac7633aed86ab971d5e53959bb3;
    bytes32 internal constant POOL_ID = 0x075885e47ec15084de91826faafab9c2cd4fda4d24fd9e5ce3af6a4be4ad926d;
    bytes32 internal constant CONFIGURATION_HASH = 0xa98b7b95777267181a2b93a33632991e80a49f4a57d94150f8dfbd90421f34c1;
    uint160 internal constant START_SQRT_PRICE_X96 = 2_502_784_483_440_051_878_955_016_419_363;
    uint256 internal constant EIP_7825_TRANSACTION_GAS_LIMIT = 16_777_216;
    uint256 internal constant CONSERVATIVE_INTRINSIC_AND_CALLDATA_GAS = 1_250_000;

    bytes32 internal constant ROUTE_PAYLOAD_HASH = 0x75403c2f52dbdf623cfcd077fab52308b3e1e0623016ec73539fac5234f21356;
    bytes32 internal constant LAUNCH_ID = 0xd225b22ea82ef2425660da409849a55c1c44751eedd9cd1b581a48358a0905eb;
    bytes32 internal constant STAMP_REQUEST_HASH = 0x276a295580bcb65ed286a2a02efba575eaee87c090f54c94e5ad8a2b78552bce;
    bytes32 internal constant EXPECTED_RESULT_HASH = 0x29de1a5462fe7b07a0d58894f7ec5e2eb4e870c83153e2109647c7f4094c828b;
    bytes32 internal constant POOL_KEY_HASH = 0x95c1d301b4a0be5bf2ec99270902aae6e8d8bd16a96a005d5985583c0b49835a;

    RouterV2AuthorityMock internal authority;
    ProgrammableLaunchStampRouterV2 internal router;

    function setUp() public {
        string memory rpc = vm.envOr("ETHEREUM_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc, SNAPSHOT_BLOCK);
        assertEq(block.chainid, 1);
        assertEq(POOL_MANAGER.codehash, POOL_MANAGER_RUNTIME);
        assertEq(PROXY.codehash, PROXY_RUNTIME);
        assertEq(FACTORY.code.length, 0);
        assertEq(RENDERER.code.length, 0);
        assertEq(TOKEN.code.length, 0);
        assertEq(HOOK.code.length, 0);
        assertEq(NFT.code.length, 0);
        (uint160 sqrtPriceX96,,,) = IPoolManager(POOL_MANAGER).getSlot0(PoolId.wrap(POOL_ID));
        assertEq(sqrtPriceX96, 0);

        authority = new RouterV2AuthorityMock();
        router = new ProgrammableLaunchStampRouterV2(address(authority), address(authority));
        assertEq(address(router.SHARDS_PROFILE()).codehash, router.SHARDS_PROFILE_RUNTIME_CODE_HASH());
    }

    function test_exactGoldenPredeployedFactoryLaunchStamp() public {
        _deployFactoryDirectly();
        IProgrammableLaunchStampRouterV2.NestedFactoryRouteV1 memory route = _route();
        IProgrammableLaunchStampRouterV2.StampRequestV2 memory request = _request(route);
        IProgrammableLaunchStampRouterV2.LaunchPermitV2 memory permit = _permit(route, request, 3600);
        assertEq(router.computeRoutePayloadHash(route), ROUTE_PAYLOAD_HASH);
        assertEq(request.launchId, LAUNCH_ID);
        assertEq(router.computeStampRequestHash(request), STAMP_REQUEST_HASH);
        assertEq(router.computeExpectedResultHash(route, request), EXPECTED_RESULT_HASH);
        assertEq(IProgrammableLaunchStampRouterV2.launchAndStampV2.selector, bytes4(0xc90ca102));

        bytes32 digest = _approve(permit);
        vm.recordLogs();
        vm.prank(LAUNCH_WALLET);
        uint256 gasBefore = gasleft();
        bytes32 stampHash = router.launchAndStampV2(permit, request, route, hex"01");
        uint256 applicantCallGas = gasBefore - gasleft();
        emit log_named_uint("applicant launch call gas", applicantCallGas);
        assertLe(
            (applicantCallGas * 120) / 100 + CONSERVATIVE_INTRINSIC_AND_CALLDATA_GAS, EIP_7825_TRANSACTION_GAS_LIMIT
        );

        assertEq(FACTORY.codehash, FACTORY_RUNTIME);
        assertEq(RENDERER.codehash, RENDERER_RUNTIME);
        assertEq(TOKEN.codehash, TOKEN_RUNTIME);
        assertEq(HOOK.codehash, HOOK_RUNTIME);
        assertEq(NFT.codehash, NFT_RUNTIME);
        assertEq(IERC20(TOKEN).balanceOf(FACTORY), 0);
        assertEq(IProgrammableNestedFactoryV1(FACTORY).configurationHashOf(HOOK), CONFIGURATION_HASH);
        (uint160 sqrtPriceX96,,,) = IPoolManager(POOL_MANAGER).getSlot0(PoolId.wrap(POOL_ID));
        assertEq(sqrtPriceX96, START_SQRT_PRICE_X96);

        bytes32 expectedStampHash = keccak256(
            abi.encode(
                keccak256(
                    "ProgrammableLaunchStampV2(bytes32 permitDigest,bytes32 launchId,address factory,address poolManager,bytes32 poolId)"
                ),
                digest,
                LAUNCH_ID,
                FACTORY,
                POOL_MANAGER,
                POOL_ID
            )
        );
        assertEq(stampHash, expectedStampHash);
        IProgrammableLaunchStampRouterV2.StampRecordV2 memory record = router.launchStamp(LAUNCH_ID);
        assertEq(record.stampHash, stampHash);
        assertEq(record.profileKey, router.SHARDS_PROFILE_KEY());
        assertEq(record.sourceRevisionHash, route.sourceRevisionHash);
        assertEq(record.manifestHash, route.manifestHash);
        assertEq(record.revenuePolicyHash, route.revenuePolicyHash);
        assertEq(record.factory, FACTORY);
        assertEq(record.renderer, RENDERER);
        assertEq(record.token, TOKEN);
        assertEq(record.hook, HOOK);
        assertEq(record.nft, NFT);
        assertEq(router.launchIdByToken(TOKEN), LAUNCH_ID);
        assertEq(router.launchIdByComponent(TOKEN), LAUNCH_ID);
        assertEq(router.launchIdByComponent(HOOK), LAUNCH_ID);
        assertEq(router.launchIdByComponent(NFT), LAUNCH_ID);
        assertEq(router.launchIdByComponent(FACTORY), bytes32(0));
        assertEq(router.launchIdByPool(POOL_MANAGER, POOL_ID), LAUNCH_ID);
        assertTrue(router.nonceUsed(LAUNCH_WALLET, LAUNCH_ID));
        assertTrue(router.permitDigestUsed(digest));
        _assertRouterEvents(vm.getRecordedLogs());
    }

    function test_vacantFactoryFailsClosed() public {
        IProgrammableLaunchStampRouterV2.NestedFactoryRouteV1 memory route = _route();
        IProgrammableLaunchStampRouterV2.StampRequestV2 memory request = _request(route);
        IProgrammableLaunchStampRouterV2.LaunchPermitV2 memory permit = _permit(route, request, 3600);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableExactShardsProfileV1.InvalidRuntime.selector, FACTORY, FACTORY_RUNTIME, FACTORY.codehash
            )
        );
        vm.prank(LAUNCH_WALLET);
        router.launchAndStampV2(permit, request, route, hex"01");
        assertEq(TOKEN.code.length, 0);
    }

    function test_badFactoryInitcodeCommitmentFailsClosed() public {
        _deployFactoryDirectly();
        IProgrammableLaunchStampRouterV2.NestedFactoryRouteV1 memory route = _route();
        route.factoryInitCodeHash ^= bytes32(uint256(1));
        IProgrammableLaunchStampRouterV2.StampRequestV2 memory request = _request(route);
        IProgrammableLaunchStampRouterV2.LaunchPermitV2 memory permit = _permit(route, request, 3600);
        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableExactShardsProfileV1.InvalidShardsBinding.selector, uint8(1))
        );
        vm.prank(LAUNCH_WALLET);
        router.launchAndStampV2(permit, request, route, hex"01");
        assertEq(TOKEN.code.length, 0);
    }

    function test_preinitializedExactPoolRollsBackPermit() public {
        _deployFactoryDirectly();
        IProgrammableLaunchStampRouterV2.NestedFactoryRouteV1 memory route = _route();
        IProgrammableLaunchStampRouterV2.StampRequestV2 memory request = _request(route);
        IProgrammableLaunchStampRouterV2.LaunchPermitV2 memory permit = _permit(route, request, 3600);
        bytes32 digest = _approve(permit);
        vm.store(POOL_MANAGER, _poolStateSlot(), bytes32(uint256(1)));

        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableExactShardsProfileV1.InvalidShardsBinding.selector, uint8(6))
        );
        vm.prank(LAUNCH_WALLET);
        router.launchAndStampV2(permit, request, route, hex"01");
        assertEq(FACTORY.codehash, FACTORY_RUNTIME);
        assertFalse(router.nonceUsed(LAUNCH_WALLET, LAUNCH_ID));
        assertFalse(router.permitDigestUsed(digest));
    }

    function test_postconditionFailureRollsBackEverythingAndSamePermitRetries() public {
        _deployFactoryDirectly();
        IProgrammableLaunchStampRouterV2.NestedFactoryRouteV1 memory route = _route();
        IProgrammableLaunchStampRouterV2.StampRequestV2 memory request = _request(route);
        IProgrammableLaunchStampRouterV2.LaunchPermitV2 memory permit = _permit(route, request, 3600);
        bytes32 digest = _approve(permit);
        vm.mockCall(
            address(router.SHARDS_PROFILE()),
            abi.encodeWithSelector(IProgrammableExactShardsProfileV1.validatePostV1.selector),
            abi.encode(bytes32(uint256(1)))
        );

        vm.expectRevert(abi.encodeWithSelector(ProgrammableLaunchStampRouterV2.InvalidBinding.selector, uint8(8)));
        vm.prank(LAUNCH_WALLET);
        router.launchAndStampV2(permit, request, route, hex"01");
        assertEq(FACTORY.codehash, FACTORY_RUNTIME);
        assertEq(RENDERER.codehash, RENDERER_RUNTIME);
        assertEq(TOKEN.code.length, 0);
        assertEq(HOOK.code.length, 0);
        assertEq(NFT.code.length, 0);
        assertFalse(router.nonceUsed(LAUNCH_WALLET, LAUNCH_ID));
        assertFalse(router.permitDigestUsed(digest));
        (uint160 sqrtPriceX96,,,) = IPoolManager(POOL_MANAGER).getSlot0(PoolId.wrap(POOL_ID));
        assertEq(sqrtPriceX96, 0);

        vm.clearMockedCalls();
        vm.prank(LAUNCH_WALLET);
        router.launchAndStampV2(permit, request, route, hex"01");
        assertEq(TOKEN.codehash, TOKEN_RUNTIME);
        assertTrue(router.nonceUsed(LAUNCH_WALLET, LAUNCH_ID));
    }

    function test_permitWindowIsInclusiveAtOneHourAndRejectsLonger() public {
        _deployFactoryDirectly();
        IProgrammableLaunchStampRouterV2.NestedFactoryRouteV1 memory route = _route();
        IProgrammableLaunchStampRouterV2.StampRequestV2 memory request = _request(route);
        IProgrammableLaunchStampRouterV2.LaunchPermitV2 memory tooLong = _permit(route, request, 3601);
        _approve(tooLong);
        vm.expectRevert(abi.encodeWithSelector(ProgrammableLaunchStampRouterV2.InvalidBinding.selector, uint8(15)));
        vm.prank(LAUNCH_WALLET);
        router.launchAndStampV2(tooLong, request, route, hex"01");
        assertEq(FACTORY.codehash, FACTORY_RUNTIME);

        IProgrammableLaunchStampRouterV2.LaunchPermitV2 memory inclusive = _permit(route, request, 3600);
        _approve(inclusive);
        vm.prank(LAUNCH_WALLET);
        router.launchAndStampV2(inclusive, request, route, hex"01");
        assertEq(TOKEN.codehash, TOKEN_RUNTIME);
    }

    function test_replayCannotCreateASecondWinner() public {
        _deployFactoryDirectly();
        IProgrammableLaunchStampRouterV2.NestedFactoryRouteV1 memory route = _route();
        IProgrammableLaunchStampRouterV2.StampRequestV2 memory request = _request(route);
        IProgrammableLaunchStampRouterV2.LaunchPermitV2 memory permit = _permit(route, request, 3600);
        _approve(permit);
        vm.prank(LAUNCH_WALLET);
        bytes32 first = router.launchAndStampV2(permit, request, route, hex"01");

        for (uint256 i; i < 4; ++i) {
            vm.expectRevert(abi.encodeWithSelector(ProgrammableExactShardsProfileV1.Occupied.selector, TOKEN));
            vm.prank(LAUNCH_WALLET);
            router.launchAndStampV2(permit, request, route, abi.encode(i));
        }
        assertEq(router.launchStamp(LAUNCH_ID).stampHash, first);
        assertEq(router.launchIdByToken(TOKEN), LAUNCH_ID);
    }

    function test_noFallbackAndForcedEtherBalanceIsIsolated() public {
        (bool fallbackSuccess,) = address(router).call(hex"deadbeef");
        assertFalse(fallbackSuccess);
        uint256 balanceBefore = address(router).balance;
        RouterV2ForceEther force = new RouterV2ForceEther{ value: 1 wei }();
        force.force(payable(address(router)));
        uint256 forcedBalance = balanceBefore + 1 wei;
        assertEq(address(router).balance, forcedBalance);

        _deployFactoryDirectly();
        IProgrammableLaunchStampRouterV2.NestedFactoryRouteV1 memory route = _route();
        IProgrammableLaunchStampRouterV2.StampRequestV2 memory request = _request(route);
        IProgrammableLaunchStampRouterV2.LaunchPermitV2 memory permit = _permit(route, request, 3600);
        _approve(permit);
        vm.prank(LAUNCH_WALLET);
        router.launchAndStampV2(permit, request, route, hex"01");
        assertEq(address(router).balance, forcedBalance);
    }

    function testFuzz_factoryInitcodeCommitmentMutationAlwaysFails(bytes32 mutation) public {
        vm.assume(mutation != bytes32(0));
        _deployFactoryDirectly();
        IProgrammableLaunchStampRouterV2.NestedFactoryRouteV1 memory route = _route();
        route.factoryInitCodeHash ^= mutation;
        IProgrammableLaunchStampRouterV2.StampRequestV2 memory request = _request(route);
        IProgrammableLaunchStampRouterV2.LaunchPermitV2 memory permit = _permit(route, request, 3600);
        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableExactShardsProfileV1.InvalidShardsBinding.selector, uint8(1))
        );
        vm.prank(LAUNCH_WALLET);
        router.launchAndStampV2(permit, request, route, hex"01");
        assertEq(TOKEN.code.length, 0);
    }

    function testFuzz_permitBindingDriftAlwaysFails(uint8 rawField, bytes32 drift) public {
        vm.assume(drift != bytes32(0));
        IProgrammableLaunchStampRouterV2.NestedFactoryRouteV1 memory route = _route();
        IProgrammableLaunchStampRouterV2.StampRequestV2 memory request = _request(route);
        IProgrammableLaunchStampRouterV2.LaunchPermitV2 memory permit = _permit(route, request, 3600);
        uint8 field = uint8(bound(rawField, 0, 10));
        if (field == 0) {
            permit.chainId ^= uint256(drift);
        } else if (field == 1) {
            permit.router = address(uint160(permit.router) ^ uint160(1));
        } else if (field == 2) {
            permit.launchWallet = address(uint160(permit.launchWallet) ^ uint160(1));
        } else if (field == 3) {
            permit.routeIdHash ^= drift;
        } else if (field == 4) {
            permit.routeVersionHash ^= drift;
        } else if (field == 5) {
            permit.profileKey ^= drift;
        } else if (field == 6) {
            permit.routePayloadHash ^= drift;
        } else if (field == 7) {
            permit.expectedResultHash ^= drift;
        } else if (field == 8) {
            permit.stampRequestHash ^= drift;
        } else if (field == 9) {
            permit.nonce ^= drift;
        } else {
            permit.value = uint256(drift);
        }

        address profile = address(router.SHARDS_PROFILE());
        vm.mockCall(
            profile,
            abi.encodeWithSelector(IProgrammableExactShardsProfileV1.validatePreV1.selector),
            abi.encode(POOL_ID, POOL_KEY_HASH, EXPECTED_RESULT_HASH)
        );
        vm.expectRevert();
        vm.prank(LAUNCH_WALLET);
        router.launchAndStampV2(permit, request, route, hex"01");
        assertFalse(router.nonceUsed(LAUNCH_WALLET, LAUNCH_ID));
    }

    function _route() internal pure returns (IProgrammableLaunchStampRouterV2.NestedFactoryRouteV1 memory route) {
        bytes memory hookCreationCode = type(ShardHookV1).creationCode;
        IProgrammableNestedFactoryV1.LaunchParams memory params = IProgrammableNestedFactoryV1.LaunchParams({
            tickLower: -887_220,
            tickBand: 22_980,
            tickUpper: 69_060,
            startSqrtPriceX96: START_SQRT_PRICE_X96,
            renderer: address(0),
            tokenName: "Shard",
            tokenSymbol: "SHARD",
            nftName: "Shards",
            nftSymbol: "SHARDS"
        });
        route.profileIdHash = keccak256("exact-shards-nested-factory");
        route.profileVersionHash = keccak256("1.0.0");
        route.profileKey = 0xb90e215e0e29c0dacf021e5e778847af4100433ee7d22014b73f8ca4add09d0c;
        route.sourceRevisionHash = 0x3352fe14662ce467e98f475cf91f10304ce4d69b6342fae4bf3dc968c494d6dc;
        route.manifestHash = 0x4672dfda95c9765916397701479483b8e1db852165949518cdc9932fd8e1b359;
        route.revenuePolicyHash = 0xaa78b0bf63fca83fa9b969fbb6b2bb1ecabcbe49908a48f92403e8e51e4adab2;
        route.factoryDeploymentProxy = PROXY;
        route.factorySalt = FACTORY_SALT;
        route.factoryCreationCodeHash = keccak256(type(ShardLaunchFactoryV1).creationCode);
        route.factoryInitCodeHash = keccak256(_factoryInitcode());
        route.factoryDeploymentCalldataHash = keccak256(bytes.concat(FACTORY_SALT, _factoryInitcode()));
        route.factory = FACTORY;
        route.factoryRuntimeCodeHash = FACTORY_RUNTIME;
        route.renderer = RENDERER;
        route.rendererCreationCodeHash = keccak256(type(GeometricRendererV1).creationCode);
        route.rendererRuntimeCodeHash = RENDERER_RUNTIME;
        route.launcherFeeRecipient = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
        route.builderFeeRecipient = LAUNCH_WALLET;
        route.tokenCreationCodeHash = keccak256(type(ShardTokenV1).creationCode);
        route.hookCreationCodeHash = keccak256(hookCreationCode);
        route.nftCreationCodeHash = keccak256(type(ShardNFTV1).creationCode);
        route.tokenSalt = 0xca9944c923e24ba5cb3188a29b18c3305158e686e39473e91bbe31fc019816ab;
        route.effectiveTokenSalt = 0x2fb771368a131f3ebf686980b44c57230bf257f4b82e95a10ef46d9b2bd7db37;
        route.hookSalt = bytes32(uint256(0x52e1));
        route.hookCreationCode = hookCreationCode;
        route.params = params;
        route.expectedToken = TOKEN;
        route.expectedTokenRuntimeCodeHash = TOKEN_RUNTIME;
        route.expectedHook = HOOK;
        route.expectedHookRuntimeCodeHash = HOOK_RUNTIME;
        route.expectedNft = NFT;
        route.expectedNftRuntimeCodeHash = NFT_RUNTIME;
        route.expectedConfigurationHash = CONFIGURATION_HASH;
        route.expectedLaunchCalldataHash = keccak256(
            abi.encodeWithSelector(
                IProgrammableNestedFactoryV1.launch.selector,
                route.tokenSalt,
                route.hookSalt,
                route.hookCreationCode,
                route.params
            )
        );
    }

    function _request(IProgrammableLaunchStampRouterV2.NestedFactoryRouteV1 memory route)
        internal
        view
        returns (IProgrammableLaunchStampRouterV2.StampRequestV2 memory request)
    {
        request.token = TOKEN;
        request.tokenRuntimeCodeHash = TOKEN_RUNTIME;
        request.hook = HOOK;
        request.hookRuntimeCodeHash = HOOK_RUNTIME;
        request.nft = NFT;
        request.nftRuntimeCodeHash = NFT_RUNTIME;
        request.poolKey = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(TOKEN),
            fee: 0,
            tickSpacing: 60,
            hooks: IHooks(HOOK)
        });
        request.launchId =
            router.computeLaunchId(LAUNCH_WALLET, router.SHARDS_PROFILE_KEY(), router.computeRoutePayloadHash(route));
    }

    function _permit(
        IProgrammableLaunchStampRouterV2.NestedFactoryRouteV1 memory route,
        IProgrammableLaunchStampRouterV2.StampRequestV2 memory request,
        uint64 lifetime
    ) internal view returns (IProgrammableLaunchStampRouterV2.LaunchPermitV2 memory permit) {
        permit.chainId = 1;
        permit.router = address(router);
        permit.launchWallet = LAUNCH_WALLET;
        permit.routeIdHash = router.ROUTE_ID_HASH();
        permit.routeVersionHash = router.ROUTE_VERSION_HASH();
        permit.profileKey = router.SHARDS_PROFILE_KEY();
        permit.routePayloadHash = router.computeRoutePayloadHash(route);
        permit.expectedResultHash = router.computeExpectedResultHash(route, request);
        permit.stampRequestHash = router.computeStampRequestHash(request);
        permit.nonce = request.launchId;
        permit.validAfter = uint64(block.timestamp);
        permit.deadline = uint64(block.timestamp) + lifetime;
        permit.value = 0;
    }

    function _approve(IProgrammableLaunchStampRouterV2.LaunchPermitV2 memory permit) internal returns (bytes32 digest) {
        digest = router.permitDigest(permit);
        authority.setApproved(digest, true);
    }

    function _factoryInitcode() internal pure returns (bytes memory) {
        return bytes.concat(
            type(ShardLaunchFactoryV1).creationCode,
            abi.encode(IPoolManager(POOL_MANAGER), keccak256(type(ShardHookV1).creationCode))
        );
    }

    function _deployFactoryDirectly() internal {
        bytes memory proxyCalldata = bytes.concat(FACTORY_SALT, _factoryInitcode());
        (bool success, bytes memory result) = PROXY.call(proxyCalldata);
        assertTrue(success);
        assertEq(result.length, 20);
        address returned;
        assembly ("memory-safe") {
            returned := shr(96, mload(add(result, 0x20)))
        }
        assertEq(returned, FACTORY);
    }

    function _poolStateSlot() internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(POOL_ID, bytes32(uint256(6))));
    }

    function _assertRouterEvents(Vm.Log[] memory logs) internal view {
        bytes32 launchTopic = keccak256(
            "ProgrammableLaunchStampedV2(bytes32,address,address,address,address,address,address,bytes32,bytes32)"
        );
        bytes32 routeTopic = keccak256(
            "ProgrammableNestedFactoryRouteStampedV2(bytes32,bytes32,address,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32)"
        );
        uint256 launches;
        uint256 routes;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(router)) continue;
            if (logs[i].topics[0] == launchTopic) ++launches;
            if (logs[i].topics[0] == routeTopic) ++routes;
        }
        assertEq(launches, 1);
        assertEq(routes, 1);
    }
}
