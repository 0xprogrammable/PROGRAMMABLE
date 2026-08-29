// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { StdInvariant } from "forge-std/StdInvariant.sol";

import { DomainVaultV1 } from "../../src/core/DomainVaultV1.sol";
import { StrictERC20Mock } from "../mocks/MockERC20s.sol";
import { VaultControllerHarness } from "../mocks/VaultControllerHarness.sol";

contract DomainVaultInvariantHandler is Test {
    StrictERC20Mock public immutable TOKEN;
    VaultControllerHarness public immutable CONTROLLER;
    DomainVaultV1 public immutable VAULT_A;
    DomainVaultV1 public immutable VAULT_B;
    address public immutable RECIPIENT_A;
    address public immutable RECIPIENT_B;

    uint256 public expectedVaultA;
    uint256 public expectedVaultB;

    constructor(StrictERC20Mock token, VaultControllerHarness controller, DomainVaultV1 vaultA, DomainVaultV1 vaultB) {
        TOKEN = token;
        CONTROLLER = controller;
        VAULT_A = vaultA;
        VAULT_B = vaultB;
        RECIPIENT_A = address(0xA11CE);
        RECIPIENT_B = address(0xB0B);

        token.mint(address(this), 1_000_000 ether);
        token.approve(address(vaultA), type(uint256).max);
        token.approve(address(vaultB), type(uint256).max);
    }

    function pullIntoA(uint128 rawAmount) external {
        uint256 maximum = _maximumPull();
        if (maximum == 0) return;
        // Safe: maximum is capped to uint128 by _maximumPull.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint128 amount = uint128(bound(rawAmount, 1, maximum));
        CONTROLLER.pullERC20(VAULT_A, address(this), amount);
        expectedVaultA += amount;
        _assertTrackedBalances();
    }

    function pullIntoB(uint128 rawAmount) external {
        uint256 maximum = _maximumPull();
        if (maximum == 0) return;
        // Safe: maximum is capped to uint128 by _maximumPull.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint128 amount = uint128(bound(rawAmount, 1, maximum));
        CONTROLLER.pullERC20(VAULT_B, address(this), amount);
        expectedVaultB += amount;
        _assertTrackedBalances();
    }

    function pushFromA(uint128 rawAmount) external {
        if (expectedVaultA == 0) return;
        // Safe: expectedVaultA only accumulates uint128 pulls and never exceeds the minted balance.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint128 amount = uint128(bound(rawAmount, 1, expectedVaultA));
        CONTROLLER.pushERC20(VAULT_A, RECIPIENT_A, amount);
        expectedVaultA -= amount;
        _assertTrackedBalances();
    }

    function pushFromB(uint128 rawAmount) external {
        if (expectedVaultB == 0) return;
        // Safe: expectedVaultB only accumulates uint128 pulls and never exceeds the minted balance.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint128 amount = uint128(bound(rawAmount, 1, expectedVaultB));
        CONTROLLER.pushERC20(VAULT_B, RECIPIENT_B, amount);
        expectedVaultB -= amount;
        _assertTrackedBalances();
    }

    function _maximumPull() private view returns (uint256) {
        uint256 balance = TOKEN.balanceOf(address(this));
        return balance > type(uint128).max ? type(uint128).max : balance;
    }

    function _assertTrackedBalances() private view {
        assertEq(TOKEN.balanceOf(address(VAULT_A)), expectedVaultA, "Domain A physical balance drift");
        assertEq(TOKEN.balanceOf(address(VAULT_B)), expectedVaultB, "Domain B physical balance drift");
    }
}

contract DomainVaultInvariantTest is StdInvariant, Test {
    bytes32 internal constant ERC20_PROFILE = keccak256("programmable.dex.evm.asset-profile.erc20-strict-measured.v1");

    StrictERC20Mock internal token;
    VaultControllerHarness internal controller;
    DomainVaultV1 internal vaultA;
    DomainVaultV1 internal vaultB;
    DomainVaultInvariantHandler internal handler;

    function setUp() external {
        token = new StrictERC20Mock();
        controller = new VaultControllerHarness();
        vaultA = controller.deployVault(
            keccak256("vault A"), controller.coreDeploymentId(), keccak256("domain A"), ERC20_PROFILE, address(token)
        );
        vaultB = controller.deployVault(
            keccak256("vault B"), controller.coreDeploymentId(), keccak256("domain B"), ERC20_PROFILE, address(token)
        );
        handler = new DomainVaultInvariantHandler(token, controller, vaultA, vaultB);
        targetContract(address(handler));
    }

    function invariant_domainsNeverSharePhysicalCustody() external view {
        assertNotEq(address(vaultA), address(vaultB));
        assertEq(token.balanceOf(address(vaultA)), handler.expectedVaultA());
        assertEq(token.balanceOf(address(vaultB)), handler.expectedVaultB());
        assertNotEq(vaultA.DOMAIN_REVISION_ID(), vaultB.DOMAIN_REVISION_ID());
    }

    function invariant_vaultAuthorityAndAssetRemainImmutable() external view {
        assertEq(vaultA.CORE(), address(controller));
        assertEq(vaultB.CORE(), address(controller));
        assertEq(vaultA.NATIVE_ASSET(), address(token));
        assertEq(vaultB.NATIVE_ASSET(), address(token));
        assertEq(vaultA.ASSET_PROFILE_ID(), ERC20_PROFILE);
        assertEq(vaultB.ASSET_PROFILE_ID(), ERC20_PROFILE);
    }
}
