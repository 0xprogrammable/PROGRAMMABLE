import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  assertCandidateDatabaseBootstrapState,
  assertCandidateDatabasePromotedState,
  CANDIDATE_PROMOTION_ENV_NAMES,
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

const PROMOTION_COMMITMENTS = Object.freeze({
  baseline: `0x${"31".repeat(32)}`,
  parity: `0x${"32".repeat(32)}`,
  attestation: `0x${"33".repeat(32)}`,
  input: `0x${"34".repeat(32)}`,
});

function promotedReleaseEnvironment(
  overrides: Record<string, string | undefined> = {},
) {
  return candidateEnvironment({
    PROGRAMMABLE_PROJECTOR_BINDING_MODE: "release",
    [CANDIDATE_PROMOTION_ENV_NAMES.providerDeploymentId]:
      "d08b62a6-74fb-5e0a-a698-dc6877150db4",
    [CANDIDATE_PROMOTION_ENV_NAMES.deploymentCommitment]:
      "0xa4267153060a4b02b630d81063e0f84bb36f6f637a52ef71fb29c117c5384259",
    [CANDIDATE_PROMOTION_ENV_NAMES.schemaCommitment]:
      "0x5796791b38f16ba71b7a9a8f9977174c869de663f08c0aa0194e9cc631d93ef1",
    [CANDIDATE_PROMOTION_ENV_NAMES.initializationInputCommitment]:
      "0x8945e310f60754716ca0015bcdcdf4a39f9db07ab1c6d9c6bf59fee2b701dca9",
    [CANDIDATE_PROMOTION_ENV_NAMES.initializedAt]:
      "2026-08-01T09:00:00.000Z",
    [CANDIDATE_PROMOTION_ENV_NAMES.baselineCommitment]:
      PROMOTION_COMMITMENTS.baseline,
    [CANDIDATE_PROMOTION_ENV_NAMES.parityCommitment]:
      PROMOTION_COMMITMENTS.parity,
    [CANDIDATE_PROMOTION_ENV_NAMES.envioAttestationCommitment]:
      PROMOTION_COMMITMENTS.attestation,
    [CANDIDATE_PROMOTION_ENV_NAMES.promotionInputCommitment]:
      PROMOTION_COMMITMENTS.input,
    [CANDIDATE_PROMOTION_ENV_NAMES.promotedAt]:
      "2026-08-01T10:00:00.000Z",
    ...overrides,
  });
}

function canonicalCandidateBinding() {
  return loadCandidateProjectorRuntimeBinding({
    env: candidateEnvironment(),
    activeProductionBinding: getDataPipelineReleaseBinding(),
  }).releaseBinding;
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

  it("leaves the canonical production release binding unchanged", () => {
    const production = getDataPipelineReleaseBinding();
    loadCandidateProjectorRuntimeBinding({
      env: candidateEnvironment(),
      activeProductionBinding: production,
    });

    expect(production.envio).toMatchObject({
      deploymentLabel: "production-1e7c381",
      graphqlEndpoint:
        "https://indexer.hyperindex.xyz/f6714ef/v1/graphql",
    });
  });

  it("selects legacy, candidate-backfill, and promoted-release bindings without mutable globals", () => {
    const legacy = getDataPipelineReleaseBinding();
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
        baselineCommitment: PROMOTION_COMMITMENTS.baseline,
        parityCommitment: PROMOTION_COMMITMENTS.parity,
        envioAttestationCommitment: PROMOTION_COMMITMENTS.attestation,
        promotionInputCommitment: PROMOTION_COMMITMENTS.input,
        promotedAt: "2026-08-01T10:00:00.000Z",
      },
    });
  });

  it.each([
    [CANDIDATE_PROMOTION_ENV_NAMES.baselineCommitment, undefined],
    [CANDIDATE_PROMOTION_ENV_NAMES.parityCommitment, `0x${"00".repeat(32)}`],
    [
      CANDIDATE_PROMOTION_ENV_NAMES.envioAttestationCommitment,
      "0x1234",
    ],
    [
      CANDIDATE_PROMOTION_ENV_NAMES.providerDeploymentId,
      "d08b62a6-74fb-5e0a-a698-dc6877150db5",
    ],
    [
      CANDIDATE_PROMOTION_ENV_NAMES.promotedAt,
      "2026-08-01T08:59:59.000Z",
    ],
    [
      `NEXT_PUBLIC_${CANDIDATE_PROMOTION_ENV_NAMES.baselineCommitment}`,
      PROMOTION_COMMITMENTS.baseline,
    ],
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
      if (text.includes("verify_candidate_database_promoted_v1")) {
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
      expect.stringContaining("verify_candidate_database_promoted_v1"),
      expect.arrayContaining([
        "d08b62a6-74fb-5e0a-a698-dc6877150db4",
        "2026-08-01T09:00:00.000Z",
        "2026-08-01T10:00:00.000Z",
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
      endpoint: getDataPipelineReleaseBinding().envio.graphqlEndpoint,
      releaseBinding: getDataPipelineReleaseBinding(),
      fetcher,
    });
    await expect(legacyClient.readProgress({
      requiredBlock: "25650002",
    })).rejects.toMatchObject({ code: "validation_failed" });
  });
});
