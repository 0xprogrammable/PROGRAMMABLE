import { rootCertificates } from "node:tls";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  captureReadModelPerformance,
  parseReadModelPerformanceCaptureRequest,
  readPerformanceDataset,
} from "../../lib/data-pipeline/read-model-performance-capture.server";

const gitHead = "a".repeat(40);
const targetUrl = "https://programmable-git-codex.vercel.app/";
const vercelDeploymentId = `dpl_${"A".repeat(24)}`;
const captureNonce = `0x${"12".repeat(32)}`;
const TEST_CA = rootCertificates[0]!;
const bytes32 = (byte: string) => `0x${byte.repeat(64)}`;
const address = (index: number) =>
  `0x${index.toString(16).padStart(40, "0")}` as `0x${string}`;
const transactionHash = (index: number) =>
  `0x${index.toString(16).padStart(64, "0")}` as `0x${string}`;
const candidateId = (index: number) =>
  `1:${bytes32((index + 1).toString(16))}:${bytes32((index + 8).toString(16))}:${index}`;
const accessEvidence = Object.freeze({
  projectorSessionUser: "programmable_projector_login",
  projectorCurrentRole: "programmable_projector",
  projectorCurrentSettingRole: "programmable_projector",
  apiReaderSessionUser: "programmable_api_reader_login",
  apiReaderCurrentRole: "programmable_api_reader",
  apiReaderCurrentSettingRole: "programmable_api_reader",
  apiReaderDeniedSqlstate: "42501",
  apiReaderFunctionExecute: false,
  apiReaderViewSelect: false,
});

function environment(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    VERCEL_GIT_COMMIT_SHA: gitHead,
    VERCEL_URL: "programmable-git-codex.vercel.app",
    VERCEL_DEPLOYMENT_ID: vercelDeploymentId,
    PROGRAMMABLE_ENVIO_GRAPHQL_URL:
      "https://indexer.hyperindex.xyz/f6714ef/v1/graphql",
    ...overrides,
  };
}

function databaseEnvironment(
  overrides: Record<string, string | undefined> = {},
) {
  return environment({
    PROGRAMMABLE_PROJECTOR_DATABASE_URL:
      "postgresql://programmable_projector_login:projector-password@db.example:5432/postgres?sslmode=verify-full",
    PROGRAMMABLE_API_READER_DATABASE_URL:
      "postgresql://programmable_api_reader_login:reader-password@db.example:5432/postgres?sslmode=verify-full",
    PROGRAMMABLE_POSTGRES_SSL_CA_PEM: TEST_CA,
    ...overrides,
  });
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    profileId: "read-model-smoke-v1",
    gitHead,
    targetUrl,
    vercelDeploymentId,
    captureNonce,
    ...overrides,
  };
}

function dataset() {
  const releaseCounts = {
    "classic-v2": 50,
    "classic-v3": 62,
    "stock-paired-v1": 32,
    "stock-paired-v2": 32,
    "stock-paired-v3": 32,
  };
  const eligibleLaunches = Object.entries(releaseCounts).flatMap(
    ([releaseVersion, count], releaseIndex) =>
      Array.from({ length: count }, (_, index) => {
        const identity = releaseIndex * 64 + index + 1;
        return {
          account: address(identity + 1_000),
          transactionHash: transactionHash(identity),
          tokenAddress: address(identity),
          releaseVersion,
        };
      }),
  );
  const accountAddresses = Array.from({ length: 100 }, (_, index) =>
    address(index + 201),
  );
  return {
    generatedAt: "2026-07-31T19:00:00.000Z",
    counts: {
      launches: 208,
      chainEvents: 700,
      marketSnapshots: 250,
      marketCandles: 250,
      accounts: 300,
      rewardRows: 300,
    },
    releaseCounts,
    eligibleLaunches,
    accountEvidence: accountAddresses.map((account) => ({
      account,
      profileRows: 1,
      rewardRows: 0,
    })),
    keys: {
      tokenAddresses: Array.from({ length: 100 }, (_, index) =>
        address(index + 1),
      ),
      accountAddresses,
      classicLaunches: Array.from({ length: 32 }, (_, index) => ({
        account: address(index + 401),
        transactionHash: transactionHash(index + 1),
      })),
      stockLaunches: Array.from({ length: 32 }, (_, index) => ({
        account: address(index + 501),
        transactionHash: transactionHash(index + 101),
      })),
      candidateIds: Array.from({ length: 8 }, (_, index) => candidateId(index)),
    },
  };
}

