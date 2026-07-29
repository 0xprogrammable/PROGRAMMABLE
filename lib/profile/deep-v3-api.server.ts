import "server-only";

import { getAddress, type Address } from "viem";

import {
  assertDeepV3LaunchProvenance,
  assertDeepV3ReleaseRuntime,
  resolveVerifiedDeepV3ReadRelease,
  type DeepV3LaunchProvenance,
} from "../onchain/deep-v3-read-model";
import type { ExploreReadModel } from "../onchain/types";
import type { LauncherToken } from "../tokens";
import {
  readDeepV3ProfileToken,
  resolveDeepV3ProfileSnapshot,
  type DeepV3ProfileClient,
  type DeepV3ProfileToken,
} from "./deep-v3-profile.server";

const PROFILE_READ_BATCH_SIZE = 6;

type IndexedDeepV3Token = LauncherToken & {
  deepV3Provenance?: DeepV3LaunchProvenance;
};

type DeepV3ProfileApiInput = {
  manifest: unknown;
  chainId: number;
  account: Address;
  model: ExploreReadModel;
  clients: readonly DeepV3ProfileClient[];
};

function sameAddress(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function sameHex(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function verifiedModel(
  model: ExploreReadModel,
  chainId: number,
): Extract<ExploreReadModel, { status: "ready" }> {
  if (model.status !== "ready" || model.snapshot.chainId !== chainId) {
    throw new Error("The verified Deep V3 launch registry is unavailable");
  }
  return model;
}

function indexedCandidate(
  token: IndexedDeepV3Token,
  release: NonNullable<
    ReturnType<typeof resolveVerifiedDeepV3ReadRelease>
  >,
) {
  if (!token.deepV3Provenance) {
    throw new Error("Deep V3 token has no verified launch provenance");
  }
  const candidate = assertDeepV3LaunchProvenance(
    token.deepV3Provenance,
    release,
  );
  if (
    token.launchModel !== "deep" ||
    token.deepReleaseVersion !== "deep-full-range-v3" ||
    !sameAddress(token.tokenAddress, candidate.tokenAddress) ||
    !sameAddress(token.hookAddress, candidate.hookAddress) ||
    !sameHex(token.poolId, candidate.poolId) ||
    !token.creatorAddress ||
    !sameAddress(token.creatorAddress, candidate.creator) ||
    !token.growthVaultAddress ||
    !sameAddress(token.growthVaultAddress, candidate.vaultAddress) ||
    token.positionRecipient === undefined ||
    !sameAddress(token.positionRecipient, candidate.positionRecipient) ||
    token.positionTokenId !== candidate.positionTokenId ||
    token.launchHash === undefined ||
    !sameHex(token.launchHash, candidate.launchHash) ||
    token.launchBlockNumber !== candidate.blockNumber ||
    token.launchTransactionHash === undefined ||
    !sameHex(token.launchTransactionHash, candidate.transactionHash) ||
    token.launchTransactionIndex !== candidate.transactionIndex ||
    token.launchLogIndex !== candidate.logIndex
  ) {
    throw new Error("Deep V3 token does not match its verified provenance");
  }
  return candidate;
}

export function deepV3IndexedTokensForAccount(
  model: ExploreReadModel,
  chainId: number,
  account: Address,
  manifest: unknown,
) {
  const release = resolveVerifiedDeepV3ReadRelease(manifest, chainId);
  if (!release) {
    throw new Error("Deep V3 profiles require the verified live release");
  }
  const normalizedAccount = getAddress(account);
  const candidates = verifiedModel(model, chainId).tokens
    .filter(
      (token): token is IndexedDeepV3Token =>
        token.deepV3Provenance !== undefined,
    )
    .map((token) => ({
      token,
      candidate: indexedCandidate(token, release),
    }))
    .filter(({ candidate }) =>
      sameAddress(candidate.creator, normalizedAccount),
    )
    .sort((left, right) => {
      const leftBlock = BigInt(left.candidate.blockNumber);
      const rightBlock = BigInt(right.candidate.blockNumber);
      if (leftBlock !== rightBlock) return leftBlock > rightBlock ? -1 : 1;
      return right.candidate.logIndex - left.candidate.logIndex;
    });

  const uniqueTokens = new Set<string>();
  const uniqueVaults = new Set<string>();
  for (const { candidate } of candidates) {
    const tokenKey = candidate.tokenAddress.toLowerCase();
    const vaultKey = candidate.vaultAddress.toLowerCase();
    if (uniqueTokens.has(tokenKey) || uniqueVaults.has(vaultKey)) {
      throw new Error("Deep V3 profile contains duplicate launch provenance");
    }
    uniqueTokens.add(tokenKey);
    uniqueVaults.add(vaultKey);
  }
  return candidates;
}

async function readInBatches<T>(
  values: readonly T[],
  readValue: (value: T) => Promise<DeepV3ProfileToken>,
) {
  const tokens: DeepV3ProfileToken[] = [];
  for (
    let index = 0;
    index < values.length;
    index += PROFILE_READ_BATCH_SIZE
  ) {
    tokens.push(
      ...(await Promise.all(
        values
          .slice(index, index + PROFILE_READ_BATCH_SIZE)
          .map(readValue),
      )),
    );
  }
  return tokens;
}

export async function readDeepV3CreatorProfile(
  input: DeepV3ProfileApiInput,
) {
  const release = resolveVerifiedDeepV3ReadRelease(
    input.manifest,
    input.chainId,
  );
  if (!release) {
    throw new Error("Deep V3 profiles require the verified live release");
  }
  const account = getAddress(input.account);
  const snapshot = await resolveDeepV3ProfileSnapshot(
    input.clients,
    release.chainId,
  );
  await Promise.all(
    input.clients.map((client) =>
      assertDeepV3ReleaseRuntime(client, release, snapshot.blockNumber),
    ),
  );
  const indexed = deepV3IndexedTokensForAccount(
    input.model,
    input.chainId,
    account,
    input.manifest,
  );
  const tokens = await readInBatches(indexed, async ({ candidate }) => {
    const profile = await readDeepV3ProfileToken({
      manifest: input.manifest,
      chainId: input.chainId,
      account,
      candidate,
      clients: input.clients,
    });
    return profile.token;
  });

  return {
    status: "ready" as const,
    account,
    chainId: release.chainId,
    snapshot: {
      blockNumber: snapshot.blockNumber.toString(),
      blockHash: snapshot.blockHash,
    },
    tokens,
  };
}
