import {
  createPublicClient,
  getAddress,
  http,
  parseAbi,
  type PublicClient,
} from "viem";
import { mainnet } from "viem/chains";

import type { LauncherToken } from "../tokens";
import type {
  ExploreReadModel,
  ReadyOnchainDeployment,
} from "./types";

export const ETH_USD_FEED_ADDRESS = getAddress(
  "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
);

const OFFICIAL_FEED_HEARTBEAT_SECONDS = 3_600n;
const MAXIMUM_FEED_AGE_SECONDS = 2n * OFFICIAL_FEED_HEARTBEAT_SECONDS;
const priceFeedAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

type EthUsdQuote = {
  roundId: bigint;
  answeredInRound: bigint;
  answer: bigint;
  decimals: number;
  updatedAt: bigint;
};

type QuoteSnapshot = EthUsdQuote & {
  blockTimestamp: bigint;
};

let cachedQuote:
  | {
      key: string;
      value: Promise<EthUsdQuote>;
    }
  | undefined;

export function assertValidEthUsdSnapshot(input: {
  expectedBlockHash: `0x${string}`;
  actualBlockHash: `0x${string}` | null;
  blockTimestamp: bigint;
  roundId: bigint;
  answeredInRound: bigint;
  answer: bigint;
  updatedAt: bigint;
}) {
  if (
    input.actualBlockHash !== input.expectedBlockHash ||
    input.roundId === 0n ||
    input.answeredInRound < input.roundId ||
    input.answer <= 0n ||
    input.updatedAt <= 0n ||
    input.updatedAt > input.blockTimestamp ||
    input.blockTimestamp - input.updatedAt > MAXIMUM_FEED_AGE_SECONDS
  ) {
    throw new Error("The ETH/USD feed is invalid or stale");
  }
}

function createPriceClient(rpcUrl: string): PublicClient {
  return createPublicClient({
    chain: mainnet,
    batch: { multicall: true },
    transport: http(rpcUrl, {
      retryCount: 2,
      timeout: 12_000,
    }),
  });
}

async function readQuoteSnapshot(
  client: PublicClient,
  blockNumber: bigint,
  expectedBlockHash: `0x${string}`,
): Promise<QuoteSnapshot> {
  const [decimals, roundData, block] = await Promise.all([
    client.readContract({
      address: ETH_USD_FEED_ADDRESS,
      abi: priceFeedAbi,
      functionName: "decimals",
      blockNumber,
    }),
    client.readContract({
      address: ETH_USD_FEED_ADDRESS,
      abi: priceFeedAbi,
      functionName: "latestRoundData",
      blockNumber,
    }),
    client.getBlock({ blockNumber }),
  ]);
  const [roundId, answer, , updatedAt, answeredInRound] = roundData;

  assertValidEthUsdSnapshot({
    expectedBlockHash,
    actualBlockHash: block.hash,
    blockTimestamp: block.timestamp,
    roundId,
    answeredInRound,
    answer,
    updatedAt,
  });

  return {
    roundId,
    answeredInRound,
    answer,
    decimals,
    updatedAt,
    blockTimestamp: block.timestamp,
  };
}

async function readEthUsdQuote(
  deployment: ReadyOnchainDeployment,
  blockNumber: bigint,
  blockHash: `0x${string}`,
): Promise<EthUsdQuote> {
  const key = [
    deployment.chainId,
    blockNumber,
    blockHash,
    ETH_USD_FEED_ADDRESS,
    deployment.rpcUrl,
    deployment.rpcUrlSecondary,
  ].join(":");
  if (cachedQuote?.key === key) return cachedQuote.value;

  const value = (async () => {
    const clients = [
      createPriceClient(deployment.rpcUrl),
      ...(deployment.rpcUrlSecondary
        ? [createPriceClient(deployment.rpcUrlSecondary)]
        : []),
    ];
    const snapshots = await Promise.all(
      clients.map((client) =>
        readQuoteSnapshot(client, blockNumber, blockHash),
      ),
    );
    const reference = snapshots[0];

    if (
      snapshots.some(
        (snapshot) =>
          snapshot.roundId !== reference.roundId ||
          snapshot.answeredInRound !== reference.answeredInRound ||
          snapshot.answer !== reference.answer ||
          snapshot.decimals !== reference.decimals ||
          snapshot.updatedAt !== reference.updatedAt ||
          snapshot.blockTimestamp !== reference.blockTimestamp,
      )
    ) {
      throw new Error(
        "Independent RPCs disagree on the ETH/USD feed snapshot",
      );
    }

    return {
      roundId: reference.roundId,
      answeredInRound: reference.answeredInRound,
      answer: reference.answer,
      decimals: reference.decimals,
      updatedAt: reference.updatedAt,
    };
  })().catch((error) => {
    if (cachedQuote?.value === value) cachedQuote = undefined;
    throw error;
  });

  cachedQuote = { key, value };
  return value;
}

export function usdValueFromWei(
  valueWei: string | undefined,
  answer: bigint,
  feedDecimals: number,
) {
  if (
    !valueWei ||
    !/^\d+$/.test(valueWei) ||
    answer <= 0n ||
    !Number.isSafeInteger(feedDecimals) ||
    feedDecimals < 0 ||
    feedDecimals > 36
  ) {
    return undefined;
  }

  return (
    (BigInt(valueWei) * answer) /
    10n ** BigInt(feedDecimals)
  ).toString();
}

export function enrichTokenWithUsd(
  token: LauncherToken,
  quote: Pick<EthUsdQuote, "answer" | "decimals">,
): LauncherToken {
  const tokenPriceUsdWad = usdValueFromWei(
    token.tokenPriceEthWei,
    quote.answer,
    quote.decimals,
  );
  const fdvUsdWad = usdValueFromWei(
    token.marketCapEthWei,
    quote.answer,
    quote.decimals,
  );
  return {
    ...token,
    ...(tokenPriceUsdWad === undefined ? {} : { tokenPriceUsdWad }),
    ...(fdvUsdWad === undefined ? {} : { fdvUsdWad }),
  };
}

export async function enrichExploreModelWithUsd(
  model: ExploreReadModel,
  deployment: ReadyOnchainDeployment,
): Promise<ExploreReadModel> {
  if (deployment.chainId !== 1 || model.status !== "ready") return model;

  const quote = await readEthUsdQuote(
    deployment,
    BigInt(model.snapshot.blockNumber),
    model.snapshot.blockHash,
  );

  return {
    ...model,
    snapshot: {
      ...model.snapshot,
      ethUsdQuote: {
        feedAddress: ETH_USD_FEED_ADDRESS,
        roundId: quote.roundId.toString(),
        answeredInRound: quote.answeredInRound.toString(),
        answer: quote.answer.toString(),
        decimals: quote.decimals,
        updatedAt: quote.updatedAt.toString(),
      },
    },
    tokens: model.tokens.map((token) => enrichTokenWithUsd(token, quote)),
  };
}
