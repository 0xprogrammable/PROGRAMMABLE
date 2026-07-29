import "server-only";

import {
  BlobPreconditionFailedError,
  put,
} from "@vercel/blob";

import type { ExploreReadModel } from "../onchain/types";
import {
  buildPortfolioHistoryEnvelope,
  portfolioHistoryPath,
} from "./portfolio-history";

const MAX_HISTORY_SNAPSHOT_BYTES = 8 * 1024 * 1024;

export type PortfolioHistoryWriteResult =
  | {
      status: "recorded" | "already-recorded";
      path: string;
      tokenCount: number;
      blockNumber: string;
    }
  | {
      status: "empty";
      path: null;
      tokenCount: 0;
      blockNumber: string;
    };

export async function writePortfolioHistorySnapshot(
  model: ExploreReadModel,
  capturedAt = new Date(),
  token =
    process.env.OPS_BLOB_READ_WRITE_TOKEN ??
    process.env.BLOB_READ_WRITE_TOKEN,
): Promise<PortfolioHistoryWriteResult> {
  if (!token) {
    throw new Error("Portfolio history storage is not configured");
  }

  const envelope = buildPortfolioHistoryEnvelope(model, capturedAt);
  if (envelope.payload.tokens.length === 0) {
    return {
      status: "empty",
      path: null,
      tokenCount: 0,
      blockNumber: envelope.payload.snapshot.blockNumber,
    };
  }

  const path = portfolioHistoryPath(
    envelope.payload.snapshot.chainId,
    envelope.payload.bucketStartedAt,
  );
  const serialized = JSON.stringify(envelope);
  if (Buffer.byteLength(serialized, "utf8") > MAX_HISTORY_SNAPSHOT_BYTES) {
    throw new Error("Portfolio history snapshot exceeds its size limit");
  }

  try {
    await put(path, serialized, {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: false,
      cacheControlMaxAge: 0,
      token,
    });
    return {
      status: "recorded",
      path,
      tokenCount: envelope.payload.tokens.length,
      blockNumber: envelope.payload.snapshot.blockNumber,
    };
  } catch (error) {
    if (error instanceof BlobPreconditionFailedError) {
      return {
        status: "already-recorded",
        path,
        tokenCount: envelope.payload.tokens.length,
        blockNumber: envelope.payload.snapshot.blockNumber,
      };
    }
    throw error;
  }
}
