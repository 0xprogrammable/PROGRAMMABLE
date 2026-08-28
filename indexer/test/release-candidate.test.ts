import { execFileSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

import baseReleaseBinding from "../../config/data-pipeline-release.v1.json";

// The release gate is deliberately a standalone Node script rather than indexer runtime code.
// @ts-expect-error The checked-in mjs script has no declaration file by design.
import { IDENTITY_KEYS, INVENTORY_QUERY, LAUNCH_FIELDS, STABLE_LAUNCH_FIELDS, assertFrozenBaseline, auditWorkingTreeCandidate, endpointIdFromUrl, parseBaseline, parseCandidateIdentity, parseReleaseAuditArtifact, releaseBindingDigest, snapshotBaseline, workingTreeIdentity } from "../scripts/release-candidate.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const REPOSITORY_ROOT = path.resolve(ROOT, "..");
const SCRIPT = path.join(ROOT, "scripts/release-candidate.mjs");
const SOURCE_COMMIT = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: REPOSITORY_ROOT,
  encoding: "utf8",
}).trim();
const MIRROR_COMMIT = "2".repeat(40);
const BASELINE_ENDPOINT = "https://indexer.hyperindex.xyz/base001/v1/graphql";
const CANDIDATE_ENDPOINT = "https://indexer.hyperindex.xyz/cand001/v1/graphql";
const CAPTURED_AT = "2026-08-01T10:00:00.000Z";
const RELEASES = [
  "classic-v2",
  "classic-v3",
  "stock-paired-v1",
  "stock-paired-v2",
  "stock-paired-v3",
] as const;
type SupportedRelease = (typeof RELEASES)[number] | "classic-v4";

type JsonRecord = Record<string, unknown>;
type FixtureOptions = Readonly<{
  identity?: JsonRecord;
  rows?: JsonRecord[];
  progressBlock?: number;
  deploymentLabel?: string;
  mutateSecondInventoryRead?: (rows: JsonRecord[]) => JsonRecord[];
}>;

function hex(bytes: number, value: number): string {
  return `0x${value.toString(16).padStart(bytes * 2, "0")}`;
}

function launchRow(releaseVersion: SupportedRelease, index: number): JsonRecord {
  const model = releaseVersion.startsWith("classic") ? "classic" : "stock-paired";
  const stock = model === "stock-paired";
  return {
    id: `1:${releaseVersion}:${hex(32, index)}`,
    chainId: 1,
    model,
    releaseVersion,
    launchHash: hex(32, index),
    token: hex(20, 100 + index),
    creator: hex(20, 200 + index),
    quoteAsset: stock ? hex(20, 300 + index) : null,
    poolId: hex(32, 400 + index),
    hook: hex(20, 500 + index),
    rewardVault: releaseVersion === "classic-v2" ? null : hex(20, 600 + index),
    positionRecipient: stock ? null : hex(20, 700 + index),
    positionTokenId: stock ? null : String(800 + index),
    totalSwapFeeBps: stock ? null : 100,
    buySwapFeeBps: releaseVersion === "classic-v3" || releaseVersion === "classic-v4" ? 100 : null,
    sellSwapFeeBps: releaseVersion === "classic-v3" || releaseVersion === "classic-v4" ? 100 : null,
    rewardConfigurationHash: releaseVersion === "classic-v2" ? null : hex(32, 900 + index),
    quoteConfigurationHash: stock ? hex(32, 1_000 + index) : null,
    totalSupply: String(1_000_000 + index),
    tokenLiquidityAmount: String(900_000 + index),
    lockedTokenDust: String(index),
    initialTick: 204_200 + index,
    tickLower: -887_200,
    tickUpper: 204_200 + index,
    lpFeePips: stock ? 3_000 : 0,
    initialBuyQuoteAmount: String(10_000 + index),
    initialBuyTokenAmount: String(20_000 + index),
    initialBuyEthAmount: stock ? String(30_000 + index) : null,
    launchOccurrenceId: `1:${hex(32, 1_100 + index)}:${hex(32, 1_200 + index)}:1`,
    liquidityOccurrenceId: `1:${hex(32, 1_100 + index)}:${hex(32, 1_200 + index)}:2`,
    initialBuyOccurrenceId: `1:${hex(32, 1_100 + index)}:${hex(32, 1_200 + index)}:3`,
    custodyOccurrenceId: stock
      ? `1:${hex(32, 1_100 + index)}:${hex(32, 1_200 + index)}:4`
      : null,
    coordinatorOccurrenceId: stock
      ? `1:${hex(32, 1_100 + index)}:${hex(32, 1_200 + index)}:5`
      : null,
    hasLaunchEvent: true,
    hasLiquidityEvent: true,
    hasInitialBuyEvent: true,
    hasCustodyEvent: stock,
    hasCoordinatorEvent: stock,
    hasPoolRegistrationEvent: true,
    hasPoolFeeDisclosureEvent: true,
    hasRewardVaultFactoryEvent: releaseVersion !== "classic-v2",
    provenanceValid: true,
    isComplete: true,
    updatedBlock: String(900 + index),
  };
}

