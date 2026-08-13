import { createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// @ts-expect-error Operational JavaScript modules intentionally have no declarations.
import * as deployPolicy from "../../scripts/perf/read-model-deploy-policy.mjs";
// @ts-expect-error Operational JavaScript modules intentionally have no declarations.
import * as gateCore from "../../scripts/perf/read-model-gate-core.mjs";
// @ts-expect-error Operational JavaScript modules intentionally have no declarations.
import * as evidenceCommitment from "../../scripts/perf/read-model-evidence-commitment.mjs";
// @ts-expect-error Operational JavaScript modules intentionally have no declarations.
import * as liveVerifier from "../../scripts/perf/read-model-live-verifier.mjs";
// @ts-expect-error Operational JavaScript modules intentionally have no declarations.
import * as providerBinding from "../../scripts/perf/read-model-provider-binding.mjs";
// @ts-expect-error Operational JavaScript modules intentionally have no declarations.
import * as releaseProbe from "../../scripts/perf/read-model-release-probe.mjs";
// @ts-expect-error Operational JavaScript modules intentionally have no declarations.
import * as sourceContracts from "../../scripts/perf/read-model-source-contracts.mjs";
// @ts-expect-error Operational JavaScript modules intentionally have no declarations.
import * as alchemySourceContracts from "../../scripts/perf/alchemy-explore-source-contracts.mjs";

const temporaryDirectories: string[] = [];
const GIT_HEAD = "1".repeat(40);
const DEPLOYMENT_ID = `dpl_${"A".repeat(24)}`;
const TARGET_URL = "https://programmable-perf-abc.vercel.app/";
const RUNTIME_CAPTURE_PATH_FIXTURE =
  "/api/ops/read-model-performance-capture";
const CAPTURE_NONCE = `0x${"55".repeat(32)}`;
const RUNTIME_RPC_ENVIRONMENT = {
  PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL:
    "https://eth-mainnet.g.alchemy.com/v2/abcdefgh",
  PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL:
    "https://programmable.quiknode.pro/abcdefgh",
};
const RUNTIME_PROVIDER_BINDINGS =
  providerBinding.runtimeProductionProviderBindingsFromUrls(
    RUNTIME_RPC_ENVIRONMENT,
  );
const ENDPOINT_COMMITMENTS = Object.fromEntries(
  RUNTIME_PROVIDER_BINDINGS.map(
    (binding: { vendorGroup: string; endpointCommitment: string }) => [
      binding.vendorGroup,
      binding.endpointCommitment,
    ],
  ),
);
const ORIGIN_COMMITMENTS = {
  alchemy: `0x${"aa".repeat(32)}`,
  quicknode: `0x${"bb".repeat(32)}`,
};

type MutableHttpSample = {
  route: string;
  datasetKey: string;
  startedAtMs: number;
  completedAtMs: number;
  durationMs: number;
  status: number;
};

function readJson(path: string) {
  return JSON.parse(readFileSync(resolve(process.cwd(), path), "utf8"));
}

function profileFixture(release = false) {
  return readJson(
    release
      ? "config/read-model-release-profile.v1.json"
      : "config/read-model-load-profile.v1.json",
  );
}

function expectedProviders() {
  return ["alchemy", "quicknode"].map((vendorGroup) => {
    const endpointCommitment =
      ENDPOINT_COMMITMENTS[vendorGroup as keyof typeof ENDPOINT_COMMITMENTS];
    return {
      vendorGroup,
      endpointCommitment,
      identity: `${vendorGroup}-mainnet-${endpointCommitment.slice(2, 34)}`,
    };
  });
}

function candidateFixture(index: number) {
  const candidateBlockNumber = (20_000_000 + index).toString();
  const candidateBlockHash = `0x${(10_000 + index)
    .toString(16)
    .padStart(64, "0")}`;
  const transactionHash = `0x${(20_000 + index)
    .toString(16)
    .padStart(64, "0")}`;
  return {
    candidateId: `1:${candidateBlockHash}:${transactionHash}:${index}`,
    candidateBlockNumber,
    candidateBlockHash,
    transactionHash,
    sourceAddress: `0x${(30_000 + index)
      .toString(16)
      .padStart(40, "0")}`,
  };
}

function rawRpcTrace(
  capturedAtMs: number,
  profile = profileFixture(),
) {
  const candidateCount = profile.datasetCoverage.candidateSampleCount;
  const elapsedMs = candidateCount === 32 ? 300 : 100;
  const candidateEvidence = Array.from(
    { length: candidateCount },
    (_, index) => candidateFixture(index + 1),
  );
  const calls = expectedProviders().flatMap((provider) => {
    const operations = [
      "getChainId",
      "getBlockNumber",
      ...Array.from({ length: candidateCount + 1 }, () => "getBlock"),
      ...Array.from({ length: candidateCount }, () => "getTransactionReceipt"),
      ...Array.from({ length: candidateCount }, () => "getBytecode"),
    ];
    return operations.map((operation, index) => ({
      providerIdentity: provider.identity,
      providerVendorGroup: provider.vendorGroup,
      providerEndpointCommitment: provider.endpointCommitment,
      providerOriginCommitment:
        ORIGIN_COMMITMENTS[
          provider.vendorGroup as keyof typeof ORIGIN_COMMITMENTS
        ],
      operation,
      attempt: 1,
      startedOffsetMs: index * 2,
      durationMs: 1,
      outcome: "success",
    }));
  });
  return {
    schemaVersion: 1,
    profileId: profile.profileId,
    gitHead: GIT_HEAD,
    targetUrl: TARGET_URL,
    vercelDeploymentId: DEPLOYMENT_ID,
    captureNonce: CAPTURE_NONCE,
    startedAtMs: capturedAtMs - 125_000,
    completedAtMs: capturedAtMs - 125_000 + elapsedMs,
    candidateBatchSize: candidateCount,
    hardDeadlineMs: 75_000,
    maxCallsPerProvider: profile.projector.rpc.maxCallsPerProviderPerRun,
    elapsedMs,
    providerCallCounts: [3 + candidateCount * 3, 3 + candidateCount * 3],
    candidateEvidence,
    calls,
  };
}

function rawHttpSamples(
  profile: ReturnType<typeof profileFixture>,
  keys: {
    tokenAddresses: string[];
    accountAddresses: string[];
    classicLaunches: { account: string; transactionHash: string }[];
    stockLaunches: { account: string; transactionHash: string }[];
  },
  eligibleLaunches: {
    account: string;
    transactionHash: string;
    tokenAddress: string;
    releaseVersion: string;
  }[],
  capturedAtMs: number,
) {
  const routes = (Object.entries(profile.load.routeMixBps) as [string, number][]).flatMap(
    ([route, basisPoints]) =>
      Array.from({ length: basisPoints / 10 }, () => route),
  );
  const base = capturedAtMs - 120_000;
  const classIndexes = new Map([
    ["token", 0],
    ["account", 0],
    ["classic", 0],
    ["stock", 0],
  ]);
  const distributed = <T>(values: T[], sequence: number) =>
    values[sequence % values.length];
  return routes.map((route, index) => {
    const wave = Math.floor(index / profile.load.concurrency);
    const startedAtMs = base + wave * 1_225;
    const durationMs = 100;
    const shadow = profile.shadow.requiredRoutes.includes(route);
    const keyClass =
      route === "classicLaunchLookup"
        ? "classic"
        : route === "stockLaunchLookup"
          ? "stock"
          : ["creatorProfile", "classicProfile", "stockProfile"].includes(route)
            ? "account"
            : route === "health"
              ? undefined
              : "token";
    const classIndex = keyClass === undefined ? 0 : classIndexes.get(keyClass)!;
    if (keyClass !== undefined) classIndexes.set(keyClass, classIndex + 1);
    return {
      route,
      requestKey: `${route}-${index}`,
      datasetKey:
        route === "health"
          ? "health"
          : route === "classicLaunchLookup"
            ? distributed(keys.classicLaunches, classIndex)!.transactionHash
            : route === "stockLaunchLookup"
              ? distributed(keys.stockLaunches, classIndex)!.transactionHash
              : ["creatorProfile", "classicProfile", "stockProfile"].includes(route)
                ? distributed(keys.accountAddresses, classIndex)
                : distributed(keys.tokenAddresses, classIndex),
      keyMatched: true,
      startedAtMs,
      completedAtMs: startedAtMs + durationMs,
      durationMs,
      status: 200,
      cacheControl:
        profile.shadow.requiredRoutes.includes(route)
          ? profile.load.probeCacheControl
          : profile.cacheContracts[route],
      vercelCache: "MISS",
      bodySha256: "3".repeat(64),
      bodyBytes: 128,
      shadowOverheadMs: shadow ? 5 : null,
      parity: shadow ? "match" : "not-observed",
      readSource: shadow ? "rpc" : "not-observed",
      fallback: shadow ? false : null,
    };
  });
}

function createBundle(release = false) {
  const directory = mkdtempSync(join(tmpdir(), "read-model-gate-"));
  temporaryDirectories.push(directory);
  const profile = profileFixture(release);
  const capturedAtMs = Date.now();
  const address = (value: number) =>
    `0x${value.toString(16).padStart(40, "0")}`;
  const launchCount = release ? 264 : 260;
  const classicEnd = release ? 212 : 208;
  const stockV1End = classicEnd + 1;
  const stockV2End = stockV1End + 8;
  const eligibleLaunches = Array.from({ length: launchCount }, (_, index) => {
    const releaseVersion =
      index < 27
        ? "classic-v2"
        : index < classicEnd
          ? "classic-v3"
          : index < stockV1End
            ? "stock-paired-v1"
            : index < stockV2End
              ? "stock-paired-v2"
              : "stock-paired-v3";
    return {
      account: address((index % 100) + 1_001),
      transactionHash: `0x${(index + 1).toString(16).padStart(64, "0")}`,
      tokenAddress: address(index + 1),
      releaseVersion,
    };
  });
  const eligibleClassicLaunches = eligibleLaunches.filter((launch) =>
    launch.releaseVersion === "classic-v3",
  );
  const eligibleStockLaunches = eligibleLaunches.filter((launch) =>
    launch.releaseVersion.startsWith("stock-paired-"),
  );
  const keys = {
    tokenAddresses: Array.from(
      { length: profile.datasetCoverage.tokenSampleCount },
      (_, index) => address(index + 1),
    ),
    accountAddresses: Array.from(
      { length: 100 },
      (_, index) => address(index + 1_001),
    ),
    classicLaunches: eligibleClassicLaunches
      .slice(0, 32)
      .map(({ account, transactionHash }) => ({ account, transactionHash })),
    stockLaunches: eligibleStockLaunches
      .slice(0, 32)
      .map(({ account, transactionHash }) => ({ account, transactionHash })),
    candidateIds: Array.from(
      { length: profile.datasetCoverage.candidateSampleCount },
      (_, index) => candidateFixture(index + 1).candidateId,
    ),
  };
  const datasetManifest = {
    schemaVersion: 1,
    profileId: profile.profileId,
    generatedAt: new Date(capturedAtMs - 130_000).toISOString(),
    counts: {
      launches: launchCount,
      chainEvents: launchCount * 3,
      marketSnapshots: launchCount,
      marketCandles: launchCount,
      accounts: 100,
      rewardRows: launchCount,
    },
    releaseCounts: {
      "classic-v2": 27,
      "classic-v3": release ? 185 : 181,
      "stock-paired-v1": 1,
      "stock-paired-v2": 8,
      "stock-paired-v3": 43,
    },
    eligibleLaunches,
    accountEvidence: keys.accountAddresses.map((account) => ({
      account,
      profileRows: 1,
      rewardRows: 0,
    })),
    accessEvidence: {
      projectorSessionUser: "programmable_projector_login",
      projectorCurrentRole: "programmable_projector",
      projectorCurrentSettingRole: "programmable_projector",
      apiReaderSessionUser: "programmable_api_reader_login",
      apiReaderCurrentRole: "programmable_api_reader",
      apiReaderCurrentSettingRole: "programmable_api_reader",
      apiReaderDeniedSqlstate: "42501",
      apiReaderFunctionExecute: false,
      apiReaderViewSelect: false,
    },
    keys,
  };
  const files = {
    datasetManifest: "dataset-manifest.v1.json",
    httpSamples: "http-samples.v1.jsonl",
    rpcTrace: "rpc-trace.v1.json",
  };
  const contents = {
    datasetManifest: `${JSON.stringify(datasetManifest)}\n`,
    httpSamples: `${rawHttpSamples(profile, keys, eligibleLaunches, capturedAtMs)
      .map((sample) => JSON.stringify(sample))
      .join("\n")}\n`,
    rpcTrace: `${JSON.stringify(rawRpcTrace(capturedAtMs, profile))}\n`,
  };
  for (const key of Object.keys(files) as (keyof typeof files)[]) {
    writeFileSync(join(directory, files[key]), contents[key]);
  }
  const evidence = evidenceCommitment.commitReadModelReleaseEvidence({
    schemaVersion: 1,
    profileId: profile.profileId,
    evidenceKind: "production-canary",
    capturedAt: new Date(capturedAtMs).toISOString(),
    captureNonce: CAPTURE_NONCE,
    target: {
      url: TARGET_URL,
      vercelDeploymentId: DEPLOYMENT_ID,
      gitHead: GIT_HEAD,
    },
    artifacts: Object.fromEntries(
      (Object.keys(files) as (keyof typeof files)[]).map((key) => [
        key,
        {
          file: files[key],
          sha256: gateCore.sha256Bytes(Buffer.from(contents[key])),
        },
      ]),
    ),
  });
  const evidencePath = join(
    directory,
    "read-model-release-evidence.v1.json",
  );
  writeFileSync(evidencePath, `${JSON.stringify(evidence)}\n`);
  return {
    directory,
    evidencePath,
    profile,
    evidence,
    datasetManifest,
  };
}

function rewriteDatasetManifest(fixture: ReturnType<typeof createBundle>) {
  const contents = `${JSON.stringify(fixture.datasetManifest)}\n`;
  writeFileSync(join(fixture.directory, "dataset-manifest.v1.json"), contents);
  fixture.evidence.artifacts.datasetManifest.sha256 = gateCore.sha256Bytes(
    Buffer.from(contents),
  );
  fixture.evidence.evidenceSha256 =
    evidenceCommitment.readModelReleaseEvidenceCommitment(fixture.evidence);
  writeFileSync(fixture.evidencePath, `${JSON.stringify(fixture.evidence)}\n`);
}

function rewriteHttpSamples(
  fixture: ReturnType<typeof createBundle>,
  samples: Record<string, unknown>[],
) {
  const contents = `${samples.map((sample) => JSON.stringify(sample)).join("\n")}\n`;
  writeFileSync(join(fixture.directory, "http-samples.v1.jsonl"), contents);
  fixture.evidence.artifacts.httpSamples.sha256 = gateCore.sha256Bytes(
    Buffer.from(contents),
  );
  fixture.evidence.evidenceSha256 =
    evidenceCommitment.readModelReleaseEvidenceCommitment(fixture.evidence);
  writeFileSync(fixture.evidencePath, `${JSON.stringify(fixture.evidence)}\n`);
}

function loadBundle(evidencePath: string, release = false) {
  return gateCore.loadReadModelReleaseEvidence({
    profile: profileFixture(release),
    evidencePath,
  });
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

describe("read-model performance contract", () => {
  it("reports safe HTTP metadata when the staged runtime capture is rejected", () => {
    const directory = mkdtempSync(join(tmpdir(), "read-model-capture-rejection-"));
    temporaryDirectories.push(directory);
    const fetchFixturePath = join(directory, "rejected-fetch.mjs");
    writeFileSync(
      fetchFixturePath,
      `globalThis.fetch = async () => new Response(JSON.stringify({ error: "private runtime detail" }), {\n` +
        `  status: 503,\n` +
        `  headers: {\n` +
        `    "cache-control": "private, no-store",\n` +
        `    "content-type": "application/json",\n` +
        `    "x-vercel-error": "FUNCTION_INVOCATION_FAILED",\n` +
        `  },\n` +
        `});\n`,
      { mode: 0o600 },
    );

    const result = spawnSync(
      process.execPath,
      [
        resolve(process.cwd(), "scripts/perf/read-model-capture.mjs"),
        "--target-url",
        TARGET_URL,
        "--deployment-id",
        DEPLOYMENT_ID,
        "--output-directory",
        directory,
        "--kind",
        "production-canary",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_OPTIONS: `--import=${pathToFileURL(fetchFixturePath).href}`,
          PROGRAMMABLE_PERFORMANCE_PROBE_TOKEN: "p".repeat(32),
          PROGRAMMABLE_SHADOW_PROBE_TOKEN: "s".repeat(32),
          VERCEL_AUTOMATION_BYPASS_SECRET: "b".repeat(32),
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("status=503");
    expect(result.stderr).toContain("vercelError=FUNCTION_INVOCATION_FAILED");
    expect(result.stderr).not.toContain("private runtime detail");
  });

  it("signs route-bound release probes without sending the server secret", () => {
    const secret = "s".repeat(32);
    const nonce = `1700000000000-${"55".repeat(32)}-7`;
    const expected = createHmac("sha256", secret)
      .update(`programmable-release-probe-v1\nexplore-token\n${nonce}`, "utf8")
      .digest("hex");
    expect(
      releaseProbe.signReadModelReleaseProbe({
        route: "tokenDetail",
        nonce,
        secret,
      }),
    ).toBe(expected);
    expect(
      releaseProbe.buildReadModelReleaseProbe({
        route: "tokenDetail",
        issuedAtMs: 1_700_000_000_000,
        captureNonce: CAPTURE_NONCE,
        sequence: 7,
        secret,
      }),
    ).toEqual({ nonce, signature: expected });
    expect(
      Object.fromEntries(
        [
          "exploreList",
          "tokenDetail",
          "tokenChart",
          "creatorProfile",
          "classicProfile",
          "stockProfile",
          "classicLaunchLookup",
          "stockLaunchLookup",
        ].map((route) => [
          route,
          releaseProbe.indexedRouteForPerformanceRoute(route),
        ]),
      ),
    ).toEqual({
      exploreList: "explore-list",
      tokenDetail: "explore-token",
      tokenChart: "explore-chart",
      creatorProfile: "creator-profile",
      classicProfile: "classic-v3-profile",
      stockProfile: "creator-profile",
      classicLaunchLookup: "launch-lookup",
      stockLaunchLookup: "launch-lookup",
    });
    expect(() =>
      releaseProbe.signReadModelReleaseProbe({
        route: "publicIndexer",
        nonce,
        secret,
      }),
    ).toThrow("no indexed release-probe binding");
    expect(() =>
      releaseProbe.signReadModelReleaseProbe({
        route: "tokenDetail",
        nonce,
        secret: "too-short",
      }),
    ).toThrow("secret is invalid");
  });

  it("pins the executable deadline and exact retry mathematics", () => {
    const profile = gateCore.parseReadModelLoadProfile(profileFixture());
    expect(profile.projector.hardDeadlineMs).toBe(75_000);
    expect(profile.projector.hostingDeadlineMs).toBe(90_000);
    expect(gateCore.projectorCallsPerProviderPerAttempt(profile, 8)).toBe(27);
    expect(gateCore.projectorWorstCaseRetryContract(profile, 8)).toEqual({
      callsPerProvider: 81,
      durationMs: 121_200,
    });
  });

  it("gates the 32-candidate release ceiling against the full 264-launch corpus", () => {
    const profile = gateCore.parseReadModelLoadProfile(profileFixture(true));
    expect(profile.projector).toMatchObject({
      smokeCandidateBatchSize: 8,
      maximumCandidateBatchSize: 32,
      hardDeadlineMs: 75_000,
    });
    expect(gateCore.projectorCallsPerProviderPerAttempt(profile, 32)).toBe(99);
    expect(profile.projector.rpc).toMatchObject({
      maxCallsPerProviderPerRun: 128,
      maxAggregateCallsPerRun: 256,
    });
    expect(
      sourceContracts
        .evaluateReadModelSourceContracts(process.cwd(), profile)
        .failures.map((failure: { id: string }) => failure.id),
    ).toEqual([
      "source-cache-exploreList",
      "source-cache-tokenDetail",
      "source-cache-tokenChart",
      "source-cache-tokenList",
      "source-cache-publicIndexer",
    ]);

    const fixture = createBundle(true);
    const result = gateCore.evaluateReadModelReleaseEvidence(
      loadBundle(fixture.evidencePath, true),
      { gitHead: GIT_HEAD, expectedProviders: expectedProviders() },
    );
    expect(result.failures).toEqual([]);
    expect(result.releaseEvidenceAccepted).toBe(true);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "release-corpus-cycles",
          status: "pass",
        }),
        expect.objectContaining({
          id: "projector-runtime-policy",
          status: "pass",
        }),
        expect.objectContaining({
          id: "rpc-provider-trace",
          status: "pass",
        }),
      ]),
    );
  });

  it("accepts only digested raw evidence bound to the exact release", () => {
    const fixture = createBundle();
    const bundle = loadBundle(fixture.evidencePath);
    const result = gateCore.evaluateReadModelReleaseEvidence(bundle, {
      gitHead: GIT_HEAD,
      expectedProviders: expectedProviders(),
    });
    expect(result.releaseEvidenceAccepted).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "dataset-cardinality", status: "pass" }),
        expect.objectContaining({
          id: "deterministic-real-samples",
          status: "pass",
        }),
        expect.objectContaining({ id: "projector-only-corpus", status: "pass" }),
        expect.objectContaining({
          id: "throughput-key-distribution",
          status: "pass",
        }),
      ]),
    );
    expect(result.artifactDigests).toEqual(
      expect.objectContaining({
        datasetManifest: expect.stringMatching(/^[0-9a-f]{64}$/u),
        httpSamples: expect.stringMatching(/^[0-9a-f]{64}$/u),
        rpcTrace: expect.stringMatching(/^[0-9a-f]{64}$/u),
      }),
    );
  });

  it("rejects missing and stale release bundle commitments", () => {
    const missing = createBundle();
    const uncommitted = structuredClone(missing.evidence);
    Reflect.deleteProperty(uncommitted, "evidenceSha256");
    writeFileSync(missing.evidencePath, `${JSON.stringify(uncommitted)}\n`);
    expect(() => loadBundle(missing.evidencePath)).toThrow(
      "expected exactly",
    );

    const stale = createBundle();
    stale.evidence.target.gitHead = "9".repeat(40);
    writeFileSync(stale.evidencePath, `${JSON.stringify(stale.evidence)}\n`);
    expect(() => loadBundle(stale.evidencePath)).toThrow(
      "commitment is invalid",
    );
  });

  it("keeps full launch cardinality separate from the repeated load corpus", () => {
    const fixture = createBundle();
    expect(fixture.datasetManifest.eligibleLaunches).toHaveLength(260);
    expect(fixture.datasetManifest.keys).toMatchObject({
      tokenAddresses: expect.arrayContaining([
        fixture.datasetManifest.keys.tokenAddresses[0],
      ]),
      accountAddresses: expect.any(Array),
      classicLaunches: expect.any(Array),
      stockLaunches: expect.any(Array),
    });
    expect(fixture.datasetManifest.keys.tokenAddresses).toHaveLength(100);
    expect(fixture.datasetManifest.keys.accountAddresses).toHaveLength(100);
    expect(fixture.datasetManifest.keys.classicLaunches).toHaveLength(32);
    expect(fixture.datasetManifest.keys.stockLaunches).toHaveLength(32);
    const result = gateCore.evaluateReadModelReleaseEvidence(
      loadBundle(fixture.evidencePath),
      { gitHead: GIT_HEAD, expectedProviders: expectedProviders() },
    );
    expect(result.releaseEvidenceAccepted).toBe(true);
  });

  it("rejects undersized cardinality without inflating the throughput samples", () => {
    const fixture = createBundle();
    fixture.datasetManifest.eligibleLaunches =
      fixture.datasetManifest.eligibleLaunches.filter(
        (_, index) => index < 147 || index >= 208,
      );
    fixture.datasetManifest.counts.launches = 199;
    fixture.datasetManifest.counts.chainEvents = 597;
    fixture.datasetManifest.counts.marketSnapshots = 199;
    fixture.datasetManifest.counts.marketCandles = 199;
    fixture.datasetManifest.counts.rewardRows = 199;
    fixture.datasetManifest.releaseCounts["classic-v3"] = 120;
    rewriteDatasetManifest(fixture);
    const result = gateCore.evaluateReadModelReleaseEvidence(
      loadBundle(fixture.evidencePath),
      { gitHead: GIT_HEAD, expectedProviders: expectedProviders() },
    );
    expect(result.failures).toContainEqual(
      expect.objectContaining({ id: "dataset-cardinality" }),
    );
  });

  it("rejects padded, synthetic and privilege-escalated corpus manifests", () => {
    const duplicate = createBundle();
    duplicate.datasetManifest.keys.tokenAddresses[1] =
      duplicate.datasetManifest.keys.tokenAddresses[0];
    rewriteDatasetManifest(duplicate);
    expect(() => loadBundle(duplicate.evidencePath)).toThrow(
      "addresses must be unique",
    );

    const synthetic = createBundle();
    synthetic.datasetManifest.keys.tokenAddresses[0] = `0x${"ff".repeat(20)}`;
    rewriteDatasetManifest(synthetic);
    expect(() => loadBundle(synthetic.evidencePath)).toThrow(
      "contains a non-eligible token",
    );

    const unevidencedAccount = createBundle();
    unevidencedAccount.datasetManifest.accountEvidence[0].profileRows = 0;
    unevidencedAccount.datasetManifest.accountEvidence[0].rewardRows = 0;
    rewriteDatasetManifest(unevidencedAccount);
    expect(() => loadBundle(unevidencedAccount.evidencePath)).toThrow(
      "account must have real profile or reward evidence",
    );

    const readerPrivilege = createBundle();
    readerPrivilege.datasetManifest.accessEvidence.apiReaderFunctionExecute = true;
    rewriteDatasetManifest(readerPrivilege);
    expect(() => loadBundle(readerPrivilege.evidencePath)).toThrow(
      "must prove projector-only corpus access",
    );

    const missingRelease = createBundle();
    missingRelease.datasetManifest.releaseCounts["stock-paired-v1"] = 0;
    rewriteDatasetManifest(missingRelease);
    expect(() => loadBundle(missingRelease.evidencePath)).toThrow(
      "greater than or equal to 1",
    );
  });

  it("fails closed on incomparable parity and absent or true fallback evidence", () => {
    const incomparable = loadBundle(createBundle().evidencePath);
    incomparable.httpSamples[0].parity = "incomparable";
    const incomparableResult = gateCore.evaluateReadModelReleaseEvidence(
      incomparable,
      { gitHead: GIT_HEAD, expectedProviders: expectedProviders() },
    );
    expect(incomparableResult.failures).toContainEqual(
      expect.objectContaining({ id: "shadow-parity" }),
    );

    const fallback = loadBundle(createBundle().evidencePath);
    fallback.httpSamples[0].fallback = true;
    const fallbackResult = gateCore.evaluateReadModelReleaseEvidence(fallback, {
      gitHead: GIT_HEAD,
      expectedProviders: expectedProviders(),
    });
    expect(fallbackResult.failures).toContainEqual(
      expect.objectContaining({ id: "live-fallbacks" }),
    );

    const missing = createBundle();
    const samples = readFileSync(
      join(missing.directory, "http-samples.v1.jsonl"),
      "utf8",
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    samples[0].fallback = null;
    rewriteHttpSamples(missing, samples);
    expect(() => loadBundle(missing.evidencePath)).toThrow(
      "missing raw fallback result",
    );
  });

  it("enforces concurrency, key distribution, p95, p99 and zero errors independently", () => {
    const lowConcurrency = loadBundle(createBundle().evidencePath);
    const lowConcurrencyBase = Date.parse(lowConcurrency.evidence.capturedAt) - 120_000;
    lowConcurrency.httpSamples.forEach(
      (sample: MutableHttpSample, index: number) => {
        sample.startedAtMs = lowConcurrencyBase + index * 100;
        sample.completedAtMs = sample.startedAtMs + sample.durationMs;
      },
    );
    expect(
      gateCore.evaluateReadModelReleaseEvidence(lowConcurrency, {
        gitHead: GIT_HEAD,
        expectedProviders: expectedProviders(),
      }).failures,
    ).toContainEqual(expect.objectContaining({ id: "throughput-shape" }));

    const missingKey = loadBundle(createBundle().evidencePath);
    const omittedToken = missingKey.datasetManifest.keys.tokenAddresses[99];
    const replacementToken = missingKey.datasetManifest.keys.tokenAddresses[0];
    missingKey.httpSamples.forEach((sample: MutableHttpSample) => {
      if (sample.datasetKey.toLowerCase() === omittedToken.toLowerCase()) {
        sample.datasetKey = replacementToken;
      }
    });
    expect(
      gateCore.evaluateReadModelReleaseEvidence(missingKey, {
        gitHead: GIT_HEAD,
        expectedProviders: expectedProviders(),
      }).failures,
    ).toContainEqual(
      expect.objectContaining({ id: "throughput-key-distribution" }),
    );

    const p95 = loadBundle(createBundle().evidencePath);
    p95.httpSamples
      .filter((sample: MutableHttpSample) => sample.route === "exploreList")
      .forEach((sample: MutableHttpSample) => {
        sample.durationMs = 805;
        sample.completedAtMs = sample.startedAtMs + sample.durationMs;
      });
    const p95Result = gateCore.evaluateReadModelReleaseEvidence(p95, {
      gitHead: GIT_HEAD,
      expectedProviders: expectedProviders(),
    });
    expect(p95Result.failures).toContainEqual(
      expect.objectContaining({ id: "route-latency-p95-exploreList" }),
    );
    expect(p95Result.failures).not.toContainEqual(
      expect.objectContaining({ id: "route-latency-p99-exploreList" }),
    );

    const p99 = loadBundle(createBundle().evidencePath);
    p99.httpSamples
      .filter((sample: MutableHttpSample) => sample.route === "tokenDetail")
      .slice(0, 2)
      .forEach((sample: MutableHttpSample) => {
        sample.durationMs = 1_605;
        sample.completedAtMs = sample.startedAtMs + sample.durationMs;
      });
    const p99Result = gateCore.evaluateReadModelReleaseEvidence(p99, {
      gitHead: GIT_HEAD,
      expectedProviders: expectedProviders(),
    });
    expect(p99Result.failures).toContainEqual(
      expect.objectContaining({ id: "route-latency-p99-tokenDetail" }),
    );

    const error = loadBundle(createBundle().evidencePath);
    error.httpSamples[0].status = 500;
    expect(
      gateCore.evaluateReadModelReleaseEvidence(error, {
        gitHead: GIT_HEAD,
        expectedProviders: expectedProviders(),
      }).failures,
    ).toContainEqual(expect.objectContaining({ id: "throughput-errors" }));
  });

  it("separates selected-path latency from rollout-direction comparison cost", () => {
    const bundle = loadBundle(createBundle().evidencePath);
    for (const sample of bundle.httpSamples) {
      if (!bundle.profile.shadow.requiredRoutes.includes(sample.route)) continue;
      sample.readSource = "indexed";
      sample.shadowOverheadMs = 5_000;
      sample.durationMs = 5_100;
      sample.completedAtMs = sample.startedAtMs + sample.durationMs;
    }
    const accepted = gateCore.evaluateReadModelReleaseEvidence(bundle, {
      gitHead: GIT_HEAD,
      expectedProviders: expectedProviders(),
    });
    expect(accepted.releaseEvidenceAccepted).toBe(true);

    for (const sample of bundle.httpSamples) {
      if (!bundle.profile.shadow.requiredRoutes.includes(sample.route)) continue;
      sample.shadowOverheadMs = 26_000;
      sample.durationMs = 26_100;
      sample.completedAtMs = sample.startedAtMs + sample.durationMs;
    }
    const rejected = gateCore.evaluateReadModelReleaseEvidence(bundle, {
      gitHead: GIT_HEAD,
      expectedProviders: expectedProviders(),
    });
    expect(rejected.failures).toContainEqual(
      expect.objectContaining({ id: "shadow-overhead" }),
    );
  });

  it("rejects an artifact changed after the manifest was signed", () => {
    const fixture = createBundle();
    writeFileSync(
      join(fixture.directory, "http-samples.v1.jsonl"),
      "{}\n",
    );
    expect(() => loadBundle(fixture.evidencePath)).toThrow(
      "artifact digest mismatch",
    );
  });

  it("rejects stale, parity, fallback and provider-binding regressions", () => {
    const stale = loadBundle(createBundle().evidencePath);
    const staleResult = gateCore.evaluateReadModelReleaseEvidence(stale, {
      gitHead: GIT_HEAD,
      expectedProviders: expectedProviders(),
      nowMs: Date.parse(stale.evidence.capturedAt) + 1_801_000,
    });
    expect(staleResult.failures).toContainEqual(
      expect.objectContaining({ id: "freshness" }),
    );

    const raw = loadBundle(createBundle().evidencePath);
    raw.httpSamples[0].parity = "mismatch";
    raw.httpSamples[1].fallback = true;
    const result = gateCore.evaluateReadModelReleaseEvidence(raw, {
      gitHead: GIT_HEAD,
      expectedProviders: [
        expectedProviders()[0],
        {
          ...expectedProviders()[1],
          endpointCommitment: `0x${"44".repeat(32)}`,
        },
      ],
    });
    expect(result.failures.map((failure: { id: string }) => failure.id)).toEqual(
      expect.arrayContaining([
        "shadow-parity",
        "live-fallbacks",
        "rpc-provider-trace",
      ]),
    );

    const replayed = loadBundle(createBundle().evidencePath);
    const capturedAtMs = Date.parse(replayed.evidence.capturedAt);
    replayed.rpcTrace.startedAtMs = capturedAtMs - 1_900_100;
    replayed.rpcTrace.completedAtMs = capturedAtMs - 1_900_000;
    replayed.httpSamples[0].vercelCache = "HIT";
    const replayedResult = gateCore.evaluateReadModelReleaseEvidence(replayed, {
      gitHead: GIT_HEAD,
      expectedProviders: expectedProviders(),
    });
    expect(
      replayedResult.failures.map((failure: { id: string }) => failure.id),
    ).toEqual(
      expect.arrayContaining([
        "rpc-trace-freshness",
        "throughput-cache-and-identity",
      ]),
    );
  });

  it("enforces the exact Alchemy-only deployment boundary", () => {
    const exactFalse = deployPolicy.RELEASE_GATED_FLAG_NAMES.map(
      (name: string) => `${name}="false"`,
    ).join("\n");
    const bitquerySecret = '\nBITQUERY_OAUTH_TOKEN="[Sensitive]"';
    const alchemy = deployPolicy.evaluateReadModelDeployPolicy(
      `${exactFalse}\nPROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL="${RUNTIME_RPC_ENVIRONMENT.PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL}"${bitquerySecret}`,
      {},
    );
    expect(alchemy).toMatchObject({
      mode: "alchemy-only",
      evidenceRequired: false,
      commitmentsReady: true,
      policyReady: true,
      runtimeProviderBinding: "verified",
    });
    const indexedEnvironment = `${exactFalse.replace(
      "INDEXED_EXPLORE_TOKEN_READS_ENABLED=\"false\"",
      "INDEXED_EXPLORE_TOKEN_READS_ENABLED=\"true\"",
    )}\nPROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL="${RUNTIME_RPC_ENVIRONMENT.PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL}"\nPROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL="${RUNTIME_RPC_ENVIRONMENT.PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL}"${bitquerySecret}`;
    const indexed = deployPolicy.evaluateReadModelDeployPolicy(
      indexedEnvironment,
      {
        PROGRAMMABLE_ALCHEMY_MAINNET_RPC_ENDPOINT_COMMITMENT:
          ENDPOINT_COMMITMENTS.alchemy,
        PROGRAMMABLE_QUICKNODE_MAINNET_RPC_ENDPOINT_COMMITMENT:
          ENDPOINT_COMMITMENTS.quicknode,
      },
    );
    expect(indexed).toMatchObject({
      mode: "indexed-or-shadow",
      evidenceRequired: true,
      commitmentsReady: true,
      runtimeProviderBinding: "verified",
    });
    const sensitiveRuntimeEnvironment = `${exactFalse.replace(
      "INDEXED_EXPLORE_TOKEN_READS_ENABLED=\"false\"",
      "INDEXED_EXPLORE_TOKEN_READS_ENABLED=\"[sensitive]\"",
    )}\nPROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL="[sensitive]"\nPROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL="[sensitive]"${bitquerySecret}`;
    expect(
      deployPolicy.evaluateReadModelDeployPolicy(
        sensitiveRuntimeEnvironment,
        {
          PROGRAMMABLE_ALCHEMY_MAINNET_RPC_ENDPOINT_COMMITMENT:
            ENDPOINT_COMMITMENTS.alchemy,
          PROGRAMMABLE_QUICKNODE_MAINNET_RPC_ENDPOINT_COMMITMENT:
            ENDPOINT_COMMITMENTS.quicknode,
        },
      ),
    ).toMatchObject({
      mode: "indexed-or-shadow",
      evidenceRequired: true,
      commitmentsReady: true,
      runtimeProviderBinding: "deferred-stage",
    });
    expect(
      deployPolicy.evaluateReadModelDeployPolicy(
        `${sensitiveRuntimeEnvironment}\nETHEREUM_RPC_URL="https://eth-mainnet.g.alchemy.com/v2/abcdefgh"`,
        {
          PROGRAMMABLE_ALCHEMY_MAINNET_RPC_ENDPOINT_COMMITMENT:
            ENDPOINT_COMMITMENTS.alchemy,
          PROGRAMMABLE_QUICKNODE_MAINNET_RPC_ENDPOINT_COMMITMENT:
            ENDPOINT_COMMITMENTS.quicknode,
        },
      ),
    ).toMatchObject({
      evidenceRequired: true,
      commitmentsReady: false,
      runtimeProviderBinding: "unverified",
    });
    const publicFeedEnvironment = `${exactFalse.replace(
      "INDEXED_PUBLIC_INDEXER_FEED_READS_ENABLED=\"false\"",
      "INDEXED_PUBLIC_INDEXER_FEED_READS_ENABLED=\"true\"",
    )}\nPROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL="${RUNTIME_RPC_ENVIRONMENT.PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL}"\nPROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL="${RUNTIME_RPC_ENVIRONMENT.PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL}"${bitquerySecret}`;
    expect(
      deployPolicy.evaluateReadModelDeployPolicy(publicFeedEnvironment, {
        PROGRAMMABLE_ALCHEMY_MAINNET_RPC_ENDPOINT_COMMITMENT:
          ENDPOINT_COMMITMENTS.alchemy,
        PROGRAMMABLE_QUICKNODE_MAINNET_RPC_ENDPOINT_COMMITMENT:
          ENDPOINT_COMMITMENTS.quicknode,
      }),
    ).toMatchObject({
      mode: "indexed-or-shadow",
      evidenceRequired: true,
      commitmentsReady: true,
    });
    expect(
      deployPolicy.evaluateReadModelDeployPolicy(indexedEnvironment, {
        PROGRAMMABLE_ALCHEMY_MAINNET_RPC_ENDPOINT_COMMITMENT:
          `0x${"77".repeat(32)}`,
        PROGRAMMABLE_QUICKNODE_MAINNET_RPC_ENDPOINT_COMMITMENT:
          ENDPOINT_COMMITMENTS.quicknode,
      }),
    ).toMatchObject({
      evidenceRequired: true,
      commitmentsReady: false,
      invalidCommitmentNames: ["runtime-provider-commitment-mismatch"],
    });
    expect(
      deployPolicy.evaluateReadModelDeployPolicy(
        exactFalse.split("\n").slice(1).join("\n"),
        {},
      ),
    ).toMatchObject({ evidenceRequired: true, commitmentsReady: false });
  });

  it("derives release identities from two pinned non-secret commitments", () => {
    const bindings = providerBinding.expectedProductionProviderBindings({
      PROGRAMMABLE_ALCHEMY_MAINNET_RPC_ENDPOINT_COMMITMENT:
        ENDPOINT_COMMITMENTS.alchemy,
      PROGRAMMABLE_QUICKNODE_MAINNET_RPC_ENDPOINT_COMMITMENT:
        ENDPOINT_COMMITMENTS.quicknode,
    });
    expect(bindings).toEqual(expectedProviders());
    expect(() =>
      providerBinding.expectedProductionProviderBindings({
        PROGRAMMABLE_ALCHEMY_MAINNET_RPC_ENDPOINT_COMMITMENT:
          ENDPOINT_COMMITMENTS.alchemy,
      }),
    ).toThrow("both pinned provider commitments");
  });

  it("binds approved Alchemy and QuickNode server-only endpoints", async () => {
    const environment = {
      PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL:
        "https://eth-mainnet.g.alchemy.com/v2/abcdefgh",
      PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL:
        "https://example.quiknode.pro/abcdefgh",
    };
    const bindings = providerBinding.expectedProductionProviderBindings({
      ...environment,
    });
    expect(bindings.map((binding: { vendorGroup: string }) => binding.vendorGroup)).toEqual([
      "alchemy",
      "quicknode",
    ]);
    expect(bindings[0].endpointCommitment).not.toBe(
      bindings[1].endpointCommitment,
    );
    const { createProductionDualRpcProviders } = await import(
      "../../lib/data-pipeline/rpc-providers.server"
    );
    const providers = createProductionDualRpcProviders(environment);
    expect(providers.map(({ vendorGroup }) => vendorGroup)).toEqual([
      "alchemy",
      "quicknode",
    ]);
    expect(
      providers.map(({ identity, vendorGroup, endpointCommitment }) => ({
        identity,
        vendorGroup,
        endpointCommitment,
      })),
    ).toEqual(bindings);
    expect(JSON.stringify(providers)).not.toContain("abcdefgh");
  });

  it("checks live Vercel identity and real cache headers and keys", async () => {
    const fixture = createBundle();
    const expectedCache = fixture.profile.cacheContracts;
    const fetchImpl = async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      if (url.hostname === "api.vercel.com") {
        if (url.pathname === "/v6/deployments") {
          return new Response(
            JSON.stringify({
              deployments: [
                {
                  id: `dpl_${"B".repeat(24)}`,
                  projectId: "prj_test",
                  readyState: "READY",
                  target: "production",
                  alias: ["programmable.market"],
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            id: DEPLOYMENT_ID,
            url: new URL(TARGET_URL).hostname,
            projectId: "prj_test",
            readyState: "READY",
            meta: { githubCommitSha: GIT_HEAD },
          }),
          { status: 200 },
        );
      }
      let body: unknown;
      let cacheControl: string;
      if (url.pathname === "/api/explore") {
        body = { query: url.searchParams.get("q") };
        cacheControl = expectedCache.exploreList;
      } else if (url.pathname === "/api/explore/token") {
        body = { token: { tokenAddress: url.searchParams.get("address") } };
        cacheControl = expectedCache.tokenDetail;
      } else if (url.pathname === "/api/explore/token/chart") {
        body = {
          address: url.searchParams.get("address"),
          range: url.searchParams.get("range"),
        };
        cacheControl = expectedCache.tokenChart;
      } else if (url.pathname === "/api/explore/profile") {
        body = { account: url.searchParams.get("account") };
        cacheControl = expectedCache.creatorProfile;
      } else if (url.pathname === "/api/profile/classic-v3") {
        body = url.searchParams.has("launch")
          ? {
              status: "ready",
              launch: {
                launchTransactionHash: url.searchParams.get("launch"),
              },
            }
          : {
              status: "ready",
              account: url.searchParams.get("account"),
              rewards: [],
            };
        cacheControl = url.searchParams.has("launch")
          ? expectedCache.classicLaunchLookup
          : expectedCache.classicProfile;
      } else if (url.pathname === "/api/profile/stock-paired") {
        body = {
          status: "ready",
          account: url.searchParams.get("account"),
          rewards: [],
        };
        cacheControl = expectedCache.stockProfile;
      } else if (url.pathname === "/api/explore/launch/stock-paired") {
        body = {
          status: "ready",
          launch: { transactionHash: url.searchParams.get("transaction") },
        };
        cacheControl = expectedCache.stockLaunchLookup;
      } else if (url.pathname === "/api/indexers/v1/tokens") {
        body = { address: url.searchParams.get("address") };
        cacheControl = expectedCache.publicIndexer;
      } else if (url.pathname === "/api/indexers/v1/token-list") {
        body = { tokens: [{}] };
        cacheControl = expectedCache.tokenList;
      } else {
        body = { status: "healthy" };
        cacheControl = expectedCache.health;
      }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "cache-control": cacheControl },
      });
    };
    const vercel = await liveVerifier.verifyLiveVercelBinding({
      evidence: fixture.evidence,
      gitHead: GIT_HEAD,
      token: "token",
      teamId: "team",
      projectId: "prj_test",
      fetchImpl,
    });
    expect(vercel.ok).toBe(true);
    const rollback = await liveVerifier.verifyLiveRollbackTarget({
      stagedDeploymentId: DEPLOYMENT_ID,
      token: "token",
      teamId: "team",
      projectId: "prj_test",
      fetchImpl,
    });
    expect(rollback).toMatchObject({
      ok: true,
      rollbackDeploymentId: `dpl_${"B".repeat(24)}`,
    });
    const noRollback = await liveVerifier.verifyLiveRollbackTarget({
      stagedDeploymentId: DEPLOYMENT_ID,
      token: "token",
      teamId: "team",
      projectId: "prj_test",
      productionDomain: "programmable.market",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            deployments: [
              {
                id: DEPLOYMENT_ID,
                projectId: "prj_test",
                readyState: "READY",
                target: "production",
                alias: ["programmable.market"],
              },
            ],
          }),
          { status: 200 },
        ),
    });
    expect(noRollback.failures).toContainEqual(
      expect.objectContaining({ id: "vercel-rollback-target" }),
    );
    const cache = await liveVerifier.verifyLiveCacheAndKeyContracts({
      profile: fixture.profile,
      evidence: fixture.evidence,
      datasetManifest: fixture.datasetManifest,
      fetchImpl,
    });
    expect(cache.ok).toBe(true);
    const wrongHeader = await liveVerifier.verifyLiveCacheAndKeyContracts({
      profile: fixture.profile,
      evidence: fixture.evidence,
      datasetManifest: fixture.datasetManifest,
      fetchImpl: async (input: URL | RequestInfo) => {
        const response = await fetchImpl(input);
        return new URL(String(input)).pathname === "/api/ops/health"
          ? new Response(await response.text(), {
              status: 200,
              headers: { "cache-control": "public, max-age=3600" },
            })
          : response;
      },
    });
    expect(wrongHeader.failures).toContainEqual(
      expect.objectContaining({ id: "live-cache-headers" }),
    );
    const leakedChart = await liveVerifier.verifyLiveCacheAndKeyContracts({
      profile: fixture.profile,
      evidence: fixture.evidence,
      datasetManifest: fixture.datasetManifest,
      fetchImpl: async (input: URL | RequestInfo) => {
        const response = await fetchImpl(input);
        if (new URL(String(input)).pathname !== "/api/explore/token/chart") {
          return response;
        }
        const body = JSON.parse(await response.text());
        return new Response(
          JSON.stringify({
            ...body,
            address: fixture.datasetManifest.keys.tokenAddresses[0],
          }),
          {
            status: 200,
            headers: {
              "cache-control": fixture.profile.cacheContracts.tokenChart,
            },
          },
        );
      },
    });
    expect(leakedChart.failures).toContainEqual(
      expect.objectContaining({ id: "cache-key-chart-address" }),
    );
  });

  it("detects source drift and keeps smoke distinct from release evidence", () => {
    const profile = gateCore.parseReadModelLoadProfile(profileFixture());
    const alchemyResult =
      alchemySourceContracts.evaluateAlchemyExploreSourceContracts(
        process.cwd(),
      );
    expect(alchemyResult.ok).toBe(true);
    expect(alchemyResult.checks).toHaveLength(19);

    const exploreRoutePath = "app/api/explore/route.ts";
    const exploreRouteSource = readFileSync(
      resolve(process.cwd(), exploreRoutePath),
      "utf8",
    );
    const staleMarketProvenance =
      alchemySourceContracts.evaluateAlchemyExploreSourceContracts(
        process.cwd(),
        {
          sourceOverrides: {
            [exploreRoutePath]: exploreRouteSource.replaceAll(
              '"stateview-chainlink+official-uniswap-v4-subgraph+bitquery"',
              '"X-Programmable-Market-Source": "alchemy"',
            ),
          },
        },
      );
    expect(
      staleMarketProvenance.failures.map(
        (failure: { id: string }) => failure.id,
      ),
    ).toContain("bitquery-market-provenance");

    const canonicalSupplyPath =
      "lib/market-data/canonical-token-supply.server.ts";
    const canonicalSupplySource = readFileSync(
      resolve(process.cwd(), canonicalSupplyPath),
      "utf8",
    );
    const singleProviderSupply =
      alchemySourceContracts.evaluateAlchemyExploreSourceContracts(
        process.cwd(),
        {
          sourceOverrides: {
            [canonicalSupplyPath]: canonicalSupplySource.replace(
              "group.length >= 2",
              "group.length >= 1",
            ),
          },
        },
      );
    expect(
      singleProviderSupply.failures.map(
        (failure: { id: string }) => failure.id,
      ),
    ).toContain("canonical-token-supply-quorum");

    const currentMarketRpcPath =
      "lib/market-data/current-market-rpc.server.ts";
    const currentMarketRpcSource = readFileSync(
      resolve(process.cwd(), currentMarketRpcPath),
      "utf8",
    );
    for (const mutation of [
      currentMarketRpcSource.replace(
        '"https://rpc.mevblocker.io/"',
        '"https://ethereum-rpc.publicnode.com/"',
      ),
      currentMarketRpcSource.replace(
        "primary: quickNodeRpcUrl()",
        "primary: baseDeployment.rpcUrl",
      ),
      currentMarketRpcSource.replace(
        'primary?.vendorGroup !== "quicknode"',
        'primary?.vendorGroup !== "alchemy"',
      ),
      currentMarketRpcSource.replace(
        "primary.endpointCommitment !== expectedQuickNodeCommitment",
        "false",
      ),
    ]) {
      const mutatedCurrentMarket =
        alchemySourceContracts.evaluateAlchemyExploreSourceContracts(
          process.cwd(),
          { sourceOverrides: { [currentMarketRpcPath]: mutation } },
        );
      expect(
        mutatedCurrentMarket.failures.map(
          (failure: { id: string }) => failure.id,
        ),
      ).toContain("current-market-rpc-quorum");
    }

    const result = sourceContracts.evaluateReadModelSourceContracts(
      process.cwd(),
      profile,
    );
    const disconnectedIndexedFailures = [
      "source-cache-exploreList",
      "source-cache-tokenDetail",
      "source-cache-tokenChart",
      "source-cache-tokenList",
      "source-cache-publicIndexer",
    ];
    expect(
      result.failures.map((failure: { id: string }) => failure.id),
    ).toEqual(disconnectedIndexedFailures);
    expect(result.checks).toHaveLength(33);

    const dualRpcPath = "lib/data-pipeline/dual-rpc.ts";
    const dualRpcSource = readFileSync(resolve(process.cwd(), dualRpcPath), "utf8");
    const formattingOnly = dualRpcSource
      .replace(
        "const DEFAULT_RPC_CONCURRENCY = 4;",
        "const DEFAULT_RPC_CONCURRENCY\n  =\n  4;",
      )
      .replace(
        "executionTrace: Object.freeze({",
        "executionTrace :\n          Object.freeze ( {",
      );
    expect(formattingOnly).not.toBe(dualRpcSource);
    const formattingResult = sourceContracts.evaluateReadModelSourceContracts(
      process.cwd(),
      profile,
      {
        sourceOverrides: { [dualRpcPath]: formattingOnly },
      },
    );
    expect(
      formattingResult.failures.map(
        (failure: { id: string }) => failure.id,
      ),
    ).toEqual(disconnectedIndexedFailures);

    const semanticDrift = sourceContracts.evaluateReadModelSourceContracts(
      process.cwd(),
      profile,
      {
        sourceOverrides: {
          [dualRpcPath]: dualRpcSource.replace(
            "const DEFAULT_RPC_CONCURRENCY = 4;",
            "const DEFAULT_RPC_CONCURRENCY = 5;",
          ),
        },
      },
    );
    expect(
      semanticDrift.failures.map((failure: { id: string }) => failure.id),
    ).toContain("source-rpc-concurrency");
    const packageJson = readJson("package.json");
    expect(packageJson.scripts["perf:read-model:smoke"]).toContain(
      "read-model-smoke.mjs",
    );
    expect(packageJson.scripts["perf:read-model:gate"]).toContain(
      "--require-release-evidence",
    );
    expect(packageJson.scripts.verify).toContain(
      "perf:read-model:release-if-present",
    );
    const deployWorkflow = readFileSync(
      resolve(process.cwd(), ".github/workflows/deploy-production.yml"),
      "utf8",
    );
    expect(deployWorkflow).toContain("--prod --skip-domain");
    expect(deployWorkflow).toContain(
      '--env VERCEL_GIT_COMMIT_SHA="$GITHUB_SHA"',
    );
    expect(deployWorkflow).toContain("perf:read-model:capture");
    expect(deployWorkflow).toContain("actions/upload-artifact@");
    expect(deployWorkflow).toContain("npm run perf:read-model:gate");
    expect(deployWorkflow).toContain(
      "Stage-only: no production promotion was attempted.",
    );
    expect(deployWorkflow).not.toContain("vercel promote");
    expect(deployWorkflow).not.toContain("vercel rollback");
    expect(deployWorkflow.indexOf("perf:read-model:capture")).toBeLessThan(
      deployWorkflow.indexOf("npm run perf:read-model:gate"),
    );
    const captureSource = readFileSync(
      resolve(process.cwd(), "scripts/perf/read-model-capture.mjs"),
      "utf8",
    );
    expect(captureSource).toContain(RUNTIME_CAPTURE_PATH_FIXTURE);
    expect(captureSource).toContain(
      'headers["x-programmable-shadow-probe-signature"]',
    );
    expect(captureSource).not.toContain("x-programmable-shadow-probe-token");
    expect(captureSource).not.toContain('"dataset-manifest"');
    expect(captureSource).not.toContain('"rpc-trace"');
  });

  it("pins distributed release-probe failure and replay semantics", () => {
    const profile = gateCore.parseReadModelLoadProfile(profileFixture());
    const coordinatorPath = "lib/data-pipeline/route-coordinator.server.ts";
    const noncePath = "lib/data-pipeline/release-probe-nonce.server.ts";
    const readinessPath = "lib/data-pipeline/public-route-readiness.server.ts";
    const coordinator = readFileSync(
      resolve(process.cwd(), coordinatorPath),
      "utf8",
    );
    const nonceConsumer = readFileSync(resolve(process.cwd(), noncePath), "utf8");
    const readiness = readFileSync(resolve(process.cwd(), readinessPath), "utf8");
    const drift = sourceContracts.evaluateReadModelSourceContracts(
      process.cwd(),
      profile,
      {
        sourceOverrides: {
          [coordinatorPath]: coordinator
            .replace(
              "const RELEASE_PROBE_MAX_AGE_MS = 5 * 60 * 1_000;",
              "const RELEASE_PROBE_MAX_AGE_MS = 15 * 60 * 1_000;",
            )
            .replace("provenanceHeaders({ source: result.source })", "discardedHeaders({ source: result.source })"),
          [noncePath]: nonceConsumer.replace(
            'const RELEASE_PROBE_LOGIN = "programmable_release_probe_nonce_login";',
            'const RELEASE_PROBE_LOGIN = "shared_runtime_login";',
          ),
          [readinessPath]: readiness
            .replace("status: 503,", "status: 500,")
            .replace("if (releaseProbe) {", "if (true) {"),
        },
      },
    );
    expect(
      drift.failures.map((failure: { id: string }) => failure.id),
    ).toEqual(
      expect.arrayContaining([
        "source-release-probe-freshness",
        "source-release-probe-distributed-replay",
        "source-release-probe-private-failure",
        "source-release-probe-replay-validation",
        "source-release-probe-selected-provenance",
      ]),
    );
  });
});