describe("read-model performance capture binding", () => {
  it("binds the request to the exact staged Vercel deployment", () => {
    expect(
      parseReadModelPerformanceCaptureRequest(body(), environment()),
    ).toEqual(body());
  });

  it.each([
    { gitHead: "b".repeat(40) },
    { targetUrl: "https://programmable.family" },
    { targetUrl: `${targetUrl}/path` },
    { vercelDeploymentId: `dpl_${"B".repeat(24)}` },
    { captureNonce: "0x1234" },
    { extra: true },
  ])("rejects unbound or non-exact capture input", (override) => {
    expect(() =>
      parseReadModelPerformanceCaptureRequest(
        body(override),
        environment(),
      ),
    ).toThrow();
  });

  it("performs one fresh 8-candidate Envio read and dual-RPC verification", async () => {
    const seed = dataset();
    const readCandidate = vi.fn(async (id: string) => ({ candidateId: id }));
    const providers = [
      {
        identity: "alchemy-provider",
        vendorGroup: "alchemy",
        endpointCommitment: bytes32("a"),
        endpointOriginCommitment: bytes32("b"),
      },
      {
        identity: "quicknode-provider",
        vendorGroup: "quicknode",
        endpointCommitment: bytes32("c"),
        endpointOriginCommitment: bytes32("d"),
      },
    ];
    const operationCounts = [
      ["getChainId", 1],
      ["getBlockNumber", 1],
      ["getBlock", 9],
      ["getTransactionReceipt", 8],
      ["getBytecode", 8],
    ] as const;
    const calls = providers.flatMap((provider, providerIndex) =>
      operationCounts.flatMap(([operation, count]) =>
        Array.from({ length: count }, (_, index) => ({
          providerIdentity: provider.identity,
          providerVendorGroup: provider.vendorGroup,
          providerEndpointCommitment: provider.endpointCommitment,
          providerOriginCommitment: provider.endpointOriginCommitment,
          operation,
          attempt: 1,
          startedOffsetMs: providerIndex * 25 + index,
          durationMs: 1,
          outcome: "success" as const,
        })),
      ),
    );
    const candidateEvidence = Array.from({ length: 8 }, (_, index) => ({
      candidateId: candidateId(index),
      candidateBlockNumber: String(1_000 + index),
      candidateBlockHash: bytes32((index + 1).toString(16)),
      transactionHash: bytes32((index + 8).toString(16)),
      sourceAddress: address(index + 1),
    }));
    const runRpcTrace = vi.fn(async ({ work }) => {
      await work();
      return {
        startedAtMs: 1_000,
        completedAtMs: 1_050,
        candidateBatchSize: 8,
        hardDeadlineMs: 75_000,
        maxCallsPerProvider: 42,
        elapsedMs: 50,
        calls,
        providerCallCounts: [27, 27],
        candidateEvidence,
      };
    });
    const verifyBatch = vi.fn(async () => ({ candidates: Array(8).fill({}) }));
    const dependencies = {
      readDataset: vi.fn(async () => ({ dataset: seed, accessEvidence })),
      createEnvio: vi.fn(() => ({ readCandidate })),
      createProviders: vi.fn(() => providers),
      verifyBatch,
      runRpcTrace,
    } as never;

    const result = await captureReadModelPerformance(body(), {
      env: environment(),
      dependencies,
    });

    expect(readCandidate).toHaveBeenCalledTimes(8);
    expect(readCandidate.mock.calls.map(([id]) => id)).toEqual(
      seed.keys.candidateIds,
    );
    expect(verifyBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        candidates: seed.keys.candidateIds.map((id) => ({ candidateId: id })),
        providers,
        rpcPolicy: {
          hardDeadlineMs: expect.any(Number),
          maxCallsPerProvider: 42,
        },
      }),
    );
    expect(result).toEqual({
      schemaVersion: 1,
      captureNonce,
      datasetManifest: {
        schemaVersion: 1,
        profileId: "read-model-smoke-v1",
        generatedAt: seed.generatedAt,
        counts: seed.counts,
        releaseCounts: seed.releaseCounts,
        eligibleLaunches: seed.eligibleLaunches,
        accountEvidence: seed.accountEvidence,
        keys: seed.keys,
        accessEvidence,
      },
      rpcTrace: {
        schemaVersion: 1,
        profileId: "read-model-smoke-v1",
        gitHead,
        targetUrl,
        vercelDeploymentId,
        captureNonce,
        startedAtMs: 1_000,
        completedAtMs: 1_050,
        candidateBatchSize: 8,
        hardDeadlineMs: 75_000,
        maxCallsPerProvider: 42,
        elapsedMs: 50,
        providerCallCounts: [27, 27],
        calls,
        candidateEvidence,
      },
    });
    expect(JSON.stringify(result)).not.toContain("https://rpc");
  });

  it("captures projector identity with the dataset and proves the reader denial live", async () => {
    const seed = dataset();
    const projectorStatements: string[] = [];
    const readerStatements: string[] = [];
    const datasetRow = {
      generated_at: new Date(seed.generatedAt),
      launch_count: seed.counts.launches,
      eligible_launch_count: seed.counts.launches,
      candidate_count: 8,
      chain_event_count: seed.counts.chainEvents,
      market_snapshot_count: seed.counts.marketSnapshots,
      market_candle_count: seed.counts.marketCandles,
      account_count: seed.counts.accounts,
      reward_row_count: seed.counts.rewardRows,
      release_coverage: seed.releaseCounts,
      eligible_launches: seed.eligibleLaunches,
      account_evidence: seed.accountEvidence,
      token_addresses: seed.keys.tokenAddresses,
      account_addresses: seed.keys.accountAddresses,
      classic_launches: seed.keys.classicLaunches,
      stock_launches: seed.keys.stockLaunches,
      candidate_ids: seed.keys.candidateIds,
    };
    const executor = (kind: "projector" | "reader") => ({
      transaction: async (work: (transaction: { query: (sql: string) => Promise<unknown[]> }) => Promise<unknown>) =>
        work({
          query: async (sql: string) => {
            const statements = kind === "projector"
              ? projectorStatements
              : readerStatements;
            statements.push(sql);
            if (sql.includes("current_setting('role'")) {
              return kind === "projector"
                ? [{
                    session_user: "programmable_projector_login",
                    current_role: "programmable_projector",
                    current_setting_role: "programmable_projector",
                  }]
                : [{
                    session_user: "programmable_api_reader_login",
                    current_role: "programmable_api_reader",
                    current_setting_role: "programmable_api_reader",
                  }];
            }
            if (sql.includes("has_function_privilege")) {
              return [{ function_execute: false, view_select: false }];
            }
            if (sql.includes("get_read_model_performance_dataset_v1")) {
              if (kind === "reader") {
                throw Object.assign(new Error("permission denied"), {
                  code: "42501",
                });
              }
              return [datasetRow];
            }
            return [];
          },
        }),
      close: vi.fn(async () => undefined),
    });
    const projectorExecutor = executor("projector");
    const readerExecutor = executor("reader");
    const createExecutor = vi
      .fn()
      .mockReturnValueOnce(projectorExecutor)
      .mockReturnValueOnce(readerExecutor);

    const captured = await readPerformanceDataset(databaseEnvironment(), {
      createExecutor,
    });

    expect(captured.dataset).toEqual(seed);
    expect(captured.accessEvidence).toEqual(accessEvidence);
    expect(projectorStatements.findIndex((sql) =>
      sql.includes("current_setting('role'"),
    )).toBeLessThan(projectorStatements.findIndex((sql) =>
      sql.includes("get_read_model_performance_dataset_v1"),
    ));
    expect(readerStatements).toEqual(expect.arrayContaining([
      expect.stringContaining("has_function_privilege"),
      "savepoint performance_api_reader_denial",
      expect.stringContaining("get_read_model_performance_dataset_v1"),
      "rollback to savepoint performance_api_reader_denial",
      "release savepoint performance_api_reader_denial",
    ]));
    expect(projectorExecutor.close).toHaveBeenCalledOnce();
    expect(readerExecutor.close).toHaveBeenCalledOnce();
  });

  it("fails closed if the API reader can execute the projector dataset function", async () => {
    const seed = dataset();
    const datasetRow = {
      generated_at: new Date(seed.generatedAt),
      launch_count: seed.counts.launches,
      eligible_launch_count: seed.counts.launches,
      candidate_count: 8,
      chain_event_count: seed.counts.chainEvents,
      market_snapshot_count: seed.counts.marketSnapshots,
      market_candle_count: seed.counts.marketCandles,
      account_count: seed.counts.accounts,
      reward_row_count: seed.counts.rewardRows,
      release_coverage: seed.releaseCounts,
      eligible_launches: seed.eligibleLaunches,
      account_evidence: seed.accountEvidence,
      token_addresses: seed.keys.tokenAddresses,
      account_addresses: seed.keys.accountAddresses,
      classic_launches: seed.keys.classicLaunches,
      stock_launches: seed.keys.stockLaunches,
      candidate_ids: seed.keys.candidateIds,
    };
    const createExecutor = vi
      .fn()
      .mockReturnValueOnce({
        transaction: async (work: (transaction: { query: (sql: string) => Promise<unknown[]> }) => Promise<unknown>) =>
          work({ query: async (sql: string) =>
            sql.includes("current_setting('role'")
              ? [{
                  session_user: "programmable_projector_login",
                  current_role: "programmable_projector",
                  current_setting_role: "programmable_projector",
                }]
              : sql.includes("get_read_model_performance_dataset_v1")
                ? [datasetRow]
                : [] }),
        close: vi.fn(async () => undefined),
      })
      .mockReturnValueOnce({
        transaction: async (work: (transaction: { query: (sql: string) => Promise<unknown[]> }) => Promise<unknown>) =>
          work({ query: async (sql: string) =>
            sql.includes("current_setting('role'")
              ? [{
                  session_user: "programmable_api_reader_login",
                  current_role: "programmable_api_reader",
                  current_setting_role: "programmable_api_reader",
                }]
              : sql.includes("has_function_privilege")
                ? [{ function_execute: true, view_select: false }]
                : [] }),
        close: vi.fn(async () => undefined),
      });

    await expect(
      readPerformanceDataset(databaseEnvironment(), { createExecutor }),
    ).rejects.toThrow();
  });

  it("refuses undersized, duplicated or stale evidence instead of padding it", async () => {
    const undersized = dataset();
    undersized.keys.tokenAddresses = undersized.keys.tokenAddresses.slice(0, 99);
    const createEnvio = vi.fn();
    const dependencies = {
      readDataset: vi.fn(async () => ({
        dataset: undersized,
        accessEvidence,
      })),
      createEnvio,
      createProviders: vi.fn(),
      verifyBatch: vi.fn(),
      runRpcTrace: vi.fn(),
    } as never;

    await expect(
      captureReadModelPerformance(body(), {
        env: environment(),
        dependencies,
      }),
    ).rejects.toThrow();
    expect(createEnvio).not.toHaveBeenCalled();
  });

  it("requires independent deterministic Classic and Stock launch paths", async () => {
    const invalid = dataset();
    invalid.keys.stockLaunches[1] = invalid.keys.stockLaunches[0]!;
    const createEnvio = vi.fn();
    const dependencies = {
      readDataset: vi.fn(async () => ({ dataset: invalid, accessEvidence })),
      createEnvio,
      createProviders: vi.fn(),
      verifyBatch: vi.fn(),
      runRpcTrace: vi.fn(),
    } as never;

    await expect(
      captureReadModelPerformance(body(), {
        env: environment(),
        dependencies,
      }),
    ).rejects.toThrow();
    expect(createEnvio).not.toHaveBeenCalled();
  });
});
