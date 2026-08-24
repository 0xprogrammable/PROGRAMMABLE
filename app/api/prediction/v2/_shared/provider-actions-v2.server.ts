import "server-only";

import { Buffer } from "node:buffer";

import type { PredictionV2BaseMarketView } from
  "@/lib/prediction-v2/base-market-view-v2";
import { buildPredictionV2BaseMarketView } from
  "@/lib/prediction-v2/base-market-view-v2.server";
import type { PredictionV2DistributedBudgetV2 } from
  "@/lib/prediction-v2/distributed-budget-v2.server";
import { enrichPredictionV2BaseMarketView } from
  "@/lib/prediction-v2/enriched-market-view-v2";
import {
  PREDICTION_V2_PUBLIC_RELEASE_HISTORICAL_SESSION_MAX_RPC_LOGICAL_CALLS,
  PREDICTION_V2_PUBLIC_RELEASE_SESSION_MAX_RPC_LOGICAL_CALLS,
  assertPredictionV2RuntimeDistributedBudgetMatchesRelease,
  createPredictionV2PublicReleaseResolutionRpcSession,
  toPredictionV2ReadBindingFromPublicReleaseV2,
  type PredictionV2EnabledPublicReleaseV2,
} from "@/lib/prediction-v2/public-release-v2.server";
import { buildPredictionV2PreparedTransactionEnvelopeV2 } from
  "@/lib/prediction-v2/prepared-transaction-v2.server";
import {
  readPredictionV2Directory,
  readPredictionV2MarketAtSnapshot,
  type PredictionV2ReadCursor,
  type PredictionV2SafeBlock,
} from "@/lib/prediction-v2/read-model-v2.server";
import {
  PREDICTION_V2_RESOLUTION_PUBLIC_RELEASE_MAX_PROVIDER_REQUESTS,
  decidePredictionV2ResolutionActionFromPublicRelease,
  type PredictionV2ResolutionActionDecision,
  type PredictionV2ResolutionLifecycleSnapshot,
} from "@/lib/prediction-v2/resolution-action-v2.server";
import {
  PREDICTION_V2_CANONICAL_HISTORICAL_BLOCK_VERIFICATION_RPC_LOGICAL_CALLS,
  createPredictionV2ActionRpcQuorum,
  verifyPredictionV2CanonicalHistoricalBlockV2,
} from "@/lib/prediction-v2/rpc-quorum-v2.server";
import { preparePredictionV2Redeem } from
  "@/lib/prediction-v2/transactions";
import {
  PREDICTION_V2_DIRECTORY_RESPONSE_SCHEMA,
  PREDICTION_V2_RESOLUTION_DECISION_RESPONSE_SCHEMA,
  type PredictionV2DirectoryIntentV2,
  type PredictionV2RedeemPrepareIntentV2,
  type PredictionV2ResolutionDecisionIntentV2,
  type PredictionV2RouteJsonObjectV2,
} from "./http-v2";

const CURSOR_BYTES32_PATTERN = /^0x[0-9a-f]{64}$/u;
const CURSOR_UINT_PATTERN = /^(?:0|[1-9][0-9]*)$/u;
const ZERO_BYTES32 = `0x${"0".repeat(64)}`;

function cursorUint(value: unknown, label: string) {
  if (
    typeof value !== "string" ||
    value.length > 78 ||
    !CURSOR_UINT_PATTERN.test(value)
  ) throw new TypeError(`Invalid Prediction V2 cursor ${label}`);
  return BigInt(value);
}

function cursorRecord(value: unknown): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) throw new TypeError("Invalid Prediction V2 cursor object");
  const expected = [
    "schemaVersion",
    "blockNumber",
    "blockHash",
    "marketCount",
    "nextExclusiveIndex",
  ];
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expected.length ||
    keys.some((key) => typeof key !== "string") ||
    expected.some((key) => !keys.includes(key))
  ) throw new TypeError("Invalid Prediction V2 cursor fields");
  return value as Record<string, unknown>;
}

function encodeCursor(cursor: PredictionV2ReadCursor | null) {
  if (!cursor) return null;
  return Buffer.from(JSON.stringify({
    schemaVersion: 2,
    blockNumber: cursor.blockNumber.toString(),
    blockHash: cursor.blockHash,
    marketCount: cursor.marketCount.toString(),
    nextExclusiveIndex: cursor.nextExclusiveIndex.toString(),
  }), "utf8").toString("base64url");
}

