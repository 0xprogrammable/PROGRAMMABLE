import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// @ts-expect-error Operational JavaScript modules intentionally have no declarations.
import * as captureModule from "../../scripts/perf/read-model-capture.mjs";
// @ts-expect-error Operational JavaScript modules intentionally have no declarations.
import * as gateModule from "../../scripts/perf/read-model-gate.mjs";

const {
  captureExploreMatrix,
  commitExploreMatrixPage,
  exploreMatrixCorpusCommitment,
  normalizeExploreMatrixQuery,
  serializeExploreMatrixPages,
} = captureModule;
const {
  evaluateExploreMatrixReleaseEvidence,
  loadExploreMatrixReleaseEvidence,
} = gateModule;

const GIT_HEAD = "a".repeat(40);
const CAPTURE_NONCE = `0x${"12".repeat(32)}`;
const DEPLOYMENT_ID = `dpl_${"A".repeat(24)}`;
const TARGET_URL = new URL("https://programmable-matrix.vercel.app/");
const DATASET_SHA256 = "d".repeat(64);
const RELEASES = [
  "classic-v2",
  "classic-v3",
  "stock-paired-v1",
  "stock-paired-v2",
  "stock-paired-v3",
] as const;
const SNAPSHOT = {
  chainId: 1,
  blockNumber: "25700000",
  blockHash: `0x${"ab".repeat(32)}`,
  confirmations: 12,
};

type MatrixToken = {
  tokenAddress: string;
  name: string;
  symbol: string;
  releaseVersion: string;
};

type MatrixPage = {
  pageCommitment: string;
  startedAtMs: number;
  tokens: MatrixToken[];
  caseId: string;
  sort: string;
  vercelCache: string;
  fallback: boolean | null;
  parity: string;
  checkpointSha256: string;
  [key: string]: unknown;
};

type MatrixCase = {
  caseId: string;
  kind: string;
};

type MatrixManifest = {
  captureNonce: string;
  capturedAt: string;
  target: Record<string, string>;
  dataset: {
    manifestSha256: string;
    inventorySha256: string;
    eligibleLaunchCount: number;
  };
  checkpoint: { snapshotSha256: string };
  matrix: {
    cases: MatrixCase[];
    casesSha256: string;
    caseCounts: Record<string, number>;
    caseCount: number;
    pagesSha256: string;
    pageCount: number;
    tokenObservationCount: number;
    corpusSha256: string;
  };
  [key: string]: unknown;
};

type MatrixBundle = {
  manifest: MatrixManifest;
  pages: MatrixPage[];
  artifacts: {
    exploreMatrixManifest: { sha256: string };
    exploreMatrixPages: { sha256: string };
  };
};

function address(index: number) {
  return `0x${index.toString(16).padStart(40, "0")}`;
}

function transactionHash(index: number) {
  return `0x${index.toString(16).padStart(64, "0")}`;
}

function fixture() {
  const tokens = Array.from({ length: 265 }, (_, index) => ({
    tokenAddress: address(index + 1),
    name: `Matrix Alpha ${String(index + 1).padStart(3, "0")}`,
    symbol: `MX${String(index + 1).padStart(3, "0")}`,
    releaseVersion: RELEASES[index % RELEASES.length]!,
  }));
  const eligibleLaunches = tokens.map((token, index) => ({
    account: address(index + 1_000),
    transactionHash: transactionHash(index + 1),
    tokenAddress: token.tokenAddress,
    releaseVersion: token.releaseVersion,
  }));
  const releaseCounts = Object.fromEntries(
    RELEASES.map((releaseVersion) => [
      releaseVersion,
      eligibleLaunches.filter(
        (launch) => launch.releaseVersion === releaseVersion,
      ).length,
    ]),
  );
  const datasetManifest = {
    generatedAt: "2026-08-01T08:00:00.000Z",
    eligibleLaunches,
    releaseCounts,
  };
  let clock = 1_800_000_000_000;
  const now = () => clock++;
  const fetchImpl = async (request: URL | RequestInfo) => {
    const url = new URL(
      request instanceof URL
        ? request.toString()
        : typeof request === "string"
          ? request
          : request.url,
    );
    const query = url.searchParams.get("q") ?? "";
    const normalizedQuery = normalizeExploreMatrixQuery(query);
    const sort = url.searchParams.get("sort") ?? "market-cap";
    const pageSize = Number(url.searchParams.get("limit"));
    const requestedPage = Number(url.searchParams.get("page"));
    const filtered = tokens.filter(
      (token) =>
        normalizedQuery === "" ||
        token.name.toLowerCase().includes(normalizedQuery) ||
        token.symbol.toLowerCase().includes(normalizedQuery) ||
        token.tokenAddress.includes(normalizedQuery),
    );
    const ordered = ["newest", "market-cap"].includes(sort)
      ? [...filtered].reverse()
      : [...filtered];
    const totalPages = Math.ceil(ordered.length / pageSize);
    const resolvedPage =
      totalPages === 0 ? 1 : Math.min(requestedPage, totalPages);
    const offset = (resolvedPage - 1) * pageSize;
    const body = {
      status: "ready",
      tokens: ordered.slice(offset, offset + pageSize),
      page: resolvedPage,
      pageSize,
      total: ordered.length,
      totalPages,
      sort,
      query: query.trim(),
      snapshot: SNAPSHOT,
      launcherFeesAccruedWei: "0",
      launcherFeesAccruedEth: "0",
    };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        "cache-control": "private, no-store",
        "x-vercel-cache": "BYPASS",
        "x-programmable-shadow-overhead-ms": "1",
        "x-programmable-shadow-parity": "match",
        "x-programmable-read-source": "indexed",
        "x-programmable-live-fallback": "false",
      },
    });
  };
  return { tokens, datasetManifest, now, fetchImpl };
}

