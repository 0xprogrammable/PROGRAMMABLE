import { parseAbi, parseAbiItem } from "viem";

export const memeTokenLaunchedEvent = parseAbiItem(
  "event MemeTokenLaunched(address indexed creator,address indexed token,bytes32 indexed poolId,address feeHook,address positionRecipient,uint256 positionTokenId,uint16 totalSwapFeeBps,bytes32 launchHash)",
);

export const memeLiquidityConfiguredEvent = parseAbiItem(
  "event MemeLiquidityConfigured(address indexed token,uint256 totalSupply,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,int24 initialTick,int24 tickLower,int24 tickUpper,uint24 lpFeePips,bytes32 launchHash)",
);

export const memeCreatorInitialBuyEvent = parseAbiItem(
  "event MemeCreatorInitialBuy(address indexed creator,address indexed token,bytes32 indexed poolId,uint256 nativeAmount,uint256 tokenAmount,bytes32 launchHash)",
);

export const nativeSwapFeesAccruedEvent = parseAbiItem(
  "event NativeSwapFeesAccrued(bytes32 indexed poolId,address indexed swapSender,uint256 grossNativeAmount,uint256 creatorFee,uint256 launcherFee)",
);

export const creatorFeesClaimedEvent = parseAbiItem(
  "event CreatorFeesClaimed(bytes32 indexed poolId,address indexed creator,address indexed recipient,address caller,uint256 amount)",
);

export const uerc20ReadAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function creator() view returns (address)",
  "function metadata() view returns (string description,string website,string image,bytes extraData)",
]);

export const stateViewReadAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
]);

export const creatorFeeHookReadAbi = parseAbi([
  "function poolFeeConfig(bytes32 poolId) view returns (address creator,address registrar,uint16 totalSwapFeeBps,bool registered,uint256 creatorFeesAccrued)",
  "function feeDisclosure(bytes32 poolId) view returns (uint16 buySwapFeeBps,uint16 sellSwapFeeBps,uint16 creatorFeeBps,uint16 launcherFeeBps,uint16 transferTaxBps,uint24 lpFeePips)",
  "function LAUNCHER_FEE_BPS() view returns (uint16)",
  "function LP_FEE_PIPS() view returns (uint24)",
  "function launcherFeesAccrued() view returns (uint256)",
  "function claimCreatorFees(bytes32 poolId) returns (uint256 amount)",
]);