function decodeCursor(value: string | null): PredictionV2ReadCursor | null {
  if (value === null) return null;
  let text: string;
  let parsed: unknown;
  try {
    text = Buffer.from(value, "base64url").toString("utf8");
    if (Buffer.from(text, "utf8").toString("base64url") !== value) {
      throw new TypeError("Noncanonical Prediction V2 cursor encoding");
    }
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new TypeError("Invalid Prediction V2 cursor encoding");
  }
  const record = cursorRecord(parsed);
  if (
    record.schemaVersion !== 2 ||
    typeof record.blockHash !== "string" ||
    !CURSOR_BYTES32_PATTERN.test(record.blockHash) ||
    record.blockHash === ZERO_BYTES32
  ) throw new TypeError("Invalid Prediction V2 cursor identity");
  const cursor = Object.freeze({
    schemaVersion: 2 as const,
    blockNumber: cursorUint(record.blockNumber, "block number"),
    blockHash: record.blockHash as `0x${string}`,
    marketCount: cursorUint(record.marketCount, "market count"),
    nextExclusiveIndex: cursorUint(
      record.nextExclusiveIndex,
      "next exclusive index",
    ),
  });
  if (
    cursor.blockNumber < 1n ||
    cursor.nextExclusiveIndex < 1n ||
    cursor.nextExclusiveIndex > cursor.marketCount ||
    encodeCursor(cursor) !== value
  ) throw new TypeError("Invalid Prediction V2 cursor bounds");
  return cursor;
}

function blockDto(
  block: PredictionV2SafeBlock |
    PredictionV2ResolutionLifecycleSnapshot["block"],
) {
  return Object.freeze({
    number: block.number.toString(),
    hash: block.hash,
    parentHash: block.parentHash,
    timestamp: block.timestamp.toString(),
  });
}

function marketDto(view: PredictionV2BaseMarketView) {
  const asset = view.asset.kind === "preset"
    ? Object.freeze({
      kind: view.asset.kind,
      presetId: view.asset.presetId,
      sourceNetwork: view.asset.sourceNetwork,
      chainLabel: view.asset.chainLabel,
      address: null,
      explorerUrl: null,
      name: view.asset.name,
      symbol: view.asset.symbol,
    })
    : Object.freeze({
      kind: view.asset.kind,
      presetId: null,
      sourceNetwork: view.asset.sourceNetwork,
      chainLabel: view.asset.chainLabel,
      address: view.asset.address,
      explorerUrl: view.asset.explorerUrl,
      name: null,
      symbol: view.asset.symbol,
    });
  return Object.freeze({
    schemaVersion: view.schemaVersion,
    source: view.source,
    marketKey: view.marketKey,
    marketId: view.marketId,
    economicKey: view.economicKey,
    asset,
    condition: Object.freeze({
      kind: view.condition.kind,
      metric: view.condition.metric,
      comparator: view.condition.comparator,
      quoteCurrency: view.condition.quoteCurrency,
      strikeAtoms: view.condition.strikeAtoms,
      priceDecimals: view.condition.priceDecimals,
      observationUnixSeconds: view.condition.observationUnixSeconds,
      observationUtc: view.condition.observationUtc,
      oracleSnapshotRule: Object.freeze({
        source: view.condition.oracleSnapshotRule.source,
        winningPrice: view.condition.oracleSnapshotRule.winningPrice,
        requiredAfterRound:
          view.condition.oracleSnapshotRule.requiredAfterRound,
        maximumBeforeAgeSeconds:
          view.condition.oracleSnapshotRule.maximumBeforeAgeSeconds,
        maximumAfterDelaySeconds:
          view.condition.oracleSnapshotRule.maximumAfterDelaySeconds,
      }),
    }),
    lifecycle: Object.freeze({
      protocolState: view.lifecycle.protocolState,
      checkpointStatus: view.lifecycle.checkpointStatus,
      tradingPhase: view.lifecycle.tradingPhase,
      tradable: view.lifecycle.tradable,
      tradabilityReason: view.lifecycle.tradabilityReason,
      checkpointTradingHealthy: view.lifecycle.checkpointTradingHealthy,
      resolvedPrice: view.lifecycle.resolvedPrice.toString(),
    }),
    poolState: Object.freeze({
      sqrtPriceX96: view.poolState.sqrtPriceX96.toString(),
      tick: view.poolState.tick,
      poolManagerProtocolFee: view.poolState.poolManagerProtocolFee,
      lpFee: view.poolState.lpFee,
      yesProbabilityBps: view.poolState.yesProbabilityBps,
    }),
    artwork: Object.freeze({
      kind: view.artwork.kind,
      url: view.artwork.url,
    }),
    links: Object.freeze([]),
    onchain: Object.freeze({
      releaseId: view.onchain.releaseId,
      settlementChainId: view.onchain.settlementChainId,
      factoryAddress: view.onchain.factoryAddress,
      factoryRuntimeCodeHash: view.onchain.factoryRuntimeCodeHash,
      assetKey: view.onchain.assetKey,
      registryRevision: view.onchain.registryRevision,
      registrySnapshotHash: view.onchain.registrySnapshotHash,
      resolutionPolicyHash: view.onchain.resolutionPolicyHash,
      vaultAddress: view.onchain.vaultAddress,
      checkpointAddress: view.onchain.checkpointAddress,
      poolId: view.onchain.poolId,
      confirmedBlockNumber: view.onchain.confirmedBlockNumber,
      confirmedBlockHash: view.onchain.confirmedBlockHash,
    }),
    enrichment: null,
  });
}

