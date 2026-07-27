import {
  encodeAbiParameters,
  getAddress,
  keccak256,
  type Address,
  type Hex,
} from "viem";

import type {
  InitialBuyEventRecord,
  LaunchEventRecord,
  LiquidityEventRecord,
  VerifiedLaunchRecord,
} from "./types";
import { MEME_MIN_INITIAL_BUY_WEI } from "../launch";

function eventKey(
  transactionHash: Hex,
  token: Address,
  launchHash: Hex,
) {
  return `${transactionHash.toLowerCase()}:${token.toLowerCase()}:${launchHash.toLowerCase()}`;
}

export function computeLaunchHash(
  chainId: number,
  launcher: Address,
  launch: LaunchEventRecord,
  liquidity: LiquidityEventRecord,
  initialBuy: InitialBuyEventRecord,
) {
  const infrastructureHash = keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "bytes32" },
      ],
      [
        launch.creator,
        launch.token,
        launch.feeHook,
        launch.positionRecipient,
        launch.positionTokenId,
        launch.poolId,
      ],
    ),
  );
  const economicsHash = keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint16" },
        { type: "int24" },
        { type: "int24" },
        { type: "int24" },
        { type: "uint24" },
      ],
      [
        liquidity.totalSupply,
        liquidity.tokenLiquidityAmount,
        liquidity.lockedTokenDust,
        MEME_MIN_INITIAL_BUY_WEI,
        initialBuy.nativeAmount,
        initialBuy.tokenAmount,
        launch.totalSwapFeeBps,
        liquidity.initialTick,
        liquidity.tickLower,
        liquidity.tickUpper,
        liquidity.lpFeePips,
      ],
    ),
  );

  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [BigInt(chainId), getAddress(launcher), infrastructureHash, economicsHash],
    ),
  );
}

export function pairVerifiedLaunchEvents(
  chainId: number,
  launcher: Address,
  expectedHook: Address,
  launches: LaunchEventRecord[],
  liquidities: LiquidityEventRecord[],
  initialBuys: InitialBuyEventRecord[],
) {
  const liquidityByKey = new Map<string, LiquidityEventRecord>();
  for (const liquidity of liquidities) {
    liquidityByKey.set(
      eventKey(
        liquidity.transactionHash,
        liquidity.token,
        liquidity.launchHash,
      ),
      liquidity,
    );
  }
  const initialBuyByKey = new Map<string, InitialBuyEventRecord>();
  for (const initialBuy of initialBuys) {
    initialBuyByKey.set(
      eventKey(
        initialBuy.transactionHash,
        initialBuy.token,
        initialBuy.launchHash,
      ),
      initialBuy,
    );
  }

  const verified: VerifiedLaunchRecord[] = [];
  const seenTokens = new Set<string>();
  for (const launch of launches) {
    if (launch.feeHook.toLowerCase() !== expectedHook.toLowerCase()) {
      continue;
    }
    const liquidity = liquidityByKey.get(
      eventKey(launch.transactionHash, launch.token, launch.launchHash),
    );
    const initialBuy = initialBuyByKey.get(
      eventKey(launch.transactionHash, launch.token, launch.launchHash),
    );
    if (
      !liquidity ||
      !initialBuy ||
      launch.blockNumber !== liquidity.blockNumber ||
      launch.blockNumber !== initialBuy.blockNumber ||
      launch.creator.toLowerCase() !== initialBuy.creator.toLowerCase() ||
      launch.poolId !== initialBuy.poolId ||
      initialBuy.nativeAmount < MEME_MIN_INITIAL_BUY_WEI ||
      initialBuy.tokenAmount <= 0n ||
      computeLaunchHash(
        chainId,
        launcher,
        launch,
        liquidity,
        initialBuy,
      ) !==
        launch.launchHash
    ) {
      continue;
    }

    const tokenKey = launch.token.toLowerCase();
    if (seenTokens.has(tokenKey)) continue;
    seenTokens.add(tokenKey);
    verified.push({ ...launch, liquidity, initialBuy });
  }
  return verified;
}
