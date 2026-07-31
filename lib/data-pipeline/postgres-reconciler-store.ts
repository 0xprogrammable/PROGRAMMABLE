import "server-only";

import {
  bytes32FromBytea,
  canonicalBytes32,
  hexToBytes,
  parseNonnegativeIntegerText,
  type HexBytes32,
} from "./codecs";
import { validationError } from "./errors";
import type { PostgresExecutor } from "./postgres";
import { createReconcilerDatabaseGateway } from "./postgres-reconciler";
import {
  canonicalReconcilerCheckpointRequest,
  canonicalReconcilerPreParityContract,
  type ReconcilerCommitInput,
  type ReconcilerCommitResult,
  type ReconcilerPreParityStore,
} from "./reconciler-preparity";

function text(value: unknown, operation: string): string {
  if (typeof value !== "string") {
    throw validationError("postgres", operation);
  }
  return value;
}

function integerText(value: unknown, operation: string): string {
  if (typeof value === "bigint") {
    if (value < 0n) throw validationError("postgres", operation);
    return value.toString();
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw validationError("postgres", operation);
    }
    return String(value);
  }
  try {
    return parseNonnegativeIntegerText(value, 19);
  } catch {
    throw validationError("postgres", operation);
  }
}

function bytes32(value: unknown, operation: string): HexBytes32 {
  try {
    if (typeof value === "string" && value.startsWith("0x")) {
      return canonicalBytes32(value);
    }
    return bytes32FromBytea(value);
  } catch {
    throw validationError("postgres", operation);
  }
}

function json(value: unknown, operation: string): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw validationError("postgres", operation);
  }
}

function stringArray(value: unknown, operation: string): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw validationError("postgres", operation);
  }
  return value;
}

function commitResult(value: unknown): ReconcilerCommitResult {
  const parsed = json(value, "reconciler-commit-result");
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw validationError("postgres", "reconciler-commit-result");
  }
  const input = parsed as Record<string, unknown>;
  const routeCount = Number(integerText(input.routeCount, "route-count"));
  const mismatchCount = Number(
    integerText(input.mismatchCount, "mismatch-count"),
  );
  if (
    routeCount !== 6 ||
    mismatchCount < 0 ||
    mismatchCount > 6 ||
    (input.status !== "succeeded" && input.status !== "failed")
  ) {
    throw validationError("postgres", "reconciler-commit-result");
  }
  return Object.freeze({
    runId: text(input.runId, "run-id"),
    reconciliationId: text(input.reconciliationId, "reconciliation-id"),
    checkpointId: text(input.checkpointId, "checkpoint-id"),
    checkpointBlockNumber: integerText(
      input.checkpointBlockNumber,
      "checkpoint-block-number",
    ),
    checkpointBlockHash: bytes32(
      input.checkpointBlockHash,
      "checkpoint-block-hash",
    ),
    routeCount: 6,
    mismatchCount,
    status: input.status,
  });
}