function rows(): JsonRecord[] {
  return RELEASES.map((release, index) => launchRow(release, index + 1)).sort((left, right) =>
    String(left.id).localeCompare(String(right.id)),
  );
}

function state(
  identity: JsonRecord | undefined,
  progressBlock: number,
  deploymentLabel = "production-old",
): JsonRecord {
  return {
    id: "ethereum-mainnet",
    schemaVersion: "1",
    deployment: identity?.deployment ?? deploymentLabel,
    ...(identity ?? {}),
    chainId: 1,
    progressBlock: String(progressBlock - 1),
    progressBlockHash: hex(32, progressBlock - 1),
    progressTimestamp: "1785552707",
    progressTransactionHash: hex(32, progressBlock + 1),
    progressOccurrenceId: `1:${hex(32, progressBlock - 1)}:${hex(32, progressBlock + 1)}:7`,
  };
}

function fixtureFetcher(options: FixtureOptions = {}) {
  const fixtureRows = options.rows ?? rows();
  const progressBlock = options.progressBlock ?? 1_000;
  let inventoryReads = 0;
  const anchors: unknown[] = [];
  const fetcher = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body)) as {
      query: string;
      variables: Record<string, unknown>;
    };
    if (body.query.includes("ProgrammableReleaseInventory")) {
      inventoryReads += 1;
      anchors.push(body.variables.anchorBlock);
      const sourceRows =
        inventoryReads === 2 && options.mutateSecondInventoryRead
          ? options.mutateSecondInventoryRead(fixtureRows.map((row) => ({ ...row })))
          : fixtureRows;
      const afterId = String(body.variables.afterId);
      const page = sourceRows
        .filter((row) => String(row.id) > afterId)
        .slice(0, Number(body.variables.first));
      return Response.json({ data: { Launch: page } });
    }
    const candidate = body.query.includes("ProgrammableReleaseCandidateProgress");
    return Response.json({
      data: {
        _meta: [
          {
            chainId: 1,
            progressBlock,
            bufferBlock: progressBlock,
            sourceBlock: progressBlock + 12,
            isReady: true,
            eventsProcessed: 50,
          },
        ],
        IndexerState_by_pk: state(
          candidate ? options.identity : undefined,
          progressBlock,
          options.deploymentLabel,
        ),
      },
    });
  };
  return { fetcher, anchors, inventoryReads: () => inventoryReads };
}

async function baseline(fixtureRows = rows()) {
  const fixture = fixtureFetcher({ rows: fixtureRows });
  return snapshotBaseline(BASELINE_ENDPOINT, fixture.fetcher, () => new Date(CAPTURED_AT));
}

function deployment(identity: JsonRecord): JsonRecord {
  return {
    "deployment-endpoint-id": "cand001",
    "deployment-label": identity.deployment,
    "mirror-commit": MIRROR_COMMIT,
  };
}