function resolutionLifecycleDto(
  snapshot: PredictionV2ResolutionLifecycleSnapshot,
) {
  return Object.freeze({
    block: blockDto(snapshot.block),
    vaultState: snapshot.vaultState,
    checkpointStatus: snapshot.checkpointStatus,
    observationTime: snapshot.observationTime.toString(),
    resolutionDeadline: snapshot.resolutionDeadline.toString(),
    hardResolutionDeadline: snapshot.hardResolutionDeadline.toString(),
    fallbackRequestedAt: snapshot.fallbackRequestedAt.toString(),
    fallbackChallengeDeadline: snapshot.fallbackChallengeDeadline.toString(),
  });
}

function resolutionDto(
  release: PredictionV2EnabledPublicReleaseV2,
  intent: PredictionV2ResolutionDecisionIntentV2,
  decision: PredictionV2ResolutionActionDecision,
): PredictionV2RouteJsonObjectV2 {
  if (
    decision.chainId !== 4_663 ||
    !Number.isSafeInteger(decision.providerRequests) ||
    decision.providerRequests < 1 ||
    decision.providerRequests >
      PREDICTION_V2_RESOLUTION_PUBLIC_RELEASE_MAX_PROVIDER_REQUESTS
  ) throw new TypeError("Invalid Prediction V2 resolution decision bounds");
  const identity = Object.freeze({
    schemaVersion: PREDICTION_V2_RESOLUTION_DECISION_RESPONSE_SCHEMA,
    releaseId: release.release.releaseId,
    releasePayloadSha256: release.attestation.payloadSha256,
    actionId: intent.actionId,
    marketKey: intent.marketKey,
    economicKey: intent.economicKey,
    marketId: intent.marketId,
    chainId: decision.chainId,
  });
  if (decision.decision === "action") {
    if (
      decision.account.toLowerCase() !== intent.account.toLowerCase() ||
      decision.transaction.value !== 0n ||
      decision.transaction.data.slice(0, 10).toLowerCase() !==
        decision.transaction.selector.toLowerCase()
    ) throw new TypeError("Invalid Prediction V2 resolution transaction");
    return Object.freeze({
      ...identity,
      decision: decision.decision,
      action: decision.action,
      account: decision.account,
      snapshot: blockDto(decision.snapshot),
      transaction: Object.freeze({
        to: decision.transaction.to,
        data: decision.transaction.data,
        selector: decision.transaction.selector,
        value: decision.transaction.value.toString(),
      }),
      expected: Object.freeze({
        checkpointStatus: decision.expected.checkpointStatus,
        vaultState: decision.expected.vaultState,
        fallbackChallengeDeadline:
          decision.expected.fallbackChallengeDeadline.toString(),
      }),
      proofCommitment: decision.proofCommitment ?? null,
      providerRequests: decision.providerRequests,
    });
  }
  return Object.freeze({
    ...identity,
    decision: decision.decision,
    reason: decision.reason,
    snapshot: resolutionLifecycleDto(decision.snapshot),
    providerRequests: decision.providerRequests,
  });
}

