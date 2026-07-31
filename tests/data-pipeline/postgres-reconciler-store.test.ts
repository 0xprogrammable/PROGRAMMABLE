import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type {
  PostgresExecutor,
  PostgresParameter,
  PostgresTransaction,
} from "../../lib/data-pipeline/postgres";
import { createPostgresReconcilerPreParityStore } from "../../lib/data-pipeline/postgres-reconciler-store";
import {
  RECONCILER_ROUTE_KEYS,
  type ReconcilerCheckpointRequest,
  type ReconcilerCommitInput,
} from "../../lib/data-pipeline/reconciler-preparity";

const HASH = `0x${"11".repeat(32)}` as const;
const EPOCH_ID = "10000000-0000-4000-8000-000000000001";
const CHECKPOINT_ID = "10000000-0000-4000-8000-000000000002";

const request: ReconcilerCheckpointRequest = {
  chainId: "1",
  releaseId: "classic-v3",
  modelId: "classic",
  sourceGroup: "ethereum-mainnet",
  epochId: EPOCH_ID,
  pointerGeneration: "7",
  checkpointId: CHECKPOINT_ID,
  checkpointBlockNumber: "25700000",
  checkpointBlockHash: HASH,
  maximumEntityCount: 10_000,
};

class ScriptedExecutor implements PostgresExecutor {
  readonly applicationQueries: {
    text: string;
    values: readonly PostgresParameter[];
  }[] = [];
  readonly close = vi.fn(async () => undefined);

  async transaction<T>(
    work: (transaction: PostgresTransaction) => Promise<T>,
  ): Promise<T> {
    return work({
      query: async <Row extends Record<string, unknown>>(
        text: string,
        values: readonly PostgresParameter[] = [],
      ) => {
        if (/select session_user::text as session_user$/iu.test(text.trim())) {
          return [
            { session_user: "programmable_reconciler_login" },
          ] as unknown as Row[];
        }
        if (/current_role::text as current_role/iu.test(text)) {
          return [
            {
              session_user: "programmable_reconciler_login",
              current_role: "programmable_reconciler",
            },
          ] as unknown as Row[];
        }
        if (/^set local /iu.test(text.trim())) return [] as unknown as Row[];
        this.applicationQueries.push({ text, values });
        if (/get_reconciler_preparity_contract_v1/iu.test(text)) {
          return [
            {
              chain_id: "1",
              release_id: request.releaseId,
              model_id: request.modelId,
              source_group: request.sourceGroup,
              projector_version: "projector-v1",
              epoch_id: request.epochId,
              pointer_generation: request.pointerGeneration,
              checkpoint_id: request.checkpointId,
              checkpoint_generation: "11",
              reorg_generation: "0",
              checkpoint_block_number: request.checkpointBlockNumber,
              checkpoint_block_hash: HASH,
              route_keys: [...RECONCILER_ROUTE_KEYS],
              route_contract: { routes: [...RECONCILER_ROUTE_KEYS] },
              projection_contract: { resultCommitment: HASH },
              current_entities: [],
            },
          ] as unknown as Row[];
        }
        if (/commit_reconciler_preparity_result_v1/iu.test(text)) {
          return [
            {
              result: {
                runId: values[0],
                reconciliationId: values[1],
                checkpointId: values[11],
                checkpointBlockNumber: values[12],
                checkpointBlockHash: HASH,
                routeCount: 6,
                mismatchCount: 0,
                status: "succeeded",
              },
            },
          ] as unknown as Row[];
        }
        throw new Error("unexpected query");
      },
    });
  }
}

function uuid(index: number) {
  return `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

describe("reconciler Postgres store", () => {
  it("uses only the narrow read function and one atomic commit function", async () => {
    const executor = new ScriptedExecutor();
    const store = createPostgresReconcilerPreParityStore({ executor });

    const contract = await store.readExactContract(request);
    expect(contract).toMatchObject({
      checkpointId: CHECKPOINT_ID,
      checkpointBlockHash: HASH,
      reorgGeneration: "0",
      routeKeys: RECONCILER_ROUTE_KEYS,
    });

    const commit: ReconcilerCommitInput = {
      runId: uuid(1),
      reconciliationId: uuid(2),
      parityRecordIds: RECONCILER_ROUTE_KEYS.map((_, index) => uuid(index + 3)),
      parityBindingIds: RECONCILER_ROUTE_KEYS.map((_, index) => uuid(index + 9)),
      outcomeId: uuid(15),
      contract,
      workerVersion: "reconciler-preparity-v1",
      routeKeys: RECONCILER_ROUTE_KEYS,
      legacyDtoHashes: RECONCILER_ROUTE_KEYS.map(() => HASH),
      indexedDtoHashes: RECONCILER_ROUTE_KEYS.map(() => HASH),
      routeEvidenceCommitments: RECONCILER_ROUTE_KEYS.map(() => HASH),
      parityBindingCommitments: RECONCILER_ROUTE_KEYS.map(() => HASH),
      requestCommitment: HASH,
      reconciliationEvidenceCommitment: HASH,
      resultCommitment: HASH,
      startedAt: "2026-08-01T00:00:00.000Z",
      comparedAt: "2026-08-01T00:00:01.000Z",
      finishedAt: "2026-08-01T00:00:02.000Z",
    };

    await expect(store.commitResult(commit)).resolves.toMatchObject({
      status: "succeeded",
      routeCount: 6,
      mismatchCount: 0,
    });
    expect(executor.applicationQueries).toHaveLength(2);
    expect(executor.applicationQueries[0]!.text).toContain(
      "get_reconciler_preparity_contract_v1",
    );
    expect(executor.applicationQueries[1]!.text).toContain(
      "commit_reconciler_preparity_result_v1",
    );
    expect(executor.applicationQueries.map(({ text }) => text).join("\n"))
      .not.toMatch(/\b(?:insert|update|delete)\b/iu);
  });
});
