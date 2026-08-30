// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import {
    ProgrammableV4MigrationDistributorV1
} from "../../src/robinhood-main-token/ProgrammableV4MigrationDistributorV1.sol";
import { ProgrammableV4TokenV1 } from "../../src/robinhood-main-token/ProgrammableV4TokenV1.sol";

contract ProgrammableV4MigrationV1Test is Test {
    uint256 internal constant TARGET_CHAIN_ID = 4663;
    uint256 internal constant SOURCE_CHAIN_ID = 1;
    uint256 internal constant TOTAL_SUPPLY = 1_000_000_000 ether;
    uint256 internal constant SOURCE_DEADLINE_TIMESTAMP_EXCLUSIVE = 1_900_000_000;
    uint256 internal constant INDEX_ALICE = 7;
    uint256 internal constant INDEX_BOB = 300;
    uint256 internal constant AMOUNT_ALICE = 400 ether;
    uint256 internal constant AMOUNT_BOB = 600 ether;

    bytes32 internal constant RELEASE_ID_HASH = keccak256("v4-ethereum-to-robinhood-96h-2026-v1");
    bytes32 internal constant SNAPSHOT_RULE_HASH = keccak256(
        "first-canonical-block-at-or-after-timestamp|block.timestamp >= windowStart && block.timestamp < deadline|1:1 raw token units|same EVM recipient only"
    );
    bytes32 internal constant SOURCE_SNAPSHOT_SHA256 = keccak256("final-source-snapshot");
    address internal constant SOURCE_TOKEN = 0x7987f03462200b3D8A072E02C89A8A41dCB124EE;
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);
    address internal constant CALLER = address(0xCA11E2);
    address internal constant OUTSIDER = address(0xBAD);
    address internal constant REMAINDER_RECIPIENT = address(0xBEEF);

    ProgrammableV4TokenV1 internal token;
    ProgrammableV4MigrationDistributorV1 internal distributor;
    bytes32 internal leafAlice;
    bytes32 internal leafBob;
    bytes32 internal root;

    function setUp() public {
        vm.chainId(TARGET_CHAIN_ID);
        vm.warp(SOURCE_DEADLINE_TIMESTAMP_EXCLUSIVE - 1 days);
        token = new ProgrammableV4TokenV1(
            RELEASE_ID_HASH,
            SOURCE_CHAIN_ID,
            SOURCE_TOKEN,
            SOURCE_DEADLINE_TIMESTAMP_EXCLUSIVE,
            SNAPSHOT_RULE_HASH,
            address(this),
            REMAINDER_RECIPIENT
        );
        distributor = token.MIGRATION_DISTRIBUTOR();
        leafAlice = _leaf(INDEX_ALICE, ALICE, AMOUNT_ALICE);
        leafBob = _leaf(INDEX_BOB, BOB, AMOUNT_BOB);
        root = _hashPair(leafAlice, leafBob);
    }

    function test_deploymentLocksTheFixedSupplyWithoutAdministrativeSurface() public view {
        assertEq(token.name(), "Programmable");
        assertEq(token.symbol(), "V4");
        assertEq(token.decimals(), 18);
        assertEq(token.totalSupply(), TOTAL_SUPPLY);
        assertEq(token.balanceOf(address(distributor)), TOTAL_SUPPLY);
        assertEq(address(distributor.TOKEN()), address(token));
        assertEq(distributor.RELEASE_ID_HASH(), RELEASE_ID_HASH);
        assertEq(distributor.SOURCE_CHAIN_ID(), SOURCE_CHAIN_ID);
        assertEq(distributor.SOURCE_TOKEN(), SOURCE_TOKEN);
        assertEq(distributor.SOURCE_DEADLINE_TIMESTAMP_EXCLUSIVE(), SOURCE_DEADLINE_TIMESTAMP_EXCLUSIVE);
        assertEq(distributor.SNAPSHOT_RULE_HASH(), SNAPSHOT_RULE_HASH);
        assertEq(distributor.SEAL_AUTHORITY(), address(this));
        assertEq(distributor.REMAINDER_RECIPIENT(), REMAINDER_RECIPIENT);
        assertFalse(distributor.isSealed());
    }

    function test_noMintOwnerRescueSweepOrRedirectEntryPointExists() public {
        (bool mintSucceeded,) = address(token).call(abi.encodeWithSignature("mint(address,uint256)", ALICE, 1));
        (bool ownerSucceeded,) = address(token).call(abi.encodeWithSignature("owner()"));
        (bool rescueSucceeded,) = address(distributor)
            .call(abi.encodeWithSignature("rescue(address,address,uint256)", address(token), ALICE, 1));
        (bool sweepSucceeded,) = address(distributor).call(abi.encodeWithSignature("sweep(address)", ALICE));
        (bool redirectedDistributionSucceeded,) = address(distributor)
            .call(
                abi.encodeWithSignature(
                    "distribute(uint256,address,address,uint256,bytes32[])",
                    INDEX_ALICE,
                    ALICE,
                    OUTSIDER,
                    AMOUNT_ALICE,
                    new bytes32[](0)
                )
            );

        assertFalse(mintSucceeded);
        assertFalse(ownerSucceeded);
        assertFalse(rescueSucceeded);
        assertFalse(sweepSucceeded);
        assertFalse(redirectedDistributionSucceeded);
        assertEq(token.totalSupply(), TOTAL_SUPPLY);
    }

    function test_wrongTargetChainCannotDeploy() public {
        vm.chainId(1);
        vm.expectRevert(abi.encodeWithSelector(ProgrammableV4TokenV1.InvalidChain.selector, 1, TARGET_CHAIN_ID));
        new ProgrammableV4TokenV1(
            RELEASE_ID_HASH,
            SOURCE_CHAIN_ID,
            SOURCE_TOKEN,
            SOURCE_DEADLINE_TIMESTAMP_EXCLUSIVE,
            SNAPSHOT_RULE_HASH,
            address(this),
            REMAINDER_RECIPIENT
        );
    }

    function test_distributionCannotRunBeforeSeal() public {
        vm.expectRevert(ProgrammableV4MigrationDistributorV1.DistributionNotSealed.selector);
        distributor.distribute(INDEX_ALICE, ALICE, AMOUNT_ALICE, _proof(leafBob));
    }

    function test_sealCannotRunBeforeTheFrozenSourceDeadline() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableV4MigrationDistributorV1.SealBeforeSourceDeadline.selector,
                block.timestamp,
                SOURCE_DEADLINE_TIMESTAMP_EXCLUSIVE
            )
        );
        distributor.seal(root, SOURCE_SNAPSHOT_SHA256, AMOUNT_ALICE + AMOUNT_BOB);
    }

    function test_sealIsAuthorizedOnceAndReleasesTheExactRemainder() public {
        vm.prank(OUTSIDER);
        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableV4MigrationDistributorV1.UnauthorizedSeal.selector, OUTSIDER)
        );
        distributor.seal(root, SOURCE_SNAPSHOT_SHA256, AMOUNT_ALICE + AMOUNT_BOB);

        vm.warp(SOURCE_DEADLINE_TIMESTAMP_EXCLUSIVE);
        distributor.seal(root, SOURCE_SNAPSHOT_SHA256, AMOUNT_ALICE + AMOUNT_BOB);

        uint256 migrationTotal = AMOUNT_ALICE + AMOUNT_BOB;
        assertTrue(distributor.isSealed());
        assertEq(distributor.merkleRoot(), root);
        assertEq(distributor.sourceSnapshotSha256(), SOURCE_SNAPSHOT_SHA256);
        assertEq(distributor.migrationTotalRaw(), migrationTotal);
        assertEq(token.balanceOf(address(distributor)), migrationTotal);
        assertEq(token.balanceOf(REMAINDER_RECIPIENT), TOTAL_SUPPLY - migrationTotal);

        vm.expectRevert(ProgrammableV4MigrationDistributorV1.AlreadySealed.selector);
        distributor.seal(root, keccak256("different snapshot"), migrationTotal);
    }

    function test_permissionlessSingleDistributionHasExactRecipientAndDuplicateProtection() public {
        _seal();

        vm.prank(CALLER);
        distributor.distribute(INDEX_ALICE, ALICE, AMOUNT_ALICE, _proof(leafBob));

        assertEq(token.balanceOf(ALICE), AMOUNT_ALICE);
        assertEq(token.balanceOf(CALLER), 0);
        assertTrue(distributor.isDistributed(INDEX_ALICE));
        assertFalse(distributor.isDistributed(INDEX_BOB));
        assertEq(distributor.totalDistributedRaw(), AMOUNT_ALICE);
        assertEq(distributor.remainingMigrationRaw(), AMOUNT_BOB);

        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableV4MigrationDistributorV1.AlreadyDistributed.selector, INDEX_ALICE)
        );
        distributor.distribute(INDEX_ALICE, ALICE, AMOUNT_ALICE, _proof(leafBob));
    }

    function test_proofCannotBeRedirectedOrChangeTheAmount() public {
        _seal();
        bytes32[] memory aliceProof = _proof(leafBob);

        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableV4MigrationDistributorV1.InvalidProof.selector, INDEX_ALICE, OUTSIDER, AMOUNT_ALICE
            )
        );
        distributor.distribute(INDEX_ALICE, OUTSIDER, AMOUNT_ALICE, aliceProof);

        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableV4MigrationDistributorV1.InvalidProof.selector, INDEX_ALICE, ALICE, AMOUNT_ALICE + 1
            )
        );
        distributor.distribute(INDEX_ALICE, ALICE, AMOUNT_ALICE + 1, aliceProof);

        assertEq(token.balanceOf(ALICE), 0);
        assertEq(token.balanceOf(OUTSIDER), 0);
        assertFalse(distributor.isDistributed(INDEX_ALICE));
    }

    function test_unsolicitedTokenDustCannotBlockLaterDistribution() public {
        _seal();
        distributor.distribute(INDEX_ALICE, ALICE, AMOUNT_ALICE, _proof(leafBob));

        vm.prank(ALICE);
        token.transfer(address(distributor), 1);
        distributor.distribute(INDEX_BOB, BOB, AMOUNT_BOB, _proof(leafAlice));

        assertEq(token.balanceOf(BOB), AMOUNT_BOB);
        assertEq(distributor.totalDistributedRaw(), AMOUNT_ALICE + AMOUNT_BOB);
        assertEq(distributor.remainingMigrationRaw(), 0);
        assertEq(token.balanceOf(address(distributor)), 1);
    }

    function test_allocationMerkleKnownAnswerMatchesThePublicNodeVector() public view {
        bytes32 snapshotSha256 = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef;
        bytes32 leaf0 = _knownAnswerLeaf(0, address(0x1111111111111111111111111111111111111111), 100, snapshotSha256);
        bytes32 leaf1 = _knownAnswerLeaf(1, address(0x2222222222222222222222222222222222222222), 200, snapshotSha256);
        bytes32 leaf2 = _knownAnswerLeaf(2, address(0x3333333333333333333333333333333333333333), 300, snapshotSha256);

        assertEq(leaf0, 0xfaac6d5d4d5000374eef29617bfbf20d13c0d0d7cb0a256e803c8518fa9fca29);
        assertEq(leaf1, 0x54f3d4d3349d19a27efa50969ee5098a55be7868b7baeeaf151179605d90191a);
        assertEq(leaf2, 0x39e7c088ab62e59234e785bd6b787d0125d6a4d6d956f944433f5c3b7245b24d);
        bytes32 pair = _hashPair(leaf0, leaf1);
        assertEq(pair, 0xd11907ca87401ab5f42b41d9eb9606fd704d42673bc822356e607e77ed5bcf7f);
        assertEq(_hashPair(pair, leaf2), 0x701000a3e13361cb07c7a9da4707ab970a33884226af429cd28ce48ce8fa21b4);
    }

    function test_permissionlessBoundedBatchDistributesTheExactSealedSum() public {
        _seal();
        ProgrammableV4MigrationDistributorV1.Allocation[] memory allocations =
            new ProgrammableV4MigrationDistributorV1.Allocation[](2);
        allocations[0] = ProgrammableV4MigrationDistributorV1.Allocation({
            index: INDEX_ALICE, account: ALICE, amountRaw: AMOUNT_ALICE, proof: _proof(leafBob)
        });
        allocations[1] = ProgrammableV4MigrationDistributorV1.Allocation({
            index: INDEX_BOB, account: BOB, amountRaw: AMOUNT_BOB, proof: _proof(leafAlice)
        });

        vm.prank(CALLER);
        distributor.distributeBatch(allocations);

        assertEq(token.balanceOf(ALICE), AMOUNT_ALICE);
        assertEq(token.balanceOf(BOB), AMOUNT_BOB);
        assertEq(token.balanceOf(CALLER), 0);
        assertEq(token.balanceOf(address(distributor)), 0);
        assertEq(distributor.totalDistributedRaw(), AMOUNT_ALICE + AMOUNT_BOB);
        assertEq(distributor.remainingMigrationRaw(), 0);
        assertTrue(distributor.isDistributed(INDEX_ALICE));
        assertTrue(distributor.isDistributed(INDEX_BOB));
    }

    function test_emptyBatchAndInvalidSecondEntryRevertAtomically() public {
        _seal();
        ProgrammableV4MigrationDistributorV1.Allocation[] memory empty =
            new ProgrammableV4MigrationDistributorV1.Allocation[](0);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableV4MigrationDistributorV1.BatchSizeOutsideBounds.selector, 0, distributor.MAX_BATCH_SIZE()
            )
        );
        distributor.distributeBatch(empty);

        ProgrammableV4MigrationDistributorV1.Allocation[] memory allocations =
            new ProgrammableV4MigrationDistributorV1.Allocation[](2);
        allocations[0] = ProgrammableV4MigrationDistributorV1.Allocation({
            index: INDEX_ALICE, account: ALICE, amountRaw: AMOUNT_ALICE, proof: _proof(leafBob)
        });
        allocations[1] = ProgrammableV4MigrationDistributorV1.Allocation({
            index: INDEX_BOB, account: BOB, amountRaw: AMOUNT_BOB + 1, proof: _proof(leafAlice)
        });
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableV4MigrationDistributorV1.InvalidProof.selector, INDEX_BOB, BOB, AMOUNT_BOB + 1
            )
        );
        distributor.distributeBatch(allocations);

        assertEq(token.balanceOf(ALICE), 0);
        assertEq(token.balanceOf(BOB), 0);
        assertFalse(distributor.isDistributed(INDEX_ALICE));
        assertFalse(distributor.isDistributed(INDEX_BOB));
        assertEq(distributor.totalDistributedRaw(), 0);
    }

    function test_bitmapBoundaryIndices255And256AreIndependent() public {
        uint256 amount255 = 255;
        uint256 amount256 = 256;
        bytes32 leaf255 = _leaf(255, ALICE, amount255);
        bytes32 leaf256 = _leaf(256, BOB, amount256);
        bytes32 boundaryRoot = _hashPair(leaf255, leaf256);
        vm.warp(SOURCE_DEADLINE_TIMESTAMP_EXCLUSIVE);
        distributor.seal(boundaryRoot, SOURCE_SNAPSHOT_SHA256, amount255 + amount256);

        distributor.distribute(255, ALICE, amount255, _proof(leaf256));
        distributor.distribute(256, BOB, amount256, _proof(leaf255));

        assertTrue(distributor.isDistributed(255));
        assertTrue(distributor.isDistributed(256));
        assertEq(token.balanceOf(ALICE), amount255);
        assertEq(token.balanceOf(BOB), amount256);
    }

    function test_batchIsBoundedBeforeAnyProofExecution() public {
        _seal();
        ProgrammableV4MigrationDistributorV1.Allocation[] memory allocations =
            new ProgrammableV4MigrationDistributorV1.Allocation[](65);

        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableV4MigrationDistributorV1.BatchSizeOutsideBounds.selector, 65, distributor.MAX_BATCH_SIZE()
            )
        );
        distributor.distributeBatch(allocations);
    }

    function _seal() private {
        vm.warp(SOURCE_DEADLINE_TIMESTAMP_EXCLUSIVE);
        distributor.seal(root, SOURCE_SNAPSHOT_SHA256, AMOUNT_ALICE + AMOUNT_BOB);
        assertEq(distributor.allocationLeaf(INDEX_ALICE, ALICE, AMOUNT_ALICE), leafAlice);
        assertEq(distributor.allocationLeaf(INDEX_BOB, BOB, AMOUNT_BOB), leafBob);
    }

    function _leaf(uint256 index, address account, uint256 amountRaw) private view returns (bytes32) {
        return keccak256(
            bytes.concat(
                keccak256(
                    abi.encode(
                        distributor.ALLOCATION_TYPEHASH(),
                        TARGET_CHAIN_ID,
                        RELEASE_ID_HASH,
                        SOURCE_CHAIN_ID,
                        SOURCE_TOKEN,
                        SOURCE_DEADLINE_TIMESTAMP_EXCLUSIVE,
                        SNAPSHOT_RULE_HASH,
                        SOURCE_SNAPSHOT_SHA256,
                        index,
                        account,
                        amountRaw
                    )
                )
            )
        );
    }

    function _knownAnswerLeaf(uint256 index, address account, uint256 amountRaw, bytes32 snapshotSha256)
        private
        view
        returns (bytes32)
    {
        return keccak256(
            bytes.concat(
                keccak256(
                    abi.encode(
                        distributor.ALLOCATION_TYPEHASH(),
                        TARGET_CHAIN_ID,
                        RELEASE_ID_HASH,
                        SOURCE_CHAIN_ID,
                        SOURCE_TOKEN,
                        SOURCE_DEADLINE_TIMESTAMP_EXCLUSIVE,
                        SNAPSHOT_RULE_HASH,
                        snapshotSha256,
                        index,
                        account,
                        amountRaw
                    )
                )
            )
        );
    }

    function _hashPair(bytes32 left, bytes32 right) private pure returns (bytes32) {
        return left < right ? keccak256(bytes.concat(left, right)) : keccak256(bytes.concat(right, left));
    }

    function _proof(bytes32 sibling) private pure returns (bytes32[] memory proof) {
        proof = new bytes32[](1);
        proof[0] = sibling;
    }
}
