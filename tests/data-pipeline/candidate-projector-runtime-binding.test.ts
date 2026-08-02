import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  assertCandidateDatabaseBootstrapState,
  assertCandidateDatabasePromotedState,
  loadCandidateProjectorRuntimeBinding,
  selectProjectorRuntimeBinding,
} from "../../lib/data-pipeline/candidate-projector-runtime-binding.server";
import { createEnvioClient } from "../../lib/data-pipeline/envio";
import { getDataPipelineReleaseBinding } from "../../lib/data-pipeline/release-binding.server";

const PUBLIC_FLAGS = [
  "INDEXED_EXPLORE_LIST_READS_ENABLED",
  "INDEXED_EXPLORE_TOKEN_READS_ENABLED",
  "INDEXED_EXPLORE_CHART_READS_ENABLED",
  "INDEXED_CREATOR_PROFILE_READS_ENABLED",
  "INDEXED_CLASSIC_V3_PROFILE_READS_ENABLED",
  "INDEXED_LAUNCH_LOOKUP_ENABLED",
  "INDEXED_PUBLIC_INDEXER_FEED_READS_ENABLED",
  "INDEXED_READ_SHADOW_COMPARE_ENABLED",
] as const;

function candidateEnvironment(
  overrides: Record<string, string | undefined> = {},
) {
  return {
    PROGRAMMABLE_PROJECTOR_BINDING_MODE: "candidate-backfill",
    PROGRAMMABLE_PROJECTOR_ENVIO_MIRROR_COMMIT:
      "7ffd15c2a28c481a2d3632e30b315262c2471b2e",
    PROGRAMMABLE_ENVIO_GRAPHQL_URL:
      "https://indexer.hyperindex.xyz/d7a39a2/v1/graphql",
    PROGRAMMABLE_PROJECTOR_ENVIO_REDACTED_IDENTITY:
      "envio:production-7f24e63",
    ...Object.fromEntries(PUBLIC_FLAGS.map((name) => [name, "false"])),
    ...overrides,
  };
}

function promotedReleaseEnvironment(
  overrides: Record<string, string | undefined> = {},
) {
  return candidateEnvironment({
    PROGRAMMABLE_PROJECTOR_BINDING_MODE: "release",
    VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
    VERCEL_DEPLOYMENT_ID: "dpl_12345678901234567890",
    ...overrides,
  });
}

function canonicalCandidateBinding() {
  return loadCandidateProjectorRuntimeBinding({
    env: candidateEnvironment(),
    activeProductionBinding: getDataPipelineReleaseBinding(),
  }).releaseBinding;
}

function legacyReleaseBinding() {
  const canonical = getDataPipelineReleaseBinding();
  return {
    ...canonical,
    envio: {
      deploymentLabel: "production-1e7c381",
      graphqlEndpoint:
        "https://indexer.hyperindex.xyz/f6714ef/v1/graphql",
      schemaVersion: "1" as const,
      sourceCommit: "1e7c38125714e2f485f8be0c665b12e7d7fb1809",
      configSha256:
        "0x378e3a799c762cb31107792c7123f5f90b54b5826884c398995e7465176fe1c2" as const,
      schemaSha256:
        "0x3217def060af2d1053ec3bca854187ff547fb43d91b113bc87a9f3285489362d" as const,
      handlerSha256:
        "0x241e18c3eda104b96eec4142826459c41c39cbce0474322634b5ea161d2fdf3e" as const,
      sourceRegistrySha256:
        "0x552e941d2ad7fea1184bf1efb97f840bdce9835c647b76f753f1326c6afe211f" as const,
      eventSetSha256:
        "0x7481d6fa986d706e46b9834e40574dd84f21be80b041d35e7d47dbfa59d69243" as const,
      eventCount: 51,
    },
  };
}