/**
 * Called only after the route has irreversibly marked its shared budget lease
 * started. This function never reserves, signs, submits or broadcasts.
 */
export async function readPredictionV2DirectoryRouteV2(input: Readonly<{
  release: PredictionV2EnabledPublicReleaseV2;
  budget: PredictionV2DistributedBudgetV2;
  intent: PredictionV2DirectoryIntentV2;
  signal: AbortSignal;
}>): Promise<PredictionV2RouteJsonObjectV2> {
  const cursor = decodeCursor(input.intent.cursor);
  assertPredictionV2RuntimeDistributedBudgetMatchesRelease(
    input.release,
    input.budget,
  );
  const readers = createPredictionV2ActionRpcQuorum({
    confirmationDepth: BigInt(
      input.release.rpcCommitment.snapshotPolicy.confirmationDepth,
    ),
  });
  const session = await createPredictionV2PublicReleaseResolutionRpcSession(
    input.release,
    readers,
    input.budget,
    input.signal,
    cursor
      ? Object.freeze({
          number: cursor.blockNumber,
          hash: cursor.blockHash,
        })
      : undefined,
  );
  try {
    const expectedSessionCost = cursor
      ? PREDICTION_V2_PUBLIC_RELEASE_HISTORICAL_SESSION_MAX_RPC_LOGICAL_CALLS
      : PREDICTION_V2_PUBLIC_RELEASE_SESSION_MAX_RPC_LOGICAL_CALLS;
    if (
      session.rpcLogicalCalls !== expectedSessionCost
    ) throw new TypeError("Invalid Prediction V2 public release session cost");
    const directory = await readPredictionV2Directory({
      readers: [session.quorum.primary, session.quorum.secondary],
      binding: toPredictionV2ReadBindingFromPublicReleaseV2(input.release),
      limit: input.intent.limit,
      cursor,
      signal: input.signal,
    });
    const markets = directory.markets.map((market) => {
      const base = buildPredictionV2BaseMarketView({
        release: input.release,
        snapshot: directory.snapshot,
        market,
      });
      // Enrichment is optional. Its absence can never remove the canonical base
      // market from the result.
      return marketDto(enrichPredictionV2BaseMarketView(base, null));
    });
    return Object.freeze({
      schemaVersion: PREDICTION_V2_DIRECTORY_RESPONSE_SCHEMA,
      releaseId: input.release.release.releaseId,
      releasePayloadSha256: input.release.attestation.payloadSha256,
      chainId: directory.chainId,
      snapshot: blockDto(directory.snapshot),
      marketCount: directory.marketCount.toString(),
      markets: Object.freeze(markets),
      quarantined: Object.freeze(directory.quarantined.map((entry) =>
        Object.freeze({
          index: entry.index.toString(),
          economicKey: entry.economicKey,
          code: entry.code,
        })
      )),
      nextCursor: encodeCursor(directory.nextCursor),
    });
  } finally {
    session.close();
  }
}

/**
 * Reads the exact canonical market at one leased snapshot and constructs a
 * closed, unsigned redeem envelope. It never signs, submits or broadcasts.
 */
