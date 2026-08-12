// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { ProgrammableExactShardsAtomicLaunchRouteV1 } from "../src/ProgrammableExactShardsAtomicLaunchRouteV1.sol";
import {
    ProgrammableGithubRepositoryLineageRegistryV1
} from "../src/ProgrammableGithubRepositoryLineageRegistryV1.sol";
import { IProgrammableExactShardsLaunchFactoryV1 } from "../src/interfaces/IProgrammableExactShardsLaunchFactoryV1.sol";
import { IProgrammableExactShardsRegistryV1 } from "../src/interfaces/IProgrammableExactShardsRegistryV1.sol";

contract MockShardsMetadataTokenV1 {
    string public name;
    string public symbol;

    constructor(string memory name_, string memory symbol_) {
        name = name_;
        symbol = symbol_;
    }
}

contract MockShardsSatelliteV1 { }

contract MockExactShardsFactoryV1 {
    uint256 public successfulLaunchCount;

    function predictToken(bytes32 tokenSalt, IProgrammableExactShardsLaunchFactoryV1.LaunchParams calldata params)
        external
        view
        returns (address)
    {
        bytes32 initCodeHash = keccak256(
            bytes.concat(type(MockShardsMetadataTokenV1).creationCode, abi.encode(params.tokenName, params.tokenSymbol))
        );
        return
            address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), tokenSalt, initCodeHash)))));
    }

    function launch(
        bytes32 tokenSalt,
        bytes32,
        bytes calldata,
        IProgrammableExactShardsLaunchFactoryV1.LaunchParams calldata params
    ) external returns (address hook, address shard, address nft) {
        shard = address(new MockShardsMetadataTokenV1{ salt: tokenSalt }(params.tokenName, params.tokenSymbol));
        hook = address(new MockShardsSatelliteV1{ salt: keccak256(abi.encode("hook", shard)) }());
        nft = address(new MockShardsSatelliteV1{ salt: keccak256(abi.encode("nft", shard)) }());
        successfulLaunchCount++;
    }

    function predictHook(address shard) external view returns (address) {
        return _predictSatellite(keccak256(abi.encode("hook", shard)));
    }

    function predictNft(address shard) external view returns (address) {
        return _predictSatellite(keccak256(abi.encode("nft", shard)));
    }

    function _predictSatellite(bytes32 salt) private view returns (address) {
        return address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            bytes1(0xff), address(this), salt, keccak256(type(MockShardsSatelliteV1).creationCode)
                        )
                    )
                )
            )
        );
    }
}

contract MockAtomicShardsRegistryV1 {
    uint256 public registrationCount;
    bool public failRegistration;
    bytes32 public lastLaunchId;

    error ForcedRegistrationFailure();

    function setFailRegistration(bool value) external {
        failRegistration = value;
    }

    function registerLaunch(IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 calldata registration) external {
        if (failRegistration) revert ForcedRegistrationFailure();
        registrationCount++;
        lastLaunchId = registration.launchId;
    }
}

