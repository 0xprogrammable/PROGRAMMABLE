import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type {
  PostgresExecutor,
  PostgresParameter,
  PostgresTransaction,
} from "../../lib/data-pipeline/postgres";
import { createPostgresReconcilerPreParityStore } from "../../lib/data-pipeline/postgres-reconciler-store";
import {
  CLASSIC_V2_RECONCILER_ROUTE_KEYS,
  RECONCILER_ROUTE_KEYS,
  type ReconcilerCheckpointRequest,
  type ReconcilerCommitInput,
  type ReconcilerPreParityContract,
  type ReconcilerRouteKey,
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

  constructor(
    private readonly scopeRequest: ReconcilerCheckpointRequest = request,
    private readonly scopeRouteKeys: readonly ReconcilerRouteKey[] =
      RECONCILER_ROUTE_KEYS,
  ) {}

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
              release_id: this.scopeRequest.releaseId,
              model_id: this.scopeRequest.modelId,
              source_group: this.scopeRequest.sourceGroup,
              projector_version: "projector-v1",
              epoch_id: this.scopeRequest.epochId,
              pointer_generation: this.scopeRequest.pointerGeneration,
              checkpoint_id: this.scopeRequest.checkpointId,
              checkpoint_generation: "11",
              reorg_generation: "0",
              checkpoint_block_number: this.scopeRequest.checkpointBlockNumber,
              checkpoint_block_hash: HASH,
              route_keys: [...this.scopeRouteKeys],
              route_contract: { routes: [...this.scopeRouteKeys] },
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
                routeCount: this.scopeRouteKeys.length,
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

function validCommit(
  contract: ReconcilerPreParityContract,
  routeKeys: readonly ReconcilerRouteKey[],
): ReconcilerCommitInput {
  return {
    runId: uuid(1),
    reconciliationId: uuid(2),
    parityRecordIds: routeKeys.map((_, index) => uuid(index + 3)),
    parityBindingIds: routeKeys.map((_, index) =>
      uuid(index + 3 + routeKeys.length)
    ),
    outcomeId: uuid(3 + routeKeys.length * 2),
    contract,
    workerVersion: "reconciler-preparity-v1",
    routeKeys,
    legacyDtoHashes: routeKeys.map(() => HASH),
    indexedDtoHashes: routeKeys.map(() => HASH),
    routeEvidenceCommitments: routeKeys.map(() => HASH),
    parityBindingCommitments: routeKeys.map(() => HASH),
    requestCommitment: HASH,
    reconciliationEvidenceCommitment: HASH,
    resultCommitment: HASH,
    startedAt: "2026-08-01T00:00:00.000Z",
    comparedAt: "2026-08-01T00:00:01.000Z",
    finishedAt: "2026-08-01T00:00:02.000Z",
  };
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

    const commit = validCommit(contract, RECONCILER_ROUTE_KEYS);

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

  it("preserves the exact four-route Classic V2 commit cardinality", async () => {
    const v2Request: ReconcilerCheckpointRequest = {
      ...request,
      releaseId: "classic-v2",
    };
    const executor = new ScriptedExecutor(
      v2Request,
      CLASSIC_V2_RECONCILER_ROUTE_KEYS,
    );
    const store = createPostgresReconcilerPreParityStore({ executor });
    const contract = await store.readExactContract(v2Request);

    await expect(store.commitResult(validCommit(
      contract,
      CLASSIC_V2_RECONCILER_ROUTE_KEYS,
    ))).resolves.toMatchObject({
      status: "succeeded",
      routeCount: 4,
      mismatchCount: 0,
    });
  });
});
