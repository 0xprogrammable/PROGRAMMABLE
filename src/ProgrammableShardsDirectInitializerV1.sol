// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IProgrammableShardsHookV1 {
    function setNFT(address nft) external;
    function initialise() external returns (uint128 liquidity);
    function nft() external view returns (address);
    function initialised() external view returns (bool);
}

interface IProgrammableShardsNftV1 {
    function hook() external view returns (address);
}

/// @title ProgrammableShardsDirectInitializerV1
/// @notice Immutable one-shot wiring adapter for the exact Router V1 direct Shards graph.
/// @dev The deploying GraphFactory is the only caller. This contract has no arbitrary call,
///      upgrade, ownership, withdrawal, or self-destruct surface.
contract ProgrammableShardsDirectInitializerV1 {
    address public immutable graphFactory;

    address public hook;
    address public nft;
    bool public consumed;

    error Unauthorized();
    error AlreadyConsumed();
    error TargetHasNoCode(address target);
    error PostconditionFailed();

    constructor() {
        graphFactory = msg.sender;
    }

    function initialize(address hook_, address nft_) external {
        if (msg.sender != graphFactory) revert Unauthorized();
        if (consumed) revert AlreadyConsumed();
        if (hook_.code.length == 0) revert TargetHasNoCode(hook_);
        if (nft_.code.length == 0) revert TargetHasNoCode(nft_);

        // Effects precede the two exact external calls. Any failure reverts the whole graph.
        consumed = true;
        hook = hook_;
        nft = nft_;

        IProgrammableShardsHookV1(hook_).setNFT(nft_);
        IProgrammableShardsHookV1(hook_).initialise();

        if (
            IProgrammableShardsHookV1(hook_).nft() != nft_ || !IProgrammableShardsHookV1(hook_).initialised()
                || IProgrammableShardsNftV1(nft_).hook() != hook_
        ) revert PostconditionFailed();
    }
}