function releaseBinding(identity: JsonRecord, includeClassicV4 = false): JsonRecord {
  const binding = structuredClone(baseReleaseBinding) as JsonRecord;
  binding.envio = {
    deploymentLabel: identity.deployment,
    graphqlEndpoint: CANDIDATE_ENDPOINT,
    schemaVersion: "1",
    sourceCommit: identity.sourceCommit,
    configSha256: identity.configSha256,
    schemaSha256: identity.schemaSha256,
    handlerSha256: identity.handlerSha256,
    sourceRegistrySha256: identity.sourceRegistrySha256,
    eventSetSha256: identity.eventSetSha256,
    eventCount: identity.eventCount,
  };
  if (!includeClassicV4) return binding;
  const sources = binding.sources as JsonRecord[];
  sources.push(
    {
      contractName: "ClassicV4Hook",
      address: hex(20, 0x20cc),
      startBlock: 1_050,
      runtimeCodeHash: hex(32, 0x44),
    },
    {
      contractName: "ClassicV4Launcher",
      address: hex(20, 0x3000),
      startBlock: 1_051,
      runtimeCodeHash: hex(32, 0x45),
    },
  );
  (binding.releases as JsonRecord[]).push({
    model: "classic",
    releaseVersion: "classic-v4",
    activationBlock: 1_051,
    sourceContracts: [
      "ClassicV3RewardVaultFactory",
      "ClassicV3VestingWalletFactory",
      "ClassicV4Hook",
      "ClassicV4Launcher",
    ],
    dynamicContracts: ["ClassicV3RewardVault"],
  });
  return binding;
}

async function auditCandidate(input: Record<string, unknown>) {
  return auditWorkingTreeCandidate({
    releaseBinding: releaseBinding(input.expectedIdentity as JsonRecord),
    ...input,
  });
}

function changedValue(field: string, current: unknown): unknown {
  if (typeof current === "boolean") return !current;
  if (typeof current === "number") return current + 1;
  if (field === "chainId") return 2;
  if (field === "model") return "stock-paired";
  if (field === "releaseVersion") return "classic-v3";
  if (field === "id") return `${String(current)}-changed`;
  if (["token", "creator", "quoteAsset", "hook", "rewardVault", "positionRecipient"].includes(field)) {
    return current === null ? hex(20, 9_999) : hex(20, 9_998);
  }
  if (["launchHash", "poolId", "rewardConfigurationHash", "quoteConfigurationHash"].includes(field)) {
    return current === null ? hex(32, 9_999) : hex(32, 9_998);
  }
  if (current === null) return "1";
  if (typeof current === "string" && /^(?:0|[1-9][0-9]*)$/u.test(current)) {
    return String(BigInt(current) + 1n);
  }
  return `${String(current)}-changed`;
}

describe("Envio release candidate identity", () => {
  it("recomputes the exact eight-key identity from candidate working bytes", () => {
    const identity = workingTreeIdentity(SOURCE_COMMIT) as JsonRecord;

    expect(Object.keys(identity)).toEqual(IDENTITY_KEYS);
    expect(identity).toEqual({
      deployment: `production-${SOURCE_COMMIT.slice(0, 7)}`,
      sourceCommit: SOURCE_COMMIT,
      configSha256:
        "0x0286e176b7e8f9baf49a6751390abb6ca97c246e717d00fda34dbe023830d2a6",
      schemaSha256:
        "0xdf3d65e033e96d7ebbe62b6f114b6a30f10c8944e5c6fca6b020c3130bb738c0",
      handlerSha256:
        "0x3249c4d6e733e271ce1cd9a9407a1e3881fa79491500143b08e77c1d7e5e1fdf",
      sourceRegistrySha256:
        "0x98d6a49f606f198340f1938127744ee5d12b786e0d1b7cd1e31a1b1b4a713ef0",
      eventSetSha256:
        "0x79bd6a7e9c4e4c76141ff72dd1a295b32c8115d85cd6826c7c9a403a4ed3c63f",
      eventCount: 60,
    });
  });

  it.each([
    ["symbolic commit", "HEAD"],
    ["unknown valid-looking commit", "1".repeat(40)],
    ["uppercase commit", SOURCE_COMMIT.toUpperCase()],
  ])("rejects a %s", (_label, sourceCommit) => {
    expect(() =>
      execFileSync(
        process.execPath,
        [SCRIPT, "identity", "--source-commit", sourceCommit],
        { cwd: ROOT, encoding: "utf8", stdio: "pipe" },
      ),
    ).toThrow();
  });

  it("rejects partial, extra and mistyped candidate identity JSON", () => {
    const identity = workingTreeIdentity(SOURCE_COMMIT) as JsonRecord;
    const partial = { ...identity };
    delete partial.eventCount;
    expect(() => parseCandidateIdentity(partial)).toThrow(/exactly/u);
    expect(() => parseCandidateIdentity({ ...identity, arbitrary: true })).toThrow(/exactly/u);
    expect(() => parseCandidateIdentity({ ...identity, eventCount: "60" })).toThrow(/safe integer/u);
    expect(() =>
      parseCandidateIdentity({ ...identity, handlerSha256: String(identity.handlerSha256).toUpperCase() }),
    ).toThrow(/invalid/u);
  });
});

