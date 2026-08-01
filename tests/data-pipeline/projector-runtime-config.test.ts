import { rootCertificates } from "node:tls";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  assertProjectorRuntimeProviderCommitments,
  loadProjectorRuntimeConfig,
  runConfiguredProjectorCycle,
} from "../../lib/data-pipeline/projector-runtime-config.server";
import {
  projectorEnvioDeploymentCommitment,
  projectorEnvioSchemaCommitment,
  projectorRpcDeploymentCommitment,
  projectorRpcSchemaCommitment,
} from "../../lib/data-pipeline/projector-provider-commitments";
import { getDataPipelineReleaseBinding } from "../../lib/data-pipeline/release-binding.server";

const bytes32 = (byte: string) => `0x${byte.repeat(64)}`;
const TEST_CA = rootCertificates[0]!;
const ALCHEMY_URL = "https://eth-mainnet.g.alchemy.com/v2/abcdefgh";
const QUICKNODE_URL = "https://example.quiknode.pro/abcdefgh/";
const ENVIO_URL = "https://indexer.hyperindex.xyz/f6714ef/v1/graphql";
const ENVIO_IDENTITY = "envio:production-1e7c381";
const RELEASE_BINDING = getDataPipelineReleaseBinding();
const RPC_SCHEMA_COMMITMENT = projectorRpcSchemaCommitment();
const EXPECTED_COMMITMENTS = Object.freeze({
  envioDeployment: projectorEnvioDeploymentCommitment({
    endpoint: ENVIO_URL,
    redactedIdentity: ENVIO_IDENTITY,
    binding: RELEASE_BINDING,
  }),
  envioSchema: projectorEnvioSchemaCommitment(RELEASE_BINDING),
  alchemyDeployment: projectorRpcDeploymentCommitment(ALCHEMY_URL),
  quicknodeDeployment: projectorRpcDeploymentCommitment(QUICKNODE_URL),
});
const RUNTIME_PROVIDERS = Object.freeze([
  Object.freeze({
    vendorGroup: "alchemy",
    endpointCommitment: EXPECTED_COMMITMENTS.alchemyDeployment,
  }),
  Object.freeze({
    vendorGroup: "quicknode",
    endpointCommitment: EXPECTED_COMMITMENTS.quicknodeDeployment,
  }),
]) as never;

function environment(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    PROGRAMMABLE_PROJECTOR_DATABASE_URL:
      "postgresql://programmable_projector_login:password@db.example:5432/postgres?sslmode=verify-full",
    PROGRAMMABLE_PROJECTOR_RUNTIME_DATABASE_URL:
      "postgresql://programmable_projector_runtime_login:password@db.example:5432/postgres?sslmode=verify-full",
    PROGRAMMABLE_POSTGRES_SSL_CA_PEM: TEST_CA,
    PROGRAMMABLE_ENVIO_GRAPHQL_URL: ENVIO_URL,
    PROGRAMMABLE_ENVIO_GRAPHQL_TOKEN: "envio-token",
    PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL: ALCHEMY_URL,
    PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL: QUICKNODE_URL,
    PROGRAMMABLE_PROJECTOR_ENVIO_REDACTED_IDENTITY: ENVIO_IDENTITY,
    ...overrides,
  };
}