function sha256Bytes(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

async function acceptedBundle() {
  const source = fixture();
  const captured = (await captureExploreMatrix({
    targetUrl: TARGET_URL,
    deploymentId: DEPLOYMENT_ID,
    profileId: "read-model-release-v1",
    gitHead: GIT_HEAD,
    captureNonce: CAPTURE_NONCE,
    shadowProbeToken: "shadow-probe-secret-that-is-32-bytes",
    probeTimeoutMs: 30_000,
    concurrency: 20,
    datasetManifest: source.datasetManifest,
    datasetManifestSha256: DATASET_SHA256,
    fetchImpl: source.fetchImpl,
    now: source.now,
  })) as { manifest: MatrixManifest; pages: MatrixPage[] };
  const matrixBundle: MatrixBundle = {
    manifest: structuredClone(captured.manifest),
    pages: structuredClone(captured.pages),
    artifacts: {
      exploreMatrixManifest: {
        sha256: sha256Bytes(
          `${JSON.stringify(captured.manifest, null, 2)}\n`,
        ),
      },
      exploreMatrixPages: { sha256: captured.manifest.matrix.pagesSha256 },
    },
  };
  const releaseCapturedAt = new Date(
    Date.parse(captured.manifest.capturedAt) + 1,
  ).toISOString();
  const releaseBundle = {
    evidence: {
      profileId: "read-model-release-v1",
      captureNonce: CAPTURE_NONCE,
      capturedAt: releaseCapturedAt,
      target: {
        url: TARGET_URL.toString(),
        vercelDeploymentId: DEPLOYMENT_ID,
        gitHead: GIT_HEAD,
      },
    },
    datasetManifest: source.datasetManifest,
    artifacts: { datasetManifest: { sha256: DATASET_SHA256 } },
    httpSamples: [
      { completedAtMs: Math.min(...captured.pages.map((page) => page.startedAtMs)) - 1 },
    ],
  };
  return { matrixBundle, releaseBundle };
}

function rebindMatrix(bundle: MatrixBundle) {
  bundle.pages.forEach((page) => {
    page.pageCommitment = commitExploreMatrixPage(page);
  });
  const pagesBytes = serializeExploreMatrixPages(bundle.pages);
  const pagesSha256 = sha256Bytes(pagesBytes);
  const tokenObservationCount = bundle.pages.reduce(
    (total, page) => total + page.tokens.length,
    0,
  );
  bundle.manifest.matrix.pagesSha256 = pagesSha256;
  bundle.manifest.matrix.pageCount = bundle.pages.length;
  bundle.manifest.matrix.tokenObservationCount = tokenObservationCount;
  bundle.manifest.matrix.corpusSha256 = exploreMatrixCorpusCommitment({
    captureNonce: bundle.manifest.captureNonce,
    target: bundle.manifest.target,
    datasetManifestSha256: bundle.manifest.dataset.manifestSha256,
    inventorySha256: bundle.manifest.dataset.inventorySha256,
    casesSha256: bundle.manifest.matrix.casesSha256,
    pagesSha256,
    checkpointSha256: bundle.manifest.checkpoint.snapshotSha256,
    eligibleLaunchCount: bundle.manifest.dataset.eligibleLaunchCount,
    caseCount: bundle.manifest.matrix.caseCount,
    pageCount: bundle.manifest.matrix.pageCount,
    tokenObservationCount,
  });
  bundle.artifacts.exploreMatrixPages.sha256 = pagesSha256;
  bundle.artifacts.exploreMatrixManifest.sha256 = sha256Bytes(
    `${JSON.stringify(bundle.manifest, null, 2)}\n`,
  );
}

describe("complete aggregate Explore activation matrix", () => {
  it("accepts all real pages, clamps, four sorts and real bounded queries for all releases", async () => {
    const { matrixBundle, releaseBundle } = await acceptedBundle();

    const result = evaluateExploreMatrixReleaseEvidence(
      matrixBundle,
      releaseBundle,
    );

    expect(result.releaseEvidenceAccepted).toBe(true);
    expect(result.failures).toEqual([]);
    expect(matrixBundle.manifest.matrix.caseCounts).toMatchObject({
      empty: 1,
      name: 8,
      symbol: 8,
      address: 8,
    });
    expect(matrixBundle.manifest.matrix.pageCount).toBe(376);
    expect(
      result.checks.find(
        (check: { id: string }) =>
          check.id === "explore-matrix-page-and-cursor-coverage",
      )?.status,
    ).toBe("pass");
    for (const releaseVersion of RELEASES) {
      for (const sort of [
        "newest",
        "oldest",
        "market-cap",
        "market-cap-asc",
      ]) {
        expect(
          result.checks.find(
            (check: { id: string }) =>
              check.id ===
              `explore-matrix-release-${releaseVersion}-${sort}`,
          )?.status,
        ).toBe("pass");
      }
    }
  });

  it("loads the fixed manifest and JSONL page sidecars and fails if either is missing", async () => {
    const { matrixBundle } = await acceptedBundle();
    const directory = mkdtempSync(join(tmpdir(), "programmable-explore-matrix-"));
    const evidencePath = join(directory, "read-model-release-evidence.v1.json");
    try {
      writeFileSync(
        join(directory, "explore-matrix-evidence.v1.json"),
        `${JSON.stringify(matrixBundle.manifest, null, 2)}\n`,
      );
      writeFileSync(
        join(directory, "explore-matrix-pages.v1.jsonl"),
        serializeExploreMatrixPages(matrixBundle.pages),
      );

      const loaded = loadExploreMatrixReleaseEvidence({ evidencePath });
      expect(loaded.pages).toHaveLength(matrixBundle.pages.length);
      expect(loaded.manifest.matrix.corpusSha256).toBe(
        matrixBundle.manifest.matrix.corpusSha256,
      );

      rmSync(join(directory, "explore-matrix-pages.v1.jsonl"));
      expect(() =>
        loadExploreMatrixReleaseEvidence({ evidencePath }),
      ).toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ["cache", "explore-matrix-cache"],
    ["fallback", "explore-matrix-fallback"],
    ["parity", "explore-matrix-parity"],
    ["checkpoint", "explore-matrix-checkpoint-binding"],
    ["missing-case", "explore-matrix-case-coverage"],
  ] as const)("rejects %s evidence", async (mutation, expectedFailure) => {
    const { matrixBundle, releaseBundle } = await acceptedBundle();
    if (mutation === "cache") matrixBundle.pages[0]!.vercelCache = "HIT";
    if (mutation === "fallback") matrixBundle.pages[0]!.fallback = true;
    if (mutation === "parity") matrixBundle.pages[0]!.parity = "mismatch";
    if (mutation === "checkpoint") {
      matrixBundle.pages[0]!.checkpointSha256 = "f".repeat(64);
    }
    if (mutation === "missing-case") {
      const removedCase = matrixBundle.manifest.matrix.cases.find(
        (queryCase) => queryCase.kind === "address",
      )!;
      matrixBundle.pages = matrixBundle.pages.filter(
        (page) =>
          !(page.caseId === removedCase.caseId && page.sort === "newest"),
      );
    }
    rebindMatrix(matrixBundle);

    const result = evaluateExploreMatrixReleaseEvidence(
      matrixBundle,
      releaseBundle,
    );

    expect(result.releaseEvidenceAccepted).toBe(false);
    expect(
      result.failures.map((failure: { id: string }) => failure.id),
    ).toContain(expectedFailure);
  });

  it("rejects pages whose digest is not the committed matrix artifact", async () => {
    const { matrixBundle, releaseBundle } = await acceptedBundle();
    matrixBundle.artifacts.exploreMatrixPages.sha256 = "e".repeat(64);

    const result = evaluateExploreMatrixReleaseEvidence(
      matrixBundle,
      releaseBundle,
    );

    expect(result.releaseEvidenceAccepted).toBe(false);
    expect(
      result.failures.map((failure: { id: string }) => failure.id),
    ).toContain("explore-matrix-page-digest");
  });
});