describe("Envio endpoint and frozen evidence", () => {
  it("accepts only the exact Envio host and deployment endpoint path", () => {
    expect(endpointIdFromUrl(CANDIDATE_ENDPOINT, "cand001")).toBe("cand001");
    for (const value of [
      "http://indexer.hyperindex.xyz/cand001/v1/graphql",
      "https://evil.example/cand001/v1/graphql",
      "https://indexer.hyperindex.xyz:443/cand001/v1/graphql",
      "https://user@indexer.hyperindex.xyz/cand001/v1/graphql",
      "https://indexer.hyperindex.xyz/cand001/v1/graphql?query=x",
      "https://indexer.hyperindex.xyz/cand001/v1/graphql#fragment",
      "https://indexer.hyperindex.xyz/cand001/v1/graphql/",
      "https://indexer.hyperindex.xyz/short/v1/graphql",
    ]) {
      expect(() => endpointIdFromUrl(value)).toThrow(/reviewed Envio/u);
    }
    expect(() => endpointIdFromUrl(CANDIDATE_ENDPOINT, "other01")).toThrow(/reviewed Envio/u);
  });

  it("uses one fixed anchor for both inventory reads and emits deterministic digests", async () => {
    const firstFixture = fixtureFetcher();
    const first = await snapshotBaseline(
      BASELINE_ENDPOINT,
      firstFixture.fetcher,
      () => new Date(CAPTURED_AT),
    );
    const second = await baseline();

    expect(first).toEqual(second);
    expect(firstFixture.anchors).toEqual(["1000", "1000"]);
    expect(firstFixture.inventoryReads()).toBe(2);
    expect(INVENTORY_QUERY).toContain("updatedBlock: { _lte: $anchorBlock }");
    expect(first.entries).toHaveLength(5);
    expect(first.inventory.perRelease).toMatchObject({ "classic-v4": 0 });
    expect(Object.keys(first.entries[0] as JsonRecord)).toEqual(LAUNCH_FIELDS);
    expect(first.inventory.sha256).toMatch(/^0x[0-9a-f]{64}$/u);
    expect(first.digest).toMatch(/^0x[0-9a-f]{64}$/u);
    expect(first.deployment).toEqual({
      provider: "envio-cloud",
      host: "indexer.hyperindex.xyz",
      endpointId: "base001",
      deploymentLabel: "production-old",
      chainId: 1,
    });
  });

  it("rejects an inventory that changes while the anchored pages are read", async () => {
    const fixture = fixtureFetcher({
      mutateSecondInventoryRead: (values) =>
        values.map((row, index) => (index === 0 ? { ...row, creator: hex(20, 9_999) } : row)),
    });
    await expect(
      snapshotBaseline(BASELINE_ENDPOINT, fixture.fetcher, () => new Date(CAPTURED_AT)),
    ).rejects.toThrow(/changed while reading/u);
  });

  it("rejects baseline tampering across entries, identity, anchor and top-level digest", async () => {
    const value = (await baseline()) as JsonRecord;
    const entries = value.entries as JsonRecord[];
    expect(() =>
      parseBaseline({
        ...value,
        entries: [{ ...entries[0], creator: hex(20, 9_999) }, ...entries.slice(1)],
      }),
    ).toThrow(/inventory count or digest/u);
    expect(() =>
      parseBaseline({
        ...value,
        deployment: { ...(value.deployment as JsonRecord), endpointId: "other01" },
      }),
    ).toThrow(/does not match/u);
    expect(() =>
      parseBaseline({
        ...value,
        anchor: { ...(value.anchor as JsonRecord), progressBlock: "999" },
      }),
    ).toThrow();
    expect(() => parseBaseline({ ...value, digest: hex(32, 123) })).toThrow(/digest mismatch/u);
    expect(() => parseBaseline({ ...value, arbitrary: true })).toThrow(/exactly/u);
  });

  it("compares every frozen stable launch field", () => {
    const expected = rows()[0] as JsonRecord;
    for (const field of STABLE_LAUNCH_FIELDS as string[]) {
      const changed = { ...expected, [field]: changedValue(field, expected[field]) };
      expect(
        () => assertFrozenBaseline([changed], { entries: [expected] }),
        `field ${field} was not compared`,
      ).toThrow();
    }
  });

  it("records only the exact authenticated Stock coordinator creator repair", async () => {
    const frozenRows = rows();
    const stockIndex = frozenRows.findIndex(
      (row) => row.releaseVersion === "stock-paired-v1",
    );
    const coordinatorSource = "0xfa5f17389ca28d071781d59750b32c842ab6a54b";
    frozenRows[stockIndex] = {
      ...frozenRows[stockIndex],
      creator: coordinatorSource,
      provenanceValid: false,
      isComplete: false,
    };
    const candidateRows = frozenRows.map((row, index) =>
      index === stockIndex
        ? {
            ...row,
            creator: hex(20, 8_888),
            provenanceValid: true,
            isComplete: true,
          }
        : row,
    );
    const frozenBaseline = await baseline(frozenRows);

    expect(assertFrozenBaseline(candidateRows, frozenBaseline)).toEqual([
      {
        id: frozenRows[stockIndex].id,
        releaseVersion: "stock-paired-v1",
        priorCoordinatorSource: coordinatorSource,
        authenticatedCreator: hex(20, 8_888),
        launchOccurrenceId: frozenRows[stockIndex].launchOccurrenceId,
        coordinatorOccurrenceId: frozenRows[stockIndex].coordinatorOccurrenceId,
      },
    ]);

    expect(() =>
      assertFrozenBaseline(
        candidateRows.map((row, index) =>
          index === stockIndex ? { ...row, totalSupply: "999999999" } : row,
        ),
        frozenBaseline,
      ),
    ).toThrow(/changed frozen launch .* at creator/u);
    expect(() =>
      assertFrozenBaseline(candidateRows, {
        entries: frozenRows.map((row, index) =>
          index === stockIndex ? { ...row, provenanceValid: true } : row,
        ),
      }),
    ).toThrow(/changed frozen launch .* at creator/u);
  });
});

