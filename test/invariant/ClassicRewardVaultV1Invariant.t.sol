// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { StdInvariant } from "forge-std/StdInvariant.sol";
import { Test } from "forge-std/Test.sol";

import { ClassicCtoAuthorityV1 } from "../../src/ClassicCtoAuthorityV1.sol";
import { ClassicRewardVaultFactoryV1 } from "../../src/ClassicRewardVaultFactoryV1.sol";
import { ClassicRewardVaultV1 } from "../../src/ClassicRewardVaultV1.sol";
import { IClassicCtoVaultV1 } from "../../src/interfaces/IClassicCtoVaultV1.sol";
import { IClassicFeeHookV3 } from "../../src/interfaces/IClassicFeeHookV3.sol";

contract ClassicRewardInvariantPoolManager {
    function pay(address recipient, uint256 amount) external {
        (bool success,) = recipient.call{ value: amount }("");
        require(success);
    }

    receive() external payable {
        // Invariant pool manager accepts native settlement.
    }
}

contract ClassicRewardInvariantHook is IClassicFeeHookV3 {
    IPoolManager public immutable override poolManager;
    mapping(bytes32 poolId => uint256 amount) public accrued;

    constructor(IPoolManager poolManager_) {
        poolManager = poolManager_;
    }

    function addAccrued(bytes32 poolId, uint256 amount) external {
        accrued[poolId] += amount;
    }

    function creatorFeesAccrued(bytes32 poolId) external view returns (uint256) {
        return accrued[poolId];
    }

    function claimCreatorFees(bytes32 poolId) external returns (uint256 amount) {
        amount = accrued[poolId];
        accrued[poolId] = 0;
        ClassicRewardInvariantPoolManager(payable(address(poolManager))).pay(msg.sender, amount);
    }
}

    contract ClassicRewardInvariantActor {
        ClassicRewardVaultV1 internal vault;

        function configure(ClassicRewardVaultV1 vault_) external {
            require(address(vault) == address(0));
            vault = vault_;
        }

        function claim() external {
            try vault.claim() { } catch { }
        }

        function changePayoutWallet(uint256 allocationIndex, address newPayoutWallet) external {
            try vault.changePayoutWallet(allocationIndex, newPayoutWallet) { } catch { }
        }

        receive() external payable {
            // Actor balances are checked against claimed accounting.
        }
    }

    contract ClassicRewardInvariantCtoActor {
        ClassicCtoAuthorityV1 internal immutable ctoAuthority;
        address internal controller;

        constructor(ClassicCtoAuthorityV1 ctoAuthority_) {
            ctoAuthority = ctoAuthority_;
        }

        function configure(address controller_) external {
            require(controller == address(0));
            controller = controller_;
        }

        function executeCto(
            IClassicCtoVaultV1 vault,
            address[] memory beneficiaries,
            uint16[] memory shares,
            bytes32 approvalReference
        ) external {
            require(msg.sender == controller);
            ctoAuthority.executeCto(vault, beneficiaries, shares, approvalReference);
        }
    }

    contract ClassicRewardVaultInvariantHandler {
        bytes32 internal constant POOL_ID = keccak256("classic-reward-invariant");

        ClassicRewardInvariantHook internal immutable hook;
        ClassicRewardInvariantCtoActor internal immutable ctoActor;
        ClassicRewardVaultV1 internal immutable vault;
        ClassicRewardInvariantActor[] internal actors;

        constructor(
            ClassicRewardInvariantHook hook_,
            ClassicRewardInvariantCtoActor ctoActor_,
            ClassicRewardVaultV1 vault_,
            ClassicRewardInvariantActor[] memory actors_
        ) {
            hook = hook_;
            ctoActor = ctoActor_;
            vault = vault_;
            for (uint256 index; index < actors_.length; index++) {
                actors.push(actors_[index]);
            }
        }

        function accrue(uint96 rawAmount) external {
            uint256 amount = 1 + (uint256(rawAmount) % 1 ether);
            hook.addAccrued(POOL_ID, amount);
        }

        function claim(uint8 rawActor) external {
            actors[uint256(rawActor) % actors.length].claim();
        }

        function changePayoutWallet(uint8 rawOwner, uint8 rawIndex, uint8 rawDestination) external {
            ClassicRewardInvariantActor owner = actors[uint256(rawOwner) % actors.length];
            address destination = address(actors[uint256(rawDestination) % actors.length]);
            owner.changePayoutWallet(uint256(rawIndex) % 5, destination);
        }

        function executeCto(uint8 rawConfiguration) external {
            uint256 configuration = uint256(rawConfiguration) % 4;
            uint256 count = configuration == 0 ? 1 : configuration == 1 ? 2 : configuration == 2 ? 3 : 5;
            address[] memory beneficiaries = new address[](count);
            uint16[] memory shares = new uint16[](count);

            for (uint256 index; index < count; index++) {
                beneficiaries[index] = address(actors[index]);
            }
            if (count == 1) {
                shares[0] = 10_000;
            } else if (count == 2) {
                shares[0] = 4000;
                shares[1] = 6000;
            } else if (count == 3) {
                shares[0] = 2000;
                shares[1] = 3000;
                shares[2] = 5000;
            } else {
                shares[0] = 1000;
                shares[1] = 1500;
                shares[2] = 2000;
                shares[3] = 2500;
                shares[4] = 3000;
            }

            bytes32 approvalReference = keccak256(abi.encode("invariant-cto", rawConfiguration, block.number));
            ctoActor.executeCto(IClassicCtoVaultV1(address(vault)), beneficiaries, shares, approvalReference);
        }
    }

    contract ClassicRewardVaultV1InvariantTest is StdInvariant, Test {
        bytes32 internal constant POOL_ID = keccak256("classic-reward-invariant");

        ClassicRewardInvariantPoolManager internal manager;
        ClassicRewardInvariantHook internal hook;
        ClassicCtoAuthorityV1 internal ctoAuthority;
        ClassicRewardInvariantCtoActor internal ctoActor;
        ClassicRewardVaultFactoryV1 internal factory;
        ClassicRewardVaultV1 internal vault;
        ClassicRewardVaultInvariantHandler internal handler;
        ClassicRewardInvariantActor[] internal actors;

        function setUp() public {
            manager = new ClassicRewardInvariantPoolManager();
            hook = new ClassicRewardInvariantHook(IPoolManager(address(manager)));
            vm.deal(address(manager), 1_000_000 ether);

            for (uint256 index; index < 5; index++) {
                actors.push(new ClassicRewardInvariantActor());
            }
            ClassicRewardInvariantActor[] memory actorList = new ClassicRewardInvariantActor[](actors.length);
            for (uint256 index; index < actors.length; index++) {
                actorList[index] = actors[index];
            }

            ctoAuthority = new ClassicCtoAuthorityV1(address(this));
            ctoActor = new ClassicRewardInvariantCtoActor(ctoAuthority);
            ctoAuthority.proposeAuthority(address(ctoActor));
            vm.prank(address(ctoActor));
            ctoAuthority.acceptAuthority();
            factory = new ClassicRewardVaultFactoryV1(ctoAuthority);

            address[] memory beneficiaries = new address[](2);
            beneficiaries[0] = address(actors[0]);
            beneficiaries[1] = address(actors[1]);
            uint16[] memory shares = new uint16[](2);
            shares[0] = 3333;
            shares[1] = 6667;
            vault = factory.deploy(
                bytes32("classic-reward-invariant"), IClassicFeeHookV3(address(hook)), POOL_ID, beneficiaries, shares
            );

            handler = new ClassicRewardVaultInvariantHandler(hook, ctoActor, vault, actorList);
            ctoActor.configure(address(handler));
            for (uint256 index; index < actors.length; index++) {
                actors[index].configure(vault);
            }

            targetContract(address(handler));
        }

        function invariant_allReceivedEthIsClaimableOrAlreadyClaimed() public view {
            uint256 totalClaimable;
            uint256 totalClaimedByWallet;
            for (uint256 index; index < actors.length; index++) {
                address actor = address(actors[index]);
                totalClaimable += vault.claimable(actor);
                totalClaimedByWallet += vault.claimedBy(actor);
                assertEq(actor.balance, vault.claimedBy(actor));
            }

            assertEq(vault.totalCreatorFeesClaimed(), totalClaimedByWallet);
            assertEq(vault.totalCreatorFeesReceived(), vault.totalCreatorFeesClaimed() + totalClaimable);
            assertEq(address(vault).balance, totalClaimable);
        }

        function invariant_activeSharesAlwaysTotalOneHundredPercent() public view {
            uint256 count = vault.beneficiaryCount();
            assertGe(count, 1);
            assertLe(count, 5);

            uint256 totalShareBps;
            for (uint256 index; index < count; index++) {
                assertTrue(vault.beneficiaryAt(index) != address(0));
                assertGt(vault.shareBpsAt(index), 0);
                totalShareBps += vault.shareBpsAt(index);
            }
            assertEq(totalShareBps, 10_000);
            assertGe(vault.configurationEpoch(), 1);
        }

        function invariant_ctoAuthorityAndVaultDependenciesNeverChange() public view {
            assertEq(address(vault.feeHook()), address(hook));
            assertEq(address(vault.poolManager()), address(manager));
            assertEq(address(vault.ctoAuthority()), address(ctoAuthority));
            assertEq(vault.poolId(), POOL_ID);
            assertEq(ctoAuthority.authority(), address(ctoActor));
        }
    }
