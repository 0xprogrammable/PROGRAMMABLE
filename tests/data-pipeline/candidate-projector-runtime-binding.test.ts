import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  assertCandidateDatabaseBootstrapState,
  assertCandidateDatabasePromotedState,
  loadCandidateProjectorRuntimeBinding,
  selectProjectorRuntimeBinding,
} from "../../lib/data-pipeline/candidate-projector-runtime-binding.server";
import { getDataPipelineReleaseBinding } from "../../lib/data-pipeline/release-binding.server";

function currentProductionEnvironment(
  overrides: Record<string, string | undefined> = {},
) {
  return {
    PROGRAMMABLE_PROJECTOR_BINDING_MODE: "release",
    PROGRAMMABLE_PROJECTOR_ENVIO_MIRROR_COMMIT:
      "0a064ec0a32a0e48bf6751fa18f025504267c6b7",
    PROGRAMMABLE_ENVIO_GRAPHQL_URL:
      "https://indexer.hyperindex.xyz/f6714ef/v1/graphql",
    PROGRAMMABLE_PROJECTOR_ENVIO_REDACTED_IDENTITY:
      "envio:production-92f6373",
    ...overrides,
  };
}

describe("current projector runtime binding", () => {
  it("selects only the exact canonical production release", () => {
    const canonicalBinding = getDataPipelineReleaseBinding();
    expect(selectProjectorRuntimeBinding({
      env: currentProductionEnvironment(),
      canonicalBinding,
    })).toEqual({
      mode: "release",
      releaseBinding: canonicalBinding,
      candidate: null,
      promotedDatabase: null,
    });
  });

  it("rejects every historical candidate selector and identity", () => {
    const canonicalBinding = getDataPipelineReleaseBinding();
    for (const env of [
      currentProductionEnvironment({
        PROGRAMMABLE_PROJECTOR_BINDING_MODE: "candidate-backfill",
      }),
      currentProductionEnvironment({
        PROGRAMMABLE_PROJECTOR_ENVIO_MIRROR_COMMIT:
          "7ffd15c2a28c481a2d3632e30b315262c2471b2e",
      }),
      currentProductionEnvironment({
        PROGRAMMABLE_ENVIO_GRAPHQL_URL:
          "https://indexer.hyperindex.xyz/d7a39a2/v1/graphql",
      }),
      currentProductionEnvironment({
        PROGRAMMABLE_PROJECTOR_ENVIO_REDACTED_IDENTITY:
          "envio:production-7f24e63",
      }),
    ]) {
      expect(() => selectProjectorRuntimeBinding({ env, canonicalBinding }))
        .toThrow();
    }
  });

  it("keeps every retired candidate database entry point fail closed", async () => {
    expect(() => loadCandidateProjectorRuntimeBinding()).toThrow();
    await expect(assertCandidateDatabaseBootstrapState()).rejects.toThrow();
    await expect(assertCandidateDatabasePromotedState({
      executor: {} as never,
      binding: {} as never,
    })).rejects.toThrow();
  });
});