describe("configured projector runtime", () => {
  it("builds the exact provider set and every frozen release scope", () => {
    const config = loadProjectorRuntimeConfig(environment());

    expect(config.database).toEqual({
      projectorConnectionString:
        "postgresql://programmable_projector_login:password@db.example:5432/postgres?sslmode=verify-full",
      runtimeConnectionString:
        "postgresql://programmable_projector_runtime_login:password@db.example:5432/postgres?sslmode=verify-full",
      sslCaPem: TEST_CA,
    });
    expect(config.envio).toEqual({
      endpoint: "https://indexer.hyperindex.xyz/f6714ef/v1/graphql",
      token: "envio-token",
    });
    expect(config.providers).toEqual([
      {
        type: "envio_deployment",
        redactedIdentity: ENVIO_IDENTITY,
        deploymentCommitment: EXPECTED_COMMITMENTS.envioDeployment,
        schemaCommitment: EXPECTED_COMMITMENTS.envioSchema,
      },
      {
        type: "rpc_provider",
        redactedIdentity: "rpc:1:alchemy",
        deploymentCommitment: EXPECTED_COMMITMENTS.alchemyDeployment,
        schemaCommitment: RPC_SCHEMA_COMMITMENT,
      },
      {
        type: "rpc_provider",
        redactedIdentity: "rpc:1:quicknode",
        deploymentCommitment: EXPECTED_COMMITMENTS.quicknodeDeployment,
        schemaCommitment: RPC_SCHEMA_COMMITMENT,
      },
    ]);
    expect(config.releaseScopes).toEqual([
      { releaseId: "classic-v2", modelId: "classic", sourceGroup: "core" },
      { releaseId: "classic-v3", modelId: "classic", sourceGroup: "core" },
      { releaseId: "stock-paired-v1", modelId: "stock-paired", sourceGroup: "core" },
      { releaseId: "stock-paired-v2", modelId: "stock-paired", sourceGroup: "core" },
      { releaseId: "stock-paired-v3", modelId: "stock-paired", sourceGroup: "core" },
    ]);
  });

  it.each([
    "PROGRAMMABLE_PROJECTOR_DATABASE_URL",
    "PROGRAMMABLE_PROJECTOR_RUNTIME_DATABASE_URL",
    "PROGRAMMABLE_POSTGRES_SSL_CA_PEM",
    "PROGRAMMABLE_ENVIO_GRAPHQL_URL",
    "PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL",
    "PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL",
    "PROGRAMMABLE_PROJECTOR_ENVIO_REDACTED_IDENTITY",
  ])("fails closed when %s is absent", (name) => {
    expect(() =>
      loadProjectorRuntimeConfig(environment({ [name]: undefined })),
    ).toThrow();
  });

  it("rejects browser-exposed secrets and provider identity mismatches", () => {
    expect(() =>
      loadProjectorRuntimeConfig(
        environment({
          NEXT_PUBLIC_PROGRAMMABLE_PROJECTOR_DATABASE_URL:
            "postgresql://public:secret@db.example:5432/postgres?sslmode=verify-full",
        }),
      ),
    ).toThrow();
    expect(() =>
      loadProjectorRuntimeConfig(
        environment({
          PROGRAMMABLE_PROJECTOR_ENVIO_REDACTED_IDENTITY:
            "envio:unreviewed",
        }),
      ),
    ).toThrow();
    expect(() =>
      loadProjectorRuntimeConfig(
        environment({
          PROGRAMMABLE_ENVIO_GRAPHQL_URL:
            "https://indexer.hyperindex.xyz/other123/v1/graphql",
        }),
      ),
    ).toThrow();
    expect(() =>
      loadProjectorRuntimeConfig(
        environment({
          PROGRAMMABLE_ENVIO_GRAPHQL_URL:
            "https://example.com/f6714ef/v1/graphql",
        }),
      ),
    ).toThrow();
  });

  it("rejects a runtime RPC pair that does not match the derived endpoints", () => {
    const config = loadProjectorRuntimeConfig(environment());
    expect(() =>
      assertProjectorRuntimeProviderCommitments(
        config.providers,
        Object.freeze([
          Object.freeze({
            vendorGroup: "alchemy",
            endpointCommitment: bytes32("f"),
          }),
          Object.freeze({
            vendorGroup: "quicknode",
            endpointCommitment: EXPECTED_COMMITMENTS.quicknodeDeployment,
          }),
        ]) as never,
      ),
    ).toThrow();
  });

  it("runs ingestion and every release scope fairly, then closes the writer executor", async () => {
    const close = vi.fn(async () => undefined);
    const executor = { close };
    const providers = RUNTIME_PROVIDERS;
    const envio = {};
    const ingestionStore = {};
    const createReleaseStore = vi.fn(({ scope }) => ({ scope }));
    const runReleaseCycle = vi.fn(async () => ({ status: "idle" as const }));
    const runCycle = vi
      .fn()
      .mockResolvedValueOnce({
        status: "idle",
        candidateCount: 0,
        snapshotBlock: "25650000",
      })
      .mockRejectedValueOnce(new Error("runtime failed"));
    const dependencies = {
      createExecutor: vi.fn(() => executor),
      createLeaseController: vi.fn(() => ({
        tryAcquire: vi.fn(async () => ({
          status: "acquired",
          fence: {
            holderId: "projector-runtime-test",
            generation: "1",
            tokenHash: bytes32("a"),
          },
          acquiredAt: "2026-07-31T18:00:00.000Z",
          expiresAt: "2026-07-31T18:01:25.000Z",
        })),
        release: vi.fn(async () => true),
      })),
      createProviders: vi.fn(() => providers),
      assertProviders: vi.fn(),
      createEnvio: vi.fn(() => envio),
      createStore: vi.fn(() => ingestionStore),
      createReleaseStore,
      runCycle,
      runReleaseCycle,
    } as never;

    await expect(
      runConfiguredProjectorCycle({
        env: environment(),
        dependencies,
      }),
    ).resolves.toMatchObject({
      ok: true,
      ingestion: { status: "idle" },
      projections: [
        { releaseId: "classic-v2", status: "idle" },
        { releaseId: "classic-v3", status: "idle" },
        { releaseId: "stock-paired-v1", status: "idle" },
        { releaseId: "stock-paired-v2", status: "idle" },
        { releaseId: "stock-paired-v3", status: "idle" },
      ],
      readiness: {
        status: "caught-up",
        activationReady: true,
        lagging: false,
      },
    });
    await expect(
      runConfiguredProjectorCycle({
        env: environment(),
        dependencies,
      }),
    ).resolves.toMatchObject({
      ok: false,
      ingestion: { status: "failed" },
      readiness: { status: "incomplete", activationReady: false },
    });

    expect(close).toHaveBeenCalledTimes(4);
    expect(runCycle).toHaveBeenCalledWith(
      expect.objectContaining({
        store: ingestionStore,
        envio,
        providers,
        deadlineMs: 10_000,
      }),
    );
    expect(createReleaseStore).toHaveBeenCalledTimes(10);
    expect(runReleaseCycle).toHaveBeenCalledTimes(10);
    expect(runReleaseCycle).toHaveBeenCalledWith(
      expect.objectContaining({
        envio,
        providers,
        deadlineMs: 10_000,
      }),
    );
  });

  it("does no provider or writer work when the singleton is already owned", async () => {
    const close = vi.fn(async () => undefined);
    const createExecutor = vi.fn(() => ({ close }));
    const createProviders = vi.fn();
    const createEnvio = vi.fn();
    const createStore = vi.fn();
    const createReleaseStore = vi.fn();
    const runCycle = vi.fn();
    const runReleaseCycle = vi.fn();
    const release = vi.fn();
    const dependencies = {
      createExecutor,
      createLeaseController: vi.fn(() => ({
        tryAcquire: vi.fn(async () => ({
          status: "busy",
          acquiredAt: "2026-07-31T18:00:00.000Z",
          expiresAt: "2026-07-31T18:01:25.000Z",
        })),
        release,
      })),
      createProviders,
      assertProviders: vi.fn(),
      createEnvio,
      createStore,
      createReleaseStore,
      runCycle,
      runReleaseCycle,
    } as never;

    await expect(
      runConfiguredProjectorCycle({
        env: environment(),
        dependencies,
      }),
    ).resolves.toEqual({
      ok: true,
      status: "busy",
      readiness: {
        status: "busy",
        activationReady: false,
        lagging: true,
      },
    });

    expect(createExecutor).toHaveBeenCalledOnce();
    expect(createExecutor).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionString:
          "postgresql://programmable_projector_runtime_login:password@db.example:5432/postgres?sslmode=verify-full",
      }),
    );
    expect(createProviders).not.toHaveBeenCalled();
    expect(createEnvio).not.toHaveBeenCalled();
    expect(createStore).not.toHaveBeenCalled();
    expect(createReleaseStore).not.toHaveBeenCalled();
    expect(runCycle).not.toHaveBeenCalled();
    expect(runReleaseCycle).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it("drains bounded pages without starving any release scope", async () => {
    const close = vi.fn(async () => undefined);
    const executor = { close };
    const providers = RUNTIME_PROVIDERS;
    const envio = {};
    const ingestionStore = {};
    const releaseCalls = new Map<string, number>();
    const runCycle = vi
      .fn()
      .mockResolvedValueOnce({
        status: "committed",
        candidateCount: 32,
        snapshotBlock: "25650000",
        generation: "41",
      })
      .mockResolvedValueOnce({
        status: "committed",
        candidateCount: 7,
        snapshotBlock: "25650010",
        generation: "42",
      })
      .mockResolvedValueOnce({
        status: "idle",
        candidateCount: 0,
        snapshotBlock: "25650010",
      });
    const runReleaseCycle = vi.fn(async ({ store }) => {
      const releaseId = (store as { scope: { releaseId: string } }).scope.releaseId;
      const call = (releaseCalls.get(releaseId) ?? 0) + 1;
      releaseCalls.set(releaseId, call);
      if (call === 1) {
        return {
          status: "committed" as const,
          projectedCandidateCount: 20,
          ignoredCandidateCount: 12,
          checkpointGeneration: "51",
        };
      }
      if (call === 2) {
        return {
          status: "committed" as const,
          projectedCandidateCount: 5,
          ignoredCandidateCount: 2,
          checkpointGeneration: "52",
        };
      }
      return { status: "idle" as const };
    });
    const dependencies = {
      createExecutor: vi.fn(() => executor),
      createLeaseController: vi.fn(() => ({
        tryAcquire: vi.fn(async () => ({
          status: "acquired",
          fence: {
            holderId: "projector-runtime-test",
            generation: "1",
            tokenHash: bytes32("a"),
          },
          acquiredAt: "2026-07-31T18:00:00.000Z",
          expiresAt: "2026-07-31T18:01:25.000Z",
        })),
        release: vi.fn(async () => true),
      })),
      createProviders: vi.fn(() => providers),
      assertProviders: vi.fn(),
      createEnvio: vi.fn(() => envio),
      createStore: vi.fn(() => ingestionStore),
      createReleaseStore: vi.fn(({ scope }) => ({ scope })),
      runCycle,
      runReleaseCycle,
    } as never;

    await expect(
      runConfiguredProjectorCycle({
        env: environment(),
        dependencies,
      }),
    ).resolves.toEqual({
      ok: true,
      ingestion: {
        status: "committed",
        candidateCount: 39,
        pageCount: 3,
        snapshotBlock: "25650010",
        generation: "42",
      },
      projections: [
        "classic-v2",
        "classic-v3",
        "stock-paired-v1",
        "stock-paired-v2",
        "stock-paired-v3",
      ].map((releaseId) => ({
        releaseId,
        status: "committed",
        projectedCandidateCount: 25,
        ignoredCandidateCount: 14,
        pageCount: 3,
        checkpointGeneration: "52",
      })),
      readiness: {
        status: "caught-up",
        activationReady: true,
        lagging: false,
        terminalSweepComplete: true,
        stoppedForDeadline: false,
        completedRounds: 3,
        snapshotBlock: "25650010",
      },
      deadlineMs: 75_000,
    });

    expect(runCycle).toHaveBeenCalledTimes(3);
    expect(runReleaseCycle).toHaveBeenCalledTimes(15);
    expect([...releaseCalls.values()]).toEqual([3, 3, 3, 3, 3]);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("does not report an atomic-group release as terminally swept", async () => {
    const close = vi.fn(async () => undefined);
    const executor = { close };
    const releaseCalls = new Map<string, number>();
    const runCycle = vi.fn(async () => ({
      status: "idle" as const,
      candidateCount: 0,
      snapshotBlock: "25650200",
    }));
    const runReleaseCycle = vi.fn(async ({ store }) => {
      const releaseId = (store as { scope: { releaseId: string } }).scope
        .releaseId;
      releaseCalls.set(releaseId, (releaseCalls.get(releaseId) ?? 0) + 1);
      if (releaseId === "classic-v3") {
        return {
          status: "committed" as const,
          projectedCandidateCount: 96,
          ignoredCandidateCount: 0,
          checkpointGeneration: "1",
          batchKind: "reward-block" as const,
        };
      }
      return { status: "idle" as const };
    });
    const dependencies = {
      createExecutor: vi.fn(() => executor),
      createLeaseController: vi.fn(() => ({
        tryAcquire: vi.fn(async () => ({
          status: "acquired",
          fence: {
            holderId: "projector-runtime-test",
            generation: "1",
            tokenHash: bytes32("a"),
          },
          acquiredAt: "2026-07-31T18:00:00.000Z",
          expiresAt: "2026-07-31T18:01:25.000Z",
        })),
        release: vi.fn(async () => true),
      })),
      createProviders: vi.fn(() => RUNTIME_PROVIDERS),
      assertProviders: vi.fn(),
      createEnvio: vi.fn(() => ({})),
      createStore: vi.fn(() => ({})),
      createReleaseStore: vi.fn(({ scope }) => ({ scope })),
      runCycle,
      runReleaseCycle,
    } as never;

    const result = await runConfiguredProjectorCycle({
      env: environment(),
      dependencies,
    });
    expect(result).toMatchObject({
      ok: true,
      readiness: {
        status: "progressed",
        activationReady: false,
        lagging: true,
        terminalSweepComplete: false,
      },
    });
    expect(
      "projections" in result
        ? result.projections.find(({ releaseId }) =>
            releaseId === "classic-v3"
          )
        : null,
    ).toMatchObject({
      releaseId: "classic-v3",
      status: "committed",
      projectedCandidateCount: 96,
      atomicGroupCount: 1,
    });

    expect(runCycle).toHaveBeenCalledTimes(2);
    expect(releaseCalls.get("classic-v3")).toBe(1);
    expect(releaseCalls.get("classic-v2")).toBe(2);
  });

  it("finishes a 264-candidate corpus across two bounded runtime cycles", async () => {
    const close = vi.fn(async () => undefined);
    const executor = { close };
    const releaseCalls = new Map<string, number>();
    let ingestionCalls = 0;
    const runCycle = vi.fn(async () => {
      ingestionCalls += 1;
      if (ingestionCalls <= 8) {
        return {
          status: "committed" as const,
          candidateCount: 32,
          snapshotBlock: "25650200",
          generation: String(ingestionCalls),
        };
      }
      if (ingestionCalls === 9) {
        return {
          status: "committed" as const,
          candidateCount: 8,
          snapshotBlock: "25650201",
          generation: "9",
        };
      }
      return {
        status: "idle" as const,
        candidateCount: 0,
        snapshotBlock: "25650201",
      };
    });
    const runReleaseCycle = vi.fn(async ({ store }) => {
      const releaseId = (store as { scope: { releaseId: string } }).scope.releaseId;
      const call = (releaseCalls.get(releaseId) ?? 0) + 1;
      releaseCalls.set(releaseId, call);
      if (call <= 8) {
        return {
          status: "committed" as const,
          projectedCandidateCount: 32,
          ignoredCandidateCount: 0,
          checkpointGeneration: String(call),
        };
      }
      if (call === 9) {
        return {
          status: "committed" as const,
          projectedCandidateCount: 8,
          ignoredCandidateCount: 0,
          checkpointGeneration: "9",
        };
      }
      return { status: "idle" as const };
    });
    const dependencies = {
      createExecutor: vi.fn(() => executor),
      createLeaseController: vi.fn(() => ({
        tryAcquire: vi.fn(async () => ({
          status: "acquired",
          fence: {
            holderId: "projector-runtime-test",
            generation: "1",
            tokenHash: bytes32("a"),
          },
          acquiredAt: "2026-07-31T18:00:00.000Z",
          expiresAt: "2026-07-31T18:01:25.000Z",
        })),
        release: vi.fn(async () => true),
      })),
      createProviders: vi.fn(() => RUNTIME_PROVIDERS),
      assertProviders: vi.fn(),
      createEnvio: vi.fn(() => ({})),
      createStore: vi.fn(() => ({})),
      createReleaseStore: vi.fn(({ scope }) => ({ scope })),
      runCycle,
      runReleaseCycle,
    } as never;

    const first = await runConfiguredProjectorCycle({
      env: environment(),
      dependencies,
    });
    expect(first).toMatchObject({
      ok: true,
      ingestion: { candidateCount: 256, pageCount: 8 },
      readiness: {
        status: "progressed",
        activationReady: false,
        lagging: true,
        completedRounds: 8,
      },
    });

    const second = await runConfiguredProjectorCycle({
      env: environment(),
      dependencies,
    });
    expect(second).toMatchObject({
      ok: true,
      ingestion: { candidateCount: 8, pageCount: 2 },
      readiness: {
        status: "caught-up",
        activationReady: true,
        lagging: false,
        completedRounds: 2,
      },
    });
    expect(ingestionCalls).toBe(10);
    expect([...releaseCalls.values()]).toEqual([10, 10, 10, 10, 10]);
    expect(close).toHaveBeenCalledTimes(4);
  });
});
