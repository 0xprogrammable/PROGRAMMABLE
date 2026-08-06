// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";

import { GeometricRendererV1 } from "./GeometricRendererV1.sol";
import { ShardConstantsV1 } from "./ShardConstantsV1.sol";
import { ShardErrorsV1 } from "./ShardErrorsV1.sol";
import { ShardHookV1 } from "./ShardHookV1.sol";
import { ShardNFTV1 } from "./ShardNFTV1.sol";
import { ShardTokenV1 } from "./ShardTokenV1.sol";
import { IShardNFTV1 } from "./interfaces/IShardNFTV1.sol";

/// @title ShardLaunchFactoryV1
/// @notice Atomically deploys and initialises a Shards collection from hash-pinned hook code.
contract ShardLaunchFactoryV1 {
    struct LaunchParams {
        int24 tickLower;
        int24 tickBand;
        int24 tickUpper;
        uint160 startSqrtPriceX96;
        address builderFeeRecipient;
    }

    struct ConfigurationData {
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
        bytes32 tokenSalt;
        bytes32 effectiveTokenSalt;
        bytes32 hookSalt;
        bytes32 hookCreationCodeHash;
    }

    struct LaunchAddresses {
        address hook;
        address shard;
        address nft;
    }

    error ZeroHookCodeHash();
    error WrongHookCode(bytes32 expected, bytes32 actual);
    error InvalidHookFlags(address predictedHook, uint160 expected, uint160 actual);
    error AddressOccupied(address predicted);
    error TokenTransferFailed();
    error FactoryRetainedShard(uint256 balance);

    uint160 public constant ALL_HOOK_MASK = uint160((1 << 14) - 1);
    uint160 public constant REQUIRED_HOOK_FLAGS = uint160(
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
    );

    /// @notice Programmable's fixed 0.10% ("launcher") recipient. Bound immutably to the canonical
    ///         Programmable address for every launch — the factory cannot route it anywhere else.
    address public constant launcherFeeRecipient = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;

    IPoolManager public immutable poolManager;
    GeometricRendererV1 public immutable renderer;
    bytes32 public immutable hookCreationCodeHash;

    mapping(address hook => bytes32 configurationHash) public configurationHashOf;

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

    constructor(IPoolManager poolManager_, bytes32 hookCreationCodeHash_) {
        if (address(poolManager_) == address(0)) revert ShardErrorsV1.ZeroAddress();
        if (hookCreationCodeHash_ == bytes32(0)) revert ZeroHookCodeHash();
        poolManager = poolManager_;
        hookCreationCodeHash = hookCreationCodeHash_;
        renderer = new GeometricRendererV1();
    }

    function effectiveTokenSalt(bytes32 tokenSalt, bytes32 hookSalt, LaunchParams calldata params)
        public
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                tokenSalt,
                hookSalt,
                params.tickLower,
                params.tickBand,
                params.tickUpper,
                params.startSqrtPriceX96,
                params.builderFeeRecipient
            )
        );
    }

    function predictToken(bytes32 tokenSalt, bytes32 hookSalt, LaunchParams calldata params)
        public
        view
        returns (address)
    {
        return Create2.computeAddress(
            effectiveTokenSalt(tokenSalt, hookSalt, params), keccak256(type(ShardTokenV1).creationCode)
        );
    }

    function hookInitCode(bytes calldata hookCreationCode, address shard, LaunchParams calldata params)
        public
        view
        returns (bytes memory)
    {
        return bytes.concat(
            hookCreationCode,
            abi.encode(
                poolManager,
                ShardTokenV1(shard),
                params.tickLower,
                params.tickBand,
                params.tickUpper,
                params.startSqrtPriceX96,
                address(this),
                launcherFeeRecipient,
                params.builderFeeRecipient
            )
        );
    }

    function hookInitCodeHash(bytes calldata hookCreationCode, address shard, LaunchParams calldata params)
        public
        view
        returns (bytes32)
    {
        return keccak256(hookInitCode(hookCreationCode, shard, params));
    }

    function predictHook(bytes32 hookSalt, bytes calldata hookCreationCode, address shard, LaunchParams calldata params)
        public
        view
        returns (address)
    {
        return Create2.computeAddress(hookSalt, hookInitCodeHash(hookCreationCode, shard, params));
    }

    function predictNFT(address hook) public view returns (address) {
        return Create2.computeAddress(_nftSalt(hook), keccak256(_nftInitCode(hook)));
    }

    function launch(bytes32 tokenSalt, bytes32 hookSalt, bytes calldata hookCreationCode, LaunchParams calldata params)
        external
        returns (address hook, address shard, address nft)
    {
        _validateHookCode(hookCreationCode);
        _validateParams(params);
        LaunchAddresses memory deployed = _deploy(tokenSalt, hookSalt, hookCreationCode, params);
        bytes32 configurationHash =
            computeConfigurationHash(deployed.hook, deployed.shard, deployed.nft, tokenSalt, hookSalt, params);
        configurationHashOf[deployed.hook] = configurationHash;
        emit ShardLaunched(
            deployed.hook,
            deployed.shard,
            deployed.nft,
            tokenSalt,
            hookSalt,
            params.builderFeeRecipient,
            address(renderer),
            configurationHash
        );
        return (deployed.hook, deployed.shard, deployed.nft);
    }

    function _deploy(bytes32 tokenSalt, bytes32 hookSalt, bytes calldata hookCreationCode, LaunchParams calldata params)
        private
        returns (LaunchAddresses memory deployed)
    {
        deployed.shard = predictToken(tokenSalt, hookSalt, params);
        deployed.hook = predictHook(hookSalt, hookCreationCode, deployed.shard, params);
        deployed.nft = predictNFT(deployed.hook);
        uint160 actualFlags = uint160(deployed.hook) & ALL_HOOK_MASK;
        if (actualFlags != REQUIRED_HOOK_FLAGS) {
            revert InvalidHookFlags(deployed.hook, REQUIRED_HOOK_FLAGS, actualFlags);
        }
        if (deployed.shard.code.length != 0) revert AddressOccupied(deployed.shard);
        if (deployed.hook.code.length != 0) revert AddressOccupied(deployed.hook);
        if (deployed.nft.code.length != 0) revert AddressOccupied(deployed.nft);

        deployed.shard =
            Create2.deploy(0, effectiveTokenSalt(tokenSalt, hookSalt, params), type(ShardTokenV1).creationCode);
        bytes memory initCode = hookInitCode(hookCreationCode, deployed.shard, params);
        deployed.hook = Create2.deploy(0, hookSalt, initCode);
        deployed.nft = Create2.deploy(0, _nftSalt(deployed.hook), _nftInitCode(deployed.hook));

        ShardHookV1 deployedHook = ShardHookV1(payable(deployed.hook));
        deployedHook.setNFT(IShardNFTV1(deployed.nft));
        ShardTokenV1 deployedShard = ShardTokenV1(deployed.shard);
        if (!deployedShard.transfer(deployed.hook, deployedShard.totalSupply())) revert TokenTransferFailed();
        deployedHook.initialise();

        uint256 retained = deployedShard.balanceOf(address(this));
        if (retained != 0) revert FactoryRetainedShard(retained);
    }

    function _validateHookCode(bytes calldata hookCreationCode) private view {
        bytes32 actualHookCodeHash = keccak256(hookCreationCode);
        if (actualHookCodeHash != hookCreationCodeHash) {
            revert WrongHookCode(hookCreationCodeHash, actualHookCodeHash);
        }
    }

    function _nftSalt(address hook) private pure returns (bytes32) {
        return keccak256(abi.encode(hook));
    }

    function _nftInitCode(address hook) private view returns (bytes memory) {
        return bytes.concat(type(ShardNFTV1).creationCode, abi.encode(hook, address(renderer)));
    }

    function computeConfigurationHash(
        address hook,
        address shard,
        address nft,
        bytes32 tokenSalt,
        bytes32 hookSalt,
        LaunchParams calldata params
    ) public view returns (bytes32) {
        ConfigurationData memory data;
        data.chainId = block.chainid;
        data.factory = address(this);
        data.poolManager = address(poolManager);
        data.renderer = address(renderer);
        data.launcherFeeRecipient = launcherFeeRecipient;
        data.builderFeeRecipient = params.builderFeeRecipient;
        data.shard = shard;
        data.hook = hook;
        data.nft = nft;
        data.tickLower = params.tickLower;
        data.tickBand = params.tickBand;
        data.tickUpper = params.tickUpper;
        data.startSqrtPriceX96 = params.startSqrtPriceX96;
        data.tokenSalt = tokenSalt;
        data.effectiveTokenSalt = effectiveTokenSalt(tokenSalt, hookSalt, params);
        data.hookSalt = hookSalt;
        data.hookCreationCodeHash = hookCreationCodeHash;
        return keccak256(abi.encode(data));
    }

    function _validateParams(LaunchParams calldata params) private pure {
        if (params.builderFeeRecipient == address(0)) revert ShardErrorsV1.ZeroAddress();
        int24 spacing = ShardConstantsV1.TICK_SPACING;
        if (
            params.tickLower < TickMath.minUsableTick(spacing) || params.tickUpper > TickMath.maxUsableTick(spacing)
                || params.tickLower >= params.tickBand || params.tickBand >= params.tickUpper
                || params.tickLower % spacing != 0 || params.tickBand % spacing != 0 || params.tickUpper % spacing != 0
        ) {
            revert ShardErrorsV1.InvalidTickRange();
        }
        uint160 start = params.startSqrtPriceX96;
        if (
            start < TickMath.MIN_SQRT_PRICE || start >= TickMath.MAX_SQRT_PRICE
                || TickMath.getTickAtSqrtPrice(start) < params.tickUpper
        ) {
            revert ShardErrorsV1.InvalidStartPrice();
        }
    }
}
