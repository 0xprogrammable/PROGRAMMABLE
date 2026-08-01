import { execFileSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

// The release gate is deliberately a standalone Node script rather than indexer runtime code.
// @ts-expect-error The checked-in mjs script has no declaration file by design.
import { IDENTITY_KEYS, INVENTORY_QUERY, LAUNCH_FIELDS, STABLE_LAUNCH_FIELDS, assertFrozenBaseline, auditCandidate, endpointIdFromUrl, localIdentity, parseBaseline, parseCandidateIdentity, snapshotBaseline } from "../scripts/release-candidate.mjs";

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

function launchRow(releaseVersion: (typeof RELEASES)[number], index: number): JsonRecord {
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
    buySwapFeeBps: releaseVersion === "classic-v3" ? 100 : null,
    sellSwapFeeBps: releaseVersion === "classic-v3" ? 100 : null,
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
  it("recomputes the exact eight-key identity from the reviewed checkout", () => {
    const identity = JSON.parse(
      execFileSync(
        process.execPath,
        [SCRIPT, "identity", "--source-commit", SOURCE_COMMIT],
        { cwd: ROOT, encoding: "utf8" },
      ),
    ) as JsonRecord;

    expect(Object.keys(identity)).toEqual(IDENTITY_KEYS);
    expect(identity).toEqual({
      deployment: `production-${SOURCE_COMMIT.slice(0, 7)}`,
      sourceCommit: SOURCE_COMMIT,
      configSha256:
        "0x378e3a799c762cb31107792c7123f5f90b54b5826884c398995e7465176fe1c2",
      schemaSha256:
        "0xdf3d65e033e96d7ebbe62b6f114b6a30f10c8944e5c6fca6b020c3130bb738c0",
      handlerSha256:
        "0x9f68d05cc8907f1c422cb2584b338ed42375eb4b6033cbec1338d00577267491",
      sourceRegistrySha256:
        "0x55e7a7c7cd0e419a6be0f9c784990f5048b9845e46e329939025c3fab405565a",
      eventSetSha256:
        "0x7481d6fa986d706e46b9834e40574dd84f21be80b041d35e7d47dbfa59d69243",
      eventCount: 51,
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
    const identity = localIdentity(SOURCE_COMMIT) as JsonRecord;
    const { eventCount: _eventCount, ...partial } = identity;
    expect(() => parseCandidateIdentity(partial)).toThrow(/exactly/u);
    expect(() => parseCandidateIdentity({ ...identity, arbitrary: true })).toThrow(/exactly/u);
    expect(() => parseCandidateIdentity({ ...identity, eventCount: "51" })).toThrow(/safe integer/u);
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
});

describe("Envio candidate audit", () => {
  it("corroborates control-plane, endpoint, reviewed runtime and baseline evidence", async () => {
    const identity = localIdentity(SOURCE_COMMIT) as JsonRecord;
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
    expect(first.baseline.digest).toBe(frozenBaseline.digest);
    expect(first.anchor.progressBlock).toBe("1100");
    expect(first.inventory.sha256).toMatch(/^0x[0-9a-f]{64}$/u);
    expect(first.digest).toMatch(/^0x[0-9a-f]{64}$/u);
  });

  it("rejects identity JSON that differs from the reviewed checkout", async () => {
    const identity = localIdentity(SOURCE_COMMIT) as JsonRecord;
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
    const identity = localIdentity(SOURCE_COMMIT) as JsonRecord;
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
    const identity = localIdentity(SOURCE_COMMIT) as JsonRecord;
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
    const identity = localIdentity(SOURCE_COMMIT) as JsonRecord;
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
