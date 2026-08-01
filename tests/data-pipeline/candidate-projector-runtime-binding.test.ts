import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  assertCandidateDatabaseBootstrapState,
  loadCandidateProjectorRuntimeBinding,
} from "../../lib/data-pipeline/candidate-projector-runtime-binding.server";
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
});