export function createPostgresReconcilerPreParityStore(input: {
  executor: PostgresExecutor;
}): ReconcilerPreParityStore {
  const gateway = createReconcilerDatabaseGateway(input);
  return Object.freeze({
    async readExactContract(requestValue) {
      const request = canonicalReconcilerCheckpointRequest(requestValue);
      return gateway.transaction(async (transaction) => {
        const rows = await transaction.query<{
          chain_id: unknown;
          release_id: unknown;
          model_id: unknown;
          source_group: unknown;
          projector_version: unknown;
          epoch_id: unknown;
          pointer_generation: unknown;
          checkpoint_id: unknown;
          checkpoint_generation: unknown;
          reorg_generation: unknown;
          checkpoint_block_number: unknown;
          checkpoint_block_hash: unknown;
          route_keys: unknown;
          route_contract: unknown;
          projection_contract: unknown;
          current_entities: unknown;
        }>(
          `select *
           from programmable_private.get_reconciler_preparity_contract_v1(
             $1::bigint, $2::text, $3::text, $4::text, $5::uuid,
             $6::bigint, $7::uuid, $8::numeric, $9::bytea, $10::integer
           )`,
          [
            request.chainId,
            request.releaseId,
            request.modelId,
            request.sourceGroup,
            request.epochId,
            request.pointerGeneration,
            request.checkpointId,
            request.checkpointBlockNumber,
            hexToBytes(request.checkpointBlockHash),
            request.maximumEntityCount,
          ],
        );
        if (rows.length !== 1) {
          throw validationError("postgres", "reconciler-contract-cardinality");
        }
        const row = rows[0]!;
        return canonicalReconcilerPreParityContract({
          chainId: integerText(row.chain_id, "chain-id"),
          releaseId: text(row.release_id, "release-id"),
          modelId: text(row.model_id, "model-id"),
          sourceGroup: text(row.source_group, "source-group"),
          projectorVersion: text(row.projector_version, "projector-version"),
          epochId: text(row.epoch_id, "epoch-id"),
          pointerGeneration: integerText(
            row.pointer_generation,
            "pointer-generation",
          ),
          checkpointId: text(row.checkpoint_id, "checkpoint-id"),
          checkpointGeneration: integerText(
            row.checkpoint_generation,
            "checkpoint-generation",
          ),
          reorgGeneration: integerText(
            row.reorg_generation,
            "reorg-generation",
          ),
          checkpointBlockNumber: integerText(
            row.checkpoint_block_number,
            "checkpoint-block-number",
          ),
          checkpointBlockHash: bytes32(
            row.checkpoint_block_hash,
            "checkpoint-block-hash",
          ),
          routeKeys: stringArray(row.route_keys, "route-keys"),
          routeContract: json(row.route_contract, "route-contract"),
          projectionContract: json(
            row.projection_contract,
            "projection-contract",
          ),
          currentEntities: json(row.current_entities, "current-entities"),
        });
      });
    },

    async commitResult(result: ReconcilerCommitInput) {
      return gateway.transaction(async (transaction) => {
        const rows = await transaction.query<{ result: unknown }>(
          `select programmable_private.commit_reconciler_preparity_result_v1(
             $1::uuid, $2::uuid, $3::uuid[], $4::uuid[], $5::uuid,
             $6::bigint, $7::text, $8::text, $9::text, $10::uuid,
             $11::bigint, $12::uuid, $13::numeric, $14::bytea, $15::text,
             $16::text[], $17::bytea[], $18::bytea[], $19::bytea[],
             $20::bytea[], $21::bytea, $22::bytea, $23::bytea,
             $24::timestamptz, $25::timestamptz, $26::timestamptz
           ) as result`,
          [
            result.runId,
            result.reconciliationId,
            result.parityRecordIds,
            result.parityBindingIds,
            result.outcomeId,
            result.contract.chainId,
            result.contract.releaseId,
            result.contract.modelId,
            result.contract.sourceGroup,
            result.contract.epochId,
            result.contract.pointerGeneration,
            result.contract.checkpointId,
            result.contract.checkpointBlockNumber,
            hexToBytes(result.contract.checkpointBlockHash),
            result.workerVersion,
            result.routeKeys,
            result.legacyDtoHashes.map(hexToBytes),
            result.indexedDtoHashes.map(hexToBytes),
            result.routeEvidenceCommitments.map(hexToBytes),
            result.parityBindingCommitments.map(hexToBytes),
            hexToBytes(result.requestCommitment),
            hexToBytes(result.reconciliationEvidenceCommitment),
            hexToBytes(result.resultCommitment),
            result.startedAt,
            result.comparedAt,
            result.finishedAt,
          ],
        );
        if (rows.length !== 1) {
          throw validationError("postgres", "reconciler-commit-cardinality");
        }
        return commitResult(rows[0]!.result);
      });
    },
  });
}