contract ProgrammableExactShardsAtomicLaunchRouteV1Test is Test {
    address internal constant ADMIN = address(0xA11CE);
    address internal constant LAUNCHER = address(0x51A4D5);
    uint64 internal constant SHARDS_GITHUB_REPOSITORY_ID = 1_329_073_878;

    ProgrammableGithubRepositoryLineageRegistryV1 internal lineageRegistry;
    MockExactShardsFactoryV1 internal factory;
    MockAtomicShardsRegistryV1 internal registry;
    ProgrammableExactShardsAtomicLaunchRouteV1 internal routeA;
    ProgrammableExactShardsAtomicLaunchRouteV1 internal routeB;

    function setUp() public {
        lineageRegistry = new ProgrammableGithubRepositoryLineageRegistryV1(2 days, ADMIN);
        factory = new MockExactShardsFactoryV1();
        registry = new MockAtomicShardsRegistryV1();
        routeA = _newRoute();
        routeB = _newRoute();

        vm.startPrank(ADMIN);
        lineageRegistry.grantRole(lineageRegistry.CONSUMER_ROLE(), address(routeA));
        lineageRegistry.grantRole(lineageRegistry.CONSUMER_ROLE(), address(routeB));
        vm.stopPrank();
    }

    function test_selectedWebsiteNameAndTickerAreProducedAndRegisteredAtomically() public {
        IProgrammableExactShardsLaunchFactoryV1.LaunchParams memory params = _params("Fragment", "FRAG");
        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration =
            _registration("selected", bytes32("selected-salt"), params);

        vm.prank(LAUNCHER);
        (, address shard,) = routeA.launch(registration, bytes32("selected-salt"), bytes32(0), hex"01", params);

        assertEq(MockShardsMetadataTokenV1(shard).name(), "Fragment");
        assertEq(MockShardsMetadataTokenV1(shard).symbol(), "FRAG");
        assertEq(factory.successfulLaunchCount(), 1);
        assertEq(registry.registrationCount(), 1);
        assertEq(registry.lastLaunchId(), registration.launchId);
    }

    function test_twoAuthorizedRoutesForSameRepositoryLeaveOnlyOneTokenDeployment() public {
        IProgrammableExactShardsLaunchFactoryV1.LaunchParams memory firstParams = _params("First", "ONE");
        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory first =
            _registration("first", bytes32("first-salt"), firstParams);
        vm.prank(LAUNCHER);
        routeA.launch(first, bytes32("first-salt"), bytes32(0), hex"01", firstParams);

        IProgrammableExactShardsLaunchFactoryV1.LaunchParams memory secondParams = _params("Second", "TWO");
        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory second =
            _registration("second", bytes32("second-salt"), secondParams);
        address losingHook = factory.predictHook(second.primaryContract);
        address losingNft = factory.predictNft(second.primaryContract);
        vm.expectPartialRevert(ProgrammableGithubRepositoryLineageRegistryV1.RepositoryAlreadyConsumed.selector);
        vm.prank(LAUNCHER);
        routeB.launch(second, bytes32("second-salt"), bytes32(0), hex"01", secondParams);

        assertEq(factory.successfulLaunchCount(), 1);
        assertEq(registry.registrationCount(), 1);
        assertEq(second.primaryContract.code.length, 0);
        assertEq(losingHook.code.length, 0);
        assertEq(losingNft.code.length, 0);
    }

    function test_downstreamRegistrationRevertRollsBackConsumptionAndTokenDeployment() public {
        IProgrammableExactShardsLaunchFactoryV1.LaunchParams memory params = _params("Rollback", "ROLL");
        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration =
            _registration("rollback", bytes32("rollback-salt"), params);
        address rolledBackHook = factory.predictHook(registration.primaryContract);
        address rolledBackNft = factory.predictNft(registration.primaryContract);
        registry.setFailRegistration(true);

        vm.expectRevert(MockAtomicShardsRegistryV1.ForcedRegistrationFailure.selector);
        vm.prank(LAUNCHER);
        routeA.launch(registration, bytes32("rollback-salt"), bytes32(0), hex"01", params);

        bytes32 repositoryKey = lineageRegistry.computeRepositoryKey(SHARDS_GITHUB_REPOSITORY_ID);
        assertEq(lineageRegistry.consumption(repositoryKey).launchId, bytes32(0));
        assertEq(factory.successfulLaunchCount(), 0);
        assertEq(registration.primaryContract.code.length, 0);
        assertEq(rolledBackHook.code.length, 0);
        assertEq(rolledBackNft.code.length, 0);

        registry.setFailRegistration(false);
        vm.prank(LAUNCHER);
        routeA.launch(registration, bytes32("rollback-salt"), bytes32(0), hex"01", params);
        assertEq(factory.successfulLaunchCount(), 1);
    }

    function test_routeHasNoStandaloneConsumeSelector() public {
        (bool ok,) = address(routeA)
            .call(
                abi.encodeWithSelector(
                    bytes4(keccak256("consume(uint64,bytes32,bytes32)")),
                    SHARDS_GITHUB_REPOSITORY_ID,
                    keccak256("standalone"),
                    routeA.ROUTE_ID()
                )
            );
        assertFalse(ok);
        assertEq(lineageRegistry.consumptionCount(), 0);
    }

    function test_deploymentPolicyAllowsOnlyExactAtomicRouteAndRemainsInactive() public view {
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/spec/shards-atomic-launch-route-v1.json"));
        assertEq(vm.parseJsonString(json, ".schemaVersion"), "programmable.exact-shards-atomic-launch-route.v1");
        assertFalse(vm.parseJsonBool(json, ".activationAllowed"));
        assertFalse(vm.parseJsonBool(json, ".launchAllowed"));
        assertEq(vm.parseJsonString(json, ".canonicalDeployment.sharedRepositoryLineageRegistry.addressState"), "UNSET");
        assertEq(vm.parseJsonString(json, ".canonicalDeployment.exactShardsRegistry.addressState"), "UNSET");
        assertEq(vm.parseJsonString(json, ".canonicalDeployment.exactShardsAtomicRoute.addressState"), "UNSET");
        assertFalse(vm.parseJsonBool(json, ".compiler.viaIr"));
        assertEq(vm.parseJsonUint(json, ".compiler.optimizerRuns"), 1000);
        assertTrue(
            vm.parseJsonBool(
                json, ".canonicalDeployment.sharedRepositoryLineageRegistry.oneCanonicalInstanceForEveryRouteAndFactory"
            )
        );
        assertFalse(vm.parseJsonBool(json, ".atomicTopology.standaloneConsumeSelector"));
        assertTrue(vm.parseJsonBool(json, ".atomicTopology.sameEvmTransaction"));
        assertTrue(
            vm.parseJsonBool(json, ".atomicTopology.downstreamRevertRollsBackFactoryDeploymentLineageAndRegistration")
        );
        assertEq(
            vm.parseJsonStringArray(json, ".rolePolicy.requiredConsumerRoleGrantTargets")[0],
            "EXACT_REVIEWED_ATOMIC_ROUTE_CONTRACT"
        );
        string[] memory forbidden = vm.parseJsonStringArray(json, ".rolePolicy.forbiddenConsumerRoleGrantTargets");
        assertEq(forbidden.length, 5);
        assertEq(forbidden[0], "EOA");
        assertEq(forbidden[1], "SHARDS_REGISTRY");
        assertEq(forbidden[2], "DIRECT_SHARDS_FACTORY");
        assertEq(forbidden[3], "ARBITRARY_ADAPTER");
        assertEq(forbidden[4], "CONTRACT_WITH_STANDALONE_CONSUME_SELECTOR");
        assertEq(
            keccak256(type(ProgrammableExactShardsAtomicLaunchRouteV1).creationCode),
            vm.parseJsonBytes32(json, ".artifacts.route.creationCodeKeccak256")
        );
        string memory buildArtifact = vm.readFile(
            string.concat(
                vm.projectRoot(),
                "/out/ProgrammableExactShardsAtomicLaunchRouteV1.sol/ProgrammableExactShardsAtomicLaunchRouteV1.json"
            )
        );
        bytes memory unlinkedRuntime = vm.parseBytes(vm.parseJsonString(buildArtifact, ".deployedBytecode.object"));
        assertEq(keccak256(unlinkedRuntime), vm.parseJsonBytes32(json, ".artifacts.route.unlinkedRuntimeCodeKeccak256"));
        assertEq(unlinkedRuntime.length, vm.parseJsonUint(json, ".artifacts.route.unlinkedRuntimeCodeByteLength"));
        assertEq(
            24_576 - unlinkedRuntime.length, vm.parseJsonUint(json, ".artifacts.route.runtimeCodeLimitMarginBytes")
        );
    }

    function _newRoute() private returns (ProgrammableExactShardsAtomicLaunchRouteV1) {
        return new ProgrammableExactShardsAtomicLaunchRouteV1(
            lineageRegistry,
            IProgrammableExactShardsLaunchFactoryV1(address(factory)),
            IProgrammableExactShardsRegistryV1(address(registry)),
            address(factory).codehash
        );
    }

    function _params(string memory name, string memory symbol)
        private
        pure
        returns (IProgrammableExactShardsLaunchFactoryV1.LaunchParams memory params)
    {
        params.tickLower = -120;
        params.tickBand = 60;
        params.tickUpper = 120;
        params.startSqrtPriceX96 = uint160(1 << 96);
        params.tokenName = name;
        params.tokenSymbol = symbol;
        params.nftName = string.concat(name, " Pieces");
        params.nftSymbol = string.concat(symbol, "N");
    }

    function _registration(
        string memory label,
        bytes32 tokenSalt,
        IProgrammableExactShardsLaunchFactoryV1.LaunchParams memory params
    ) private view returns (IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration) {
        registration.githubRepositoryId = SHARDS_GITHUB_REPOSITORY_ID;
        registration.launchId = keccak256(bytes(label));
        registration.launchWallet = LAUNCHER;
        registration.tokenNameHash = keccak256(bytes(params.tokenName));
        registration.tokenSymbolHash = keccak256(bytes(params.tokenSymbol));
        registration.primaryContract = factory.predictToken(tokenSalt, params);
        registration.primaryRuntimeCodeHash = keccak256(type(MockShardsMetadataTokenV1).runtimeCode);
    }
}