export async function preparePredictionV2RedeemRouteV2(input: Readonly<{
  release: PredictionV2EnabledPublicReleaseV2;
  budget: PredictionV2DistributedBudgetV2;
  intent: PredictionV2RedeemPrepareIntentV2;
  signal: AbortSignal;
}>): Promise<PredictionV2RouteJsonObjectV2> {
  assertPredictionV2RuntimeDistributedBudgetMatchesRelease(
    input.release,
    input.budget,
  );
  const readers = createPredictionV2ActionRpcQuorum({
    confirmationDepth: BigInt(
      input.release.rpcCommitment.snapshotPolicy.confirmationDepth,
    ),
  });
  const session = await createPredictionV2PublicReleaseResolutionRpcSession(
    input.release,
    readers,
    input.budget,
    input.signal,
  );
  try {
    if (
      session.rpcLogicalCalls !==
        PREDICTION_V2_PUBLIC_RELEASE_SESSION_MAX_RPC_LOGICAL_CALLS
    ) throw new TypeError("Invalid Prediction V2 public release session cost");
    if (
      PREDICTION_V2_CANONICAL_HISTORICAL_BLOCK_VERIFICATION_RPC_LOGICAL_CALLS !==
        2
    ) throw new TypeError("Invalid Prediction V2 historical anchor cost");
    await verifyPredictionV2CanonicalHistoricalBlockV2(
      session.lease,
      Object.freeze({
        number: BigInt(input.intent.minimumConfirmedBlockNumber),
        hash: input.intent.minimumConfirmedBlockHash,
      }),
      input.signal,
    );
    const marketRead = await readPredictionV2MarketAtSnapshot({
      readers: [session.quorum.primary, session.quorum.secondary],
      binding: toPredictionV2ReadBindingFromPublicReleaseV2(input.release),
      economicKey: input.intent.economicKey,
      snapshot: session.snapshot,
      signal: input.signal,
    });
    if (
      marketRead.market.economicKey.toLowerCase() !==
        input.intent.economicKey.toLowerCase() ||
      marketRead.market.marketId.toLowerCase() !==
        input.intent.marketId.toLowerCase()
    ) throw new TypeError("Prediction V2 redeem market identity mismatch");
    const transaction = preparePredictionV2Redeem({
      vault: marketRead.market.vault,
      yesAtoms: BigInt(input.intent.yesAtoms),
      noAtoms: BigInt(input.intent.noAtoms),
      recipient: input.intent.account,
    });
    const prepared = buildPredictionV2PreparedTransactionEnvelopeV2({
      release: input.release,
      market: marketRead.market,
      snapshot: marketRead.snapshot,
      intent: Object.freeze({
        action: "redeem" as const,
        actionId: input.intent.actionId,
        account: input.intent.account,
        // The builder requires this exact snapshot object identity.
        snapshot: marketRead.snapshot,
        transaction,
      }),
    });
    return Object.freeze({
      schemaVersion: prepared.schemaVersion,
      releaseId: prepared.releaseId,
      releaseBindingHash: prepared.releaseBindingHash,
      chainId: prepared.chainId,
      action: prepared.action,
      actionId: prepared.actionId,
      calldataHash: prepared.calldataHash,
      kind: prepared.kind,
      confirmedBlockNumber: prepared.confirmedBlockNumber,
      confirmedBlockHash: prepared.confirmedBlockHash,
      marketId: prepared.marketId,
      marketVault: prepared.marketVault,
      account: prepared.account,
      issuedAtUnixSeconds: prepared.issuedAtUnixSeconds,
      expiresAtUnixSeconds: prepared.expiresAtUnixSeconds,
      transaction: Object.freeze({
        to: prepared.transaction.to,
        data: prepared.transaction.data,
        value: prepared.transaction.value,
        gasLimit: prepared.transaction.gasLimit,
      }),
    });
  } finally {
    session.close();
  }
}

/** Returns a closed unsigned decision DTO; wallet authority is never accepted. */
export async function decidePredictionV2ResolutionRouteV2(input: Readonly<{
  release: PredictionV2EnabledPublicReleaseV2;
  budget: PredictionV2DistributedBudgetV2;
  intent: PredictionV2ResolutionDecisionIntentV2;
  signal: AbortSignal;
}>): Promise<PredictionV2RouteJsonObjectV2> {
  assertPredictionV2RuntimeDistributedBudgetMatchesRelease(
    input.release,
    input.budget,
  );
  const decision = await decidePredictionV2ResolutionActionFromPublicRelease({
    readers: createPredictionV2ActionRpcQuorum({
      confirmationDepth: BigInt(
        input.release.rpcCommitment.snapshotPolicy.confirmationDepth,
      ),
    }),
    budget: input.budget,
    economicKey: input.intent.economicKey,
    marketId: input.intent.marketId,
    account: input.intent.account,
    signal: input.signal,
  });
  return resolutionDto(input.release, input.intent, decision);
}
