// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";

import { ClassicInitialBuyCustodyConfig } from "../ClassicInitialBuyVestingWalletV1.sol";

/// @notice Minimal exact interface for the future-only router-aware Classic launcher.
interface IMemeLaunchV3 {
    struct LaunchParameters {
        string name;
        string symbol;
        uint16 buySwapFeeBps;
        uint16 sellSwapFeeBps;
        bytes32 creatorSalt;
        UERC20Metadata metadata;
        address[] rewardBeneficiaries;
        uint16[] rewardSharesBps;
        ClassicInitialBuyCustodyConfig initialBuyCustody;
    }

    struct LaunchResult {
        address token;
        address rewardVault;
        address positionRecipient;
        uint256 positionTokenId;
        uint256 tokenLiquidityAmount;
        uint256 lockedTokenDust;
        uint256 initialBuyNativeAmount;
        uint256 initialBuyTokenAmount;
        address initialBuyCustody;
        bytes32 poolId;
        bytes32 launchHash;
    }

    function ROUTER() external view returns (address);

    function poolManager() external view returns (IPoolManager);

    function feeHook() external view returns (address);

    function poolKey(address token) external view returns (PoolKey memory);

    function launchFor(address launchWallet, LaunchParameters calldata parameters)
        external
        payable
        returns (LaunchResult memory result);
}