describe("Envio candidate audit", () => {
  it("corroborates control-plane, endpoint, reviewed runtime and baseline evidence", async () => {
    const identity = workingTreeIdentity(SOURCE_COMMIT) as JsonRecord;
    const frozenBaseline = await baseline();
    const firstFixture = fixtureFetcher({ identity, progressBlock: 1_100 });
    const first = await auditCandidate({
      endpoint: CANDIDATE_ENDPOINT,
      expectedIdentity: identity,
      baseline: frozenBaseline,
      sourceCommit: SOURCE_COMMIT,
      deployment: deployment(identity),
      fetcher: firstFixture.fetcher,
      now: () => new Date(CAPTURED_AT),
    });
    const secondFixture = fixtureFetcher({ identity, progressBlock: 1_100 });
    const second = await auditCandidate({
      endpoint: CANDIDATE_ENDPOINT,
      expectedIdentity: identity,
      baseline: frozenBaseline,
      sourceCommit: SOURCE_COMMIT,
      deployment: deployment(identity),
      fetcher: secondFixture.fetcher,
      now: () => new Date(CAPTURED_AT),
    });

    expect(first).toEqual(second);
    expect(first.deployment).toEqual({
      provider: "envio-cloud",
      owner: "0xprogrammable",
      project: "programmable-indexer",
      mirrorCommit: MIRROR_COMMIT,
      deploymentLabel: identity.deployment,
      endpointId: "cand001",
    });
    expect(first.identity).toEqual(identity);
    expect(first.releaseBinding).toEqual(releaseBinding(identity));
    expect(first.releaseBindingDigest).toBe(
      releaseBindingDigest(releaseBinding(identity)),
    );
    expect(first.classicV4Activated).toBe(false);
    expect(first.baseline.digest).toBe(frozenBaseline.digest);
    expect(first.anchor.progressBlock).toBe("1100");
    expect(first.inventory.sha256).toMatch(/^0x[0-9a-f]{64}$/u);
    expect(first.authenticatedCoordinatorCreatorRepairs).toEqual([]);
    expect(first.digest).toMatch(/^0x[0-9a-f]{64}$/u);
    expect(parseReleaseAuditArtifact(first)).toEqual(first);

    const tamperedDigest = structuredClone(first);
    tamperedDigest.releaseBindingDigest = hex(32, 9_999);
    expect(() => parseReleaseAuditArtifact(tamperedDigest)).toThrow(
      /binding digest mismatch/u,
    );
  });

  it("requires an activated source inventory to contain a Classic V4 canary", async () => {
    const identity = workingTreeIdentity(SOURCE_COMMIT) as JsonRecord;
    const frozenBaseline = await baseline();
    const activatedRows = [...rows(), launchRow("classic-v4", 9)].sort((left, right) =>
      String(left.id).localeCompare(String(right.id)),
    );
    const common = {
      endpoint: CANDIDATE_ENDPOINT,
      expectedIdentity: identity,
      releaseBinding: releaseBinding(identity, true),
      baseline: frozenBaseline,
      sourceCommit: SOURCE_COMMIT,
      deployment: deployment(identity),
      progressBlock: 1_100,
      classicV4ActivationReader: () => true,
      now: () => new Date(CAPTURED_AT),
    };
    const artifact = await auditWorkingTreeCandidate({
      ...common,
      fetcher: fixtureFetcher({
        identity,
        rows: activatedRows,
        progressBlock: 1_100,
      }).fetcher,
    });

    expect(artifact.classicV4Activated).toBe(true);
    expect(artifact.inventory.perRelease["classic-v4"]).toBe(1);
    expect(
      parseReleaseAuditArtifact(artifact, { requireClassicV4: true }),
    ).toEqual(artifact);

    await expect(
      auditWorkingTreeCandidate({
        ...common,
        fetcher: fixtureFetcher({ identity, rows: rows(), progressBlock: 1_100 })
          .fetcher,
      }),
    ).rejects.toThrow(/no classic-v4 launches/u);
  });

  it("includes an exact Stock coordinator creator repair in signed audit evidence", async () => {
    const identity = workingTreeIdentity(SOURCE_COMMIT) as JsonRecord;
    const frozenRows = rows();
    const stockIndex = frozenRows.findIndex(
      (row) => row.releaseVersion === "stock-paired-v1",
    );
    frozenRows[stockIndex] = {
      ...frozenRows[stockIndex],
      creator: "0xfa5f17389ca28d071781d59750b32c842ab6a54b",
      provenanceValid: false,
      isComplete: false,
    };
    const candidateRows = frozenRows.map((row, index) =>
      index === stockIndex
        ? {
            ...row,
            creator: hex(20, 8_888),
            provenanceValid: true,
            isComplete: true,
          }
        : row,
    );
    const result = await auditCandidate({
      endpoint: CANDIDATE_ENDPOINT,
      expectedIdentity: identity,
      baseline: await baseline(frozenRows),
      sourceCommit: SOURCE_COMMIT,
      deployment: deployment(identity),
      fetcher: fixtureFetcher({
        identity,
        rows: candidateRows,
        progressBlock: 1_100,
      }).fetcher,
      now: () => new Date(CAPTURED_AT),
    });

    expect(result.authenticatedCoordinatorCreatorRepairs).toHaveLength(1);
    expect(result.authenticatedCoordinatorCreatorRepairs[0]).toMatchObject({
      id: frozenRows[stockIndex].id,
      releaseVersion: "stock-paired-v1",
      priorCoordinatorSource: "0xfa5f17389ca28d071781d59750b32c842ab6a54b",
      authenticatedCreator: hex(20, 8_888),
    });
  });

  it("rejects identity JSON that differs from the reviewed checkout", async () => {
    const identity = workingTreeIdentity(SOURCE_COMMIT) as JsonRecord;
    await expect(
      auditCandidate({
        endpoint: CANDIDATE_ENDPOINT,
        expectedIdentity: { ...identity, handlerSha256: hex(32, 123) },
        baseline: await baseline(),
        sourceCommit: SOURCE_COMMIT,
        deployment: deployment(identity),
        fetcher: fixtureFetcher({ identity, progressBlock: 1_100 }).fetcher,
      }),
    ).rejects.toThrow(/reviewed checkout identity mismatch/u);
  });

  it("rejects endpoint, deployment-label and runtime identity substitution", async () => {
    const identity = workingTreeIdentity(SOURCE_COMMIT) as JsonRecord;
    const frozenBaseline = await baseline();
    const common = {
      expectedIdentity: identity,
      baseline: frozenBaseline,
      sourceCommit: SOURCE_COMMIT,
    };
    await expect(
      auditCandidate({
        ...common,
        endpoint: CANDIDATE_ENDPOINT,
        deployment: { ...deployment(identity), "deployment-endpoint-id": "other01" },
        fetcher: fixtureFetcher({ identity, progressBlock: 1_100 }).fetcher,
      }),
    ).rejects.toThrow(/reviewed Envio/u);
    await expect(
      auditCandidate({
        ...common,
        endpoint: CANDIDATE_ENDPOINT,
        deployment: { ...deployment(identity), "deployment-label": "production-substitute" },
        fetcher: fixtureFetcher({ identity, progressBlock: 1_100 }).fetcher,
      }),
    ).rejects.toThrow(/does not match candidate identity/u);
    await expect(
      auditCandidate({
        ...common,
        endpoint: CANDIDATE_ENDPOINT,
        deployment: { ...deployment(identity), "mirror-commit": "HEAD" },
        fetcher: fixtureFetcher({ identity, progressBlock: 1_100 }).fetcher,
      }),
    ).rejects.toThrow(/mirror commit is invalid/u);
    await expect(
      auditCandidate({
        ...common,
        endpoint: CANDIDATE_ENDPOINT,
        deployment: deployment(identity),
        fetcher: fixtureFetcher({
          identity: { ...identity, eventSetSha256: hex(32, 123) },
          progressBlock: 1_100,
        }).fetcher,
      }),
    ).rejects.toThrow(/candidate IndexerState identity mismatch/u);
  });

  it("rejects a candidate behind the frozen checkpoint", async () => {
    const identity = workingTreeIdentity(SOURCE_COMMIT) as JsonRecord;
    await expect(
      auditCandidate({
        endpoint: CANDIDATE_ENDPOINT,
        expectedIdentity: identity,
        baseline: await baseline(),
        sourceCommit: SOURCE_COMMIT,
        deployment: deployment(identity),
        fetcher: fixtureFetcher({ identity, progressBlock: 999 }).fetcher,
      }),
    ).rejects.toThrow(/has not reached/u);
  });

  it("rejects a change to a frozen launch even when all digests are otherwise valid", async () => {
    const identity = workingTreeIdentity(SOURCE_COMMIT) as JsonRecord;
    const frozenBaseline = await baseline();
    const changed = rows();
    changed[0] = { ...changed[0], totalSupply: "999999999" };
    await expect(
      auditCandidate({
        endpoint: CANDIDATE_ENDPOINT,
        expectedIdentity: identity,
        baseline: frozenBaseline,
        sourceCommit: SOURCE_COMMIT,
        deployment: deployment(identity),
        fetcher: fixtureFetcher({ identity, rows: changed, progressBlock: 1_100 }).fetcher,
      }),
    ).rejects.toThrow(/changed frozen launch .* at totalSupply/u);
  });
});