describe("candidate projector runtime binding", () => {
  it("binds only the exact audited candidate and defines an explicit promotion transition", () => {
    const binding = loadCandidateProjectorRuntimeBinding({
      env: candidateEnvironment(),
      activeProductionBinding: getDataPipelineReleaseBinding(),
    });

    expect(binding).toMatchObject({
      mode: "candidate-backfill",
      mirrorCommit: "7ffd15c2a28c481a2d3632e30b315262c2471b2e",
      releaseBinding: {
        envio: {
          deploymentLabel: "production-7f24e63",
          graphqlEndpoint:
            "https://indexer.hyperindex.xyz/d7a39a2/v1/graphql",
        },
      },
      databaseBootstrap: {
        mode: "candidate-only",
        providerDeploymentId: "d08b62a6-74fb-5e0a-a698-dc6877150db4",
      },
      promotionTransition: {
        requiredRuntimeMode: "release",
        requiredCanonicalEndpoint:
          "https://indexer.hyperindex.xyz/d7a39a2/v1/graphql",
        requiredCanonicalIdentity: "envio:production-7f24e63",
        requiresDatabasePromotionAttestation: true,
      },
    });
  });

  it("leaves the canonical candidate release binding unchanged", () => {
    const production = getDataPipelineReleaseBinding();
    const before = structuredClone(production);
    loadCandidateProjectorRuntimeBinding({
      env: candidateEnvironment(),
      activeProductionBinding: production,
    });

    expect(production).toEqual(before);
    expect(production.envio.deploymentLabel).toBe("production-7f24e63");
  });

  it("selects legacy, candidate-backfill, and promoted-release bindings without mutable globals", () => {
    const legacy = legacyReleaseBinding();
    const candidate = canonicalCandidateBinding();

    expect(selectProjectorRuntimeBinding({
      env: {},
      canonicalBinding: legacy,
    })).toMatchObject({
      mode: "release",
      releaseBinding: { envio: { deploymentLabel: "production-1e7c381" } },
      candidate: null,
      promotedDatabase: null,
    });
    expect(selectProjectorRuntimeBinding({
      env: candidateEnvironment(),
      canonicalBinding: candidate,
    })).toMatchObject({
      mode: "candidate-backfill",
      releaseBinding: { envio: { deploymentLabel: "production-7f24e63" } },
      promotedDatabase: null,
    });
    expect(selectProjectorRuntimeBinding({
      env: promotedReleaseEnvironment(),
      canonicalBinding: candidate,
    })).toMatchObject({
      mode: "release",
      releaseBinding: { envio: { deploymentLabel: "production-7f24e63" } },
      candidate: null,
      promotedDatabase: {
        providerDeploymentId: "d08b62a6-74fb-5e0a-a698-dc6877150db4",
        productCommit: "a".repeat(40),
        stagedDeploymentId: "dpl_12345678901234567890",
      },
    });
  });

  it.each([
    ["VERCEL_GIT_COMMIT_SHA", undefined],
    ["VERCEL_GIT_COMMIT_SHA", "0".repeat(40)],
    ["VERCEL_GIT_COMMIT_SHA", "A".repeat(40)],
    ["VERCEL_DEPLOYMENT_ID", undefined],
    ["VERCEL_DEPLOYMENT_ID", "production"],
  ])("rejects missing or mismatched promoted-release evidence in %s", (name, value) => {
    expect(() => selectProjectorRuntimeBinding({
      env: promotedReleaseEnvironment({ [name]: value }),
      canonicalBinding: canonicalCandidateBinding(),
    })).toThrow();
  });

  it.each(PUBLIC_FLAGS)("fails closed when %s is not exactly false", (name) => {
    expect(() =>
      loadCandidateProjectorRuntimeBinding({
        env: candidateEnvironment({ [name]: "true" }),
        activeProductionBinding: getDataPipelineReleaseBinding(),
      }),
    ).toThrow();
  });

  it("accepts the exact unpromoted database verification result", async () => {
    const binding = loadCandidateProjectorRuntimeBinding({
      env: candidateEnvironment(),
      activeProductionBinding: getDataPipelineReleaseBinding(),
    });
    const query = vi.fn(async (text: string) => {
      if (text.includes("current_role::text")) {
        return [{
          session_user: "programmable_projector_login",
          current_role: "programmable_projector",
        }];
      }
      if (text === "select session_user::text as session_user") {
        return [{ session_user: "programmable_projector_login" }];
      }
      if (text.includes("verify_candidate_database_unpromoted_v1")) {
        return [{ verified: true }];
      }
      return [];
    });
    const executor = {
      transaction: vi.fn(async (work) => work({ query })),
      close: vi.fn(),
    } as never;

    await expect(
      assertCandidateDatabaseBootstrapState({ executor, binding }),
    ).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("verify_candidate_database_unpromoted_v1"),
      expect.arrayContaining([
        "d08b62a6-74fb-5e0a-a698-dc6877150db4",
        "2026-08-01T09:00:00.000Z",
      ]),
    );
  });

  it("rejects provider identity drift and a promoted or missing candidate database", async () => {
    expect(() =>
      loadCandidateProjectorRuntimeBinding({
        env: candidateEnvironment({
          PROGRAMMABLE_ENVIO_GRAPHQL_URL:
            "https://indexer.hyperindex.xyz/f6714ef/v1/graphql",
        }),
        activeProductionBinding: getDataPipelineReleaseBinding(),
      }),
    ).toThrow();

    const binding = loadCandidateProjectorRuntimeBinding({
      env: candidateEnvironment(),
      activeProductionBinding: getDataPipelineReleaseBinding(),
    });
    const query = vi.fn(async (text: string) => {
      if (text.includes("current_role::text")) {
        return [{
          session_user: "programmable_projector_login",
          current_role: "programmable_projector",
        }];
      }
      if (text === "select session_user::text as session_user") {
        return [{ session_user: "programmable_projector_login" }];
      }
      if (text.includes("verify_candidate_database_unpromoted_v1")) {
        throw Object.assign(new Error("candidate database promoted"), {
          code: "55000",
        });
      }
      return [];
    });
    const executor = {
      transaction: vi.fn(async (work) => work({ query })),
      close: vi.fn(),
    } as never;

    await expect(
      assertCandidateDatabaseBootstrapState({ executor, binding }),
    ).rejects.toThrow();
  });

  it("accepts only the exact promoted database verification result", async () => {
    const selection = selectProjectorRuntimeBinding({
      env: promotedReleaseEnvironment(),
      canonicalBinding: canonicalCandidateBinding(),
    });
    if (!selection.promotedDatabase) throw new Error("missing promotion proof");
    const query = vi.fn(async (text: string) => {
      if (text.includes("current_role::text")) {
        return [{
          session_user: "programmable_projector_login",
          current_role: "programmable_projector",
        }];
      }
      if (text === "select session_user::text as session_user") {
        return [{ session_user: "programmable_projector_login" }];
      }
      if (text.includes("verify_candidate_database_promoted_v2")) {
        return [{ verified: true }];
      }
      return [];
    });
    const executor = {
      transaction: vi.fn(async (work) => work({ query })),
      close: vi.fn(),
    } as never;

    await expect(assertCandidateDatabasePromotedState({
      executor,
      binding: selection.promotedDatabase,
    })).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("verify_candidate_database_promoted_v2"),
      expect.arrayContaining([
        "d08b62a6-74fb-5e0a-a698-dc6877150db4",
        "2026-08-01T09:00:00.000Z",
        "a".repeat(40),
        "dpl_12345678901234567890",
      ]),
    );
  });

  it("validates real Envio progress against the selected candidate identity", async () => {
    const releaseBinding = canonicalCandidateBinding();
    const blockHash = `0x${"11".repeat(32)}`;
    const transactionHash = `0x${"22".repeat(32)}`;
    const occurrenceId = `1:${blockHash}:${transactionHash}:7`;
    const response = {
      data: {
        _meta: [{
          chainId: 1,
          progressBlock: 25_650_010,
          bufferBlock: 25_650_010,
          sourceBlock: 25_650_022,
          isReady: true,
          eventsProcessed: 51_234,
        }],
        IndexerState_by_pk: {
          id: "ethereum-mainnet",
          schemaVersion: "1",
          deployment: releaseBinding.envio.deploymentLabel,
          sourceCommit: releaseBinding.envio.sourceCommit,
          configSha256: releaseBinding.envio.configSha256,
          schemaSha256: releaseBinding.envio.schemaSha256,
          handlerSha256: releaseBinding.envio.handlerSha256,
          sourceRegistrySha256: releaseBinding.envio.sourceRegistrySha256,
          eventSetSha256: releaseBinding.envio.eventSetSha256,
          eventCount: releaseBinding.envio.eventCount,
          chainId: 1,
          progressBlock: "25650000",
          progressBlockHash: blockHash,
          progressTimestamp: "1785480000",
          progressTransactionHash: transactionHash,
          progressOccurrenceId: occurrenceId,
        },
      },
    };
    const fetcher = vi.fn(async () => new Response(JSON.stringify(response), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const candidateClient = createEnvioClient({
      endpoint: releaseBinding.envio.graphqlEndpoint,
      releaseBinding,
      fetcher,
    });

    await expect(candidateClient.readProgress({
      requiredBlock: "25650002",
    })).resolves.toMatchObject({
      deployment: "production-7f24e63",
      progressBlock: "25650010",
      isReady: true,
    });

    const legacyClient = createEnvioClient({
      endpoint: legacyReleaseBinding().envio.graphqlEndpoint,
      releaseBinding: legacyReleaseBinding(),
      fetcher,
    });
    await expect(legacyClient.readProgress({
      requiredBlock: "25650002",
    })).rejects.toMatchObject({ code: "validation_failed" });
  });
});
