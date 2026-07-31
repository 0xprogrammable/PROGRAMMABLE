import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getDataPipelineReleaseBinding,
  parseDataPipelineReleaseBinding,
} from "../lib/data-pipeline/release-binding.server";

describe("data pipeline release binding", () => {
  it("loads the exact reviewed Mainnet Envio and Uniswap identities", () => {
    const binding = getDataPipelineReleaseBinding();

    expect(binding).toMatchObject({
      schemaVersion: 1,
      chainId: 1,
      startBlock: 25_624_130,
      envio: {
        deploymentLabel: "production-1e7c381",
        graphqlEndpoint:
          "https://indexer.hyperindex.xyz/f6714ef/v1/graphql",
        schemaVersion: "1",
        sourceCommit: "1e7c38125714e2f485f8be0c665b12e7d7fb1809",
        eventCount: 51,
      },
      uniswapV4Subgraph: {
        subgraphId: "DiYPVdygkfjDWhbxGSqAQxwBKmfKnkWQojqeM2rkLb3G",
        deployment: "QmZsgJLiLQKpb8hxTmQ5LWyrFVvfWzVaL4WK8dfFBn7EeK",
      },
    });
    expect(binding.sources).toHaveLength(16);
    expect(new Set(binding.sources.map(({ address }) => address)).size).toBe(16);
    expect(new Set(binding.sources.map(({ contractName }) => contractName)).size).toBe(16);
    expect(
      binding.sources.every(({ runtimeCodeHash }) =>
        /^0x[0-9a-f]{64}$/.test(runtimeCodeHash),
      ),
    ).toBe(true);
    expect(binding.releases.map(({ releaseVersion }) => releaseVersion)).toEqual([
      "classic-v2",
      "classic-v3",
      "stock-paired-v1",
      "stock-paired-v2",
      "stock-paired-v3",
    ]);
    expect(binding.releases.map(({ activationBlock }) => activationBlock)).toEqual([
      25_624_131,
      25_639_596,
      25_637_469,
      25_640_338,
      25_642_745,
    ]);
  });

  it("rejects duplicate sources and malformed commitments", () => {
    const valid = getDataPipelineReleaseBinding();
    const duplicateSource = {
      ...valid,
      sources: [...valid.sources, valid.sources[0]],
    };
    const malformedCommitment = {
      ...valid,
      envio: {
        ...valid.envio,
        eventSetSha256: "0x1234",
      },
    };
    const zeroSourceCommit = {
      ...valid,
      envio: {
        ...valid.envio,
        sourceCommit: "0".repeat(40),
      },
    };
    const zeroArtifactCommitment = {
      ...valid,
      envio: {
        ...valid.envio,
        schemaSha256: `0x${"00".repeat(32)}`,
      },
    };
    const zeroRuntimeCommitment = {
      ...valid,
      sources: valid.sources.map((source, index) =>
        index === 0
          ? { ...source, runtimeCodeHash: `0x${"00".repeat(32)}` }
          : source,
      ),
    };
    const unreviewedEndpoint = {
      ...valid,
      envio: {
        ...valid.envio,
        graphqlEndpoint: "https://example.com/graphql",
      },
    };

    expect(() => parseDataPipelineReleaseBinding(duplicateSource)).toThrow(
      "Invalid data pipeline release binding",
    );
    expect(() => parseDataPipelineReleaseBinding(malformedCommitment)).toThrow(
      "Invalid data pipeline release binding",
    );
    expect(() => parseDataPipelineReleaseBinding(zeroSourceCommit)).toThrow(
      "Invalid data pipeline release binding",
    );
    expect(() =>
      parseDataPipelineReleaseBinding(zeroArtifactCommitment),
    ).toThrow("Invalid data pipeline release binding");
    expect(() => parseDataPipelineReleaseBinding(zeroRuntimeCommitment)).toThrow(
      "Invalid data pipeline release binding",
    );
    expect(() => parseDataPipelineReleaseBinding(unreviewedEndpoint)).toThrow(
      "Invalid data pipeline release binding",
    );
  });

  it("rejects orphaned, cross-model, and static-as-dynamic source bindings", () => {
    const valid = getDataPipelineReleaseBinding();
    const orphaned = {
      ...valid,
      releases: valid.releases.map((release) => ({
        ...release,
        sourceContracts: release.sourceContracts.filter(
          (name) => name !== "ClassicV2Hook",
        ),
      })),
    };
    const crossModel = {
      ...valid,
      releases: valid.releases.map((release) =>
        release.releaseVersion === "stock-paired-v1"
          ? {
              ...release,
              sourceContracts: [
                ...release.sourceContracts,
                "ClassicV2Hook",
              ],
            }
          : release,
      ),
    };
    const staticAsDynamic = {
      ...valid,
      releases: valid.releases.map((release) =>
        release.releaseVersion === "classic-v2"
          ? { ...release, dynamicContracts: ["ClassicV2Hook"] }
          : release,
      ),
    };
    const invalidModelReleaseTuple = {
      ...valid,
      releases: valid.releases.map((release) =>
        release.releaseVersion === "classic-v2"
          ? { ...release, model: "stock-paired" }
          : release,
      ),
    };

    expect(() => parseDataPipelineReleaseBinding(orphaned)).toThrow(
      "Invalid data pipeline release binding",
    );
    expect(() => parseDataPipelineReleaseBinding(crossModel)).toThrow(
      "Invalid data pipeline release binding",
    );
    expect(() => parseDataPipelineReleaseBinding(staticAsDynamic)).toThrow(
      "Invalid data pipeline release binding",
    );
    expect(() =>
      parseDataPipelineReleaseBinding(invalidModelReleaseTuple),
    ).toThrow("Invalid data pipeline release binding");
  });
});
