import { createHash, createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

// @ts-expect-error Operational JavaScript modules intentionally have no declarations.
import { verifyRealBlockSlaDatabaseAttestation } from "../../scripts/perf/read-model-real-block-sla-gate.mjs";

const SECRET = "performance-probe-secret-at-least-32-bytes";
const CHALLENGE = `0x${"55".repeat(32)}`;
const RECEIPT = `0x${"44".repeat(32)}`;
const STATE = "00000000-0000-4000-8000-000000000019";

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(row[key])}`).join(",")}}`;
}

function resign(value: ReturnType<typeof attestation>) {
  const { challenge, attestationHmacSha256: _old, ...exported } = value;
  void _old;
  value.attestationHmacSha256 = `0x${createHmac("sha256", SECRET)
    .update(`${canonicalJson(exported)}:${challenge}`).digest("hex")}`;
  return value;
}

function attestation(exportedAt = "2026-08-02T12:00:00.500Z") {
  const runtimeReceipt = {
    repositoryCommit: "a".repeat(40),
    deploymentId: "dpl_aaaaaaaaaaaaaaaaaaaaaaaa",
    deploymentOrigin: "https://programmable-real-block-abc.vercel.app",
    projectId: "prj_programmable",
    deliveryReceiptId: "19",
    wakeId: "7",
    initialNonceDigest: `0x${"11".repeat(32)}`,
    duplicateNonceDigest: `0x${"13".repeat(32)}`,
    payloadSha256: `0x${"12".repeat(32)}`,
    streamId: "programmable-mainnet-head",
    signedAt: "2026-08-02T11:59:59.900Z",
    requestReceivedAt: "2026-08-02T12:00:00.000Z",
    databaseReceivedAt: "2026-08-02T12:00:00.000Z",
    jobPersistedAt: "2026-08-02T12:00:00.001Z",
    acknowledgedAt: "2026-08-02T12:00:00.002Z",
    duplicateReceivedAt: "2026-08-02T12:00:00.003Z",
    duplicateAcknowledgedAt: "2026-08-02T12:00:00.004Z",
    initialResponseStatus: 503,
    duplicateResponseStatus: 202,
    bundleVisibleAt: "2026-08-02T12:00:00.100Z",
    blockNumber: "22000000",
    blockHash: `0x${"21".repeat(32)}`,
    parentHash: `0x${"22".repeat(32)}`,
    blockTimestamp: "2026-08-02T11:59:59.000Z",
    blockEvidenceCommitment: `0x${"24".repeat(32)}`,
    logsCommitment: `0x${"23".repeat(32)}`,
    providerADeploymentId: "11111111-1111-4111-8111-111111111111",
    providerBDeploymentId: "22222222-2222-4222-8222-222222222222",
    providerAEndpointHost: "eth-mainnet.g.alchemy.com",
    providerBEndpointHost: "programmable.quiknode.pro",
    providerAEndpointUrlSha256: `0x${"31".repeat(32)}`,
    providerBEndpointUrlSha256: `0x${"32".repeat(32)}`,
    blockProviderAHead: "22000000",
    blockProviderAHeadHash: `0x${"21".repeat(32)}`,
    blockProviderAObservedAt: "2026-08-02T12:00:00.020Z",
    blockProviderBHead: "22000000",
    blockProviderBHeadHash: `0x${"21".repeat(32)}`,
    blockProviderBObservedAt: "2026-08-02T12:00:00.021Z",
    blockProviderCallCountA: 4,
    blockProviderCallCountB: 4,
    eventRowCount: 0,
    metadataTokenCount: 0,
    metadataProviderCallCountA: 0,
    metadataProviderCallCountB: 0,
    marketRowCount: 1,
    reorgGeneration: "7",
    events: [] as Array<{
      optimisticEventId: string;
      payloadCommitment: string;
    }>,
    markets: [{
      optimisticMarketStateId: STATE,
      poolId: `0x${"40".repeat(32)}`,
      tokenAddress: `0x${"41".repeat(20)}`,
      releaseVersion: "classic-v3",
      evidenceCommitment: `0x${"42".repeat(32)}`,
      marketCommitment: `0x${"43".repeat(32)}`,
      confirmations: 0,
      marketProviderAHead: "22000000",
      marketProviderAHeadHash: `0x${"21".repeat(32)}`,
      marketProviderAObservedAt: "2026-08-02T12:00:00.040Z",
      marketProviderBHead: "22000000",
      marketProviderBHeadHash: `0x${"21".repeat(32)}`,
      marketProviderBObservedAt: "2026-08-02T12:00:00.041Z",
      marketProviderCallCountA: 7,
      marketProviderCallCountB: 7,
      totalProviderCallCountA: 11,
      totalProviderCallCountB: 11,
    }],
  };
  const apiObservations = ["classic-chart", "explore-token"].map((surface, index) => ({
    apiObservationId: `00000000-0000-4000-8000-${String(20 + index).padStart(12, "0")}`,
    surface,
    optimisticMarketStateId: STATE,
    releaseVersion: "classic-v3",
    reorgGeneration: "7",
    requestUrl: `https://programmable-real-block-abc.vercel.app/${surface}`,
    responseStatus: 200,
    cacheControl: "no-store",
    responseBodySha256: `0x${String(51 + index).repeat(32)}`,
    responseBodySize: 512,
    observedAt: `2026-08-02T12:00:00.${index + 2}00Z`,
  }));
  const exported = {
    kind: "programmable-real-block-sla-db-attestation",
    schemaVersion: 2,
    exportId: "00000000-0000-4000-8000-000000000022",
    challengeSha256: `0x${createHash("sha256").update(CHALLENGE).digest("hex")}`,
    exportedAt,
    runtimeReceipt,
    apiObservations,
    receiptSha256: RECEIPT,
  };
  return {
    ...exported,
    challenge: CHALLENGE,
    attestationHmacSha256: `0x${createHmac("sha256", SECRET)
      .update(`${canonicalJson(exported)}:${CHALLENGE}`).digest("hex")}`,
  };
}

const expected = {
  expectedRepositoryCommit: "a".repeat(40),
  expectedDeploymentId: "dpl_aaaaaaaaaaaaaaaaaaaaaaaa",
  expectedTargetUrl: "https://programmable-real-block-abc.vercel.app",
  nowMs: Date.parse("2026-08-02T12:00:00.500Z"),
  probeToken: SECRET,
};

describe("DB-authored real-block SLA gate", () => {
  it("rejects legacy or unversioned attestations", () => {
    expect(() => verifyRealBlockSlaDatabaseAttestation({
      ...attestation(),
      schemaVersion: 1,
    }, expected)).toThrow("database attestation version");
  });

  it("accepts a fresh challenge-bound DB and exact-byte API receipt", () => {
    expect(verifyRealBlockSlaDatabaseAttestation(attestation(), expected)).toMatchObject({
      ok: true,
      databaseAttested: true,
      deliveryToAllRequiredSurfacesVisibleMs: 300,
    });
  });

  it("accepts measured metadata retry calls and aggregates them exactly", () => {
    const retried = attestation();
    retried.runtimeReceipt.metadataTokenCount = 1;
    retried.runtimeReceipt.metadataProviderCallCountA = 4;
    retried.runtimeReceipt.metadataProviderCallCountB = 4;
    retried.runtimeReceipt.eventRowCount = 1;
    retried.runtimeReceipt.events = [{
      optimisticEventId: "00000000-0000-4000-8000-000000000026",
      payloadCommitment: `0x${"74".repeat(32)}`,
    }];
    retried.runtimeReceipt.markets[0]!.totalProviderCallCountA = 15;
    retried.runtimeReceipt.markets[0]!.totalProviderCallCountB = 15;

    expect(verifyRealBlockSlaDatabaseAttestation(
      resign(retried),
      expected,
    )).toMatchObject({ ok: true, databaseAttested: true });
  });

  it("rejects odd, over-budget, and zero-token metadata call counts", () => {
    const cases = [
      { tokenCount: 1, callsA: 3, callsB: 4 },
      { tokenCount: 1, callsA: 8, callsB: 4 },
      { tokenCount: 0, callsA: 2, callsB: 0 },
    ];
    for (const row of cases) {
      const invalid = attestation();
      invalid.runtimeReceipt.metadataTokenCount = row.tokenCount;
      invalid.runtimeReceipt.metadataProviderCallCountA = row.callsA;
      invalid.runtimeReceipt.metadataProviderCallCountB = row.callsB;
      invalid.runtimeReceipt.markets[0]!.totalProviderCallCountA =
        4 + row.callsA + 7;
      invalid.runtimeReceipt.markets[0]!.totalProviderCallCountB =
        4 + row.callsB + 7;
      if (row.tokenCount === 1) {
        invalid.runtimeReceipt.eventRowCount = 1;
        invalid.runtimeReceipt.events = [{
          optimisticEventId: "00000000-0000-4000-8000-000000000027",
          payloadCommitment: `0x${"75".repeat(32)}`,
        }];
      }

      expect(() => verifyRealBlockSlaDatabaseAttestation(
        resign(invalid),
        expected,
      )).toThrow("metadata calls");
    }
  });

  it("requires the DB-recorded provider retry 503 followed by an authentic 202", () => {
    const missingRetry = attestation();
    missingRetry.runtimeReceipt.initialResponseStatus = 202;
    expect(() => verifyRealBlockSlaDatabaseAttestation(
      resign(missingRetry),
      expected,
    )).toThrow("durable queue ordering");

    const missingSuccess = attestation();
    missingSuccess.runtimeReceipt.duplicateResponseStatus = 503;
    expect(() => verifyRealBlockSlaDatabaseAttestation(
      resign(missingSuccess),
      expected,
    )).toThrow("durable queue ordering");
  });

  it("rejects a late replay that is not the bounded provider retry", () => {
    const lateRetry = attestation("2026-08-02T12:00:12.500Z");
    lateRetry.runtimeReceipt.duplicateReceivedAt = "2026-08-02T12:00:11.000Z";
    lateRetry.runtimeReceipt.duplicateAcknowledgedAt = "2026-08-02T12:00:11.001Z";
    expect(() => verifyRealBlockSlaDatabaseAttestation(resign(lateRetry), {
      ...expected,
      nowMs: Date.parse("2026-08-02T12:00:12.500Z"),
    })).toThrow("durable queue ordering");
  });

  it("rejects a recomposed JSON payload without the deployment HMAC", () => {
    const forged = structuredClone(attestation());
    forged.runtimeReceipt.marketRowCount = 2;
    expect(() => verifyRealBlockSlaDatabaseAttestation(forged, expected)).toThrow();
  });

  it("allows delayed challenge export when DB API observations met the SLA", () => {
    expect(verifyRealBlockSlaDatabaseAttestation(
      attestation("2026-08-02T12:05:00.000Z"),
      { ...expected, nowMs: Date.parse("2026-08-02T12:05:00.000Z") },
    )).toMatchObject({
      ok: true,
      deliveryToAllRequiredSurfacesVisibleMs: 300,
    });
  });

  it("rejects a delayed first DB API observation even with a valid export HMAC", () => {
    const delayed = attestation("2026-08-02T12:00:11.500Z");
    delayed.apiObservations[0]!.observedAt = "2026-08-02T12:00:11.000Z";
    delayed.apiObservations[1]!.observedAt = "2026-08-02T12:00:11.001Z";
    expect(() => verifyRealBlockSlaDatabaseAttestation(resign(delayed), {
      ...expected,
      nowMs: Date.parse("2026-08-02T12:00:11.500Z"),
    })).toThrow(
      "real block SLA evidence real-block SLA latency is invalid",
    );
  });

  it("accepts later exact heads and aggregates measured calls across metadata and markets", () => {
    const later = attestation();
    const runtime = later.runtimeReceipt;
    runtime.blockProviderAHead = "22000002";
    runtime.blockProviderAHeadHash = `0x${"61".repeat(32)}`;
    runtime.blockProviderBHead = "22000002";
    runtime.blockProviderBHeadHash = `0x${"61".repeat(32)}`;
    runtime.blockProviderCallCountA = 5;
    runtime.blockProviderCallCountB = 5;
    runtime.metadataTokenCount = 2;
    runtime.metadataProviderCallCountA = 4;
    runtime.metadataProviderCallCountB = 4;
    runtime.eventRowCount = 2;
    runtime.events = [
      {
        optimisticEventId: "00000000-0000-4000-8000-000000000023",
        payloadCommitment: `0x${"62".repeat(32)}`,
      },
      {
        optimisticEventId: "00000000-0000-4000-8000-000000000024",
        payloadCommitment: `0x${"63".repeat(32)}`,
      },
    ];
    runtime.marketRowCount = 2;
    runtime.markets[0]!.marketProviderAHead = "22000003";
    runtime.markets[0]!.marketProviderAHeadHash = `0x${"64".repeat(32)}`;
    runtime.markets[0]!.marketProviderBHead = "22000003";
    runtime.markets[0]!.marketProviderBHeadHash = `0x${"64".repeat(32)}`;
    runtime.markets[0]!.confirmations = 3;
    runtime.markets[0]!.marketProviderCallCountA = 8;
    runtime.markets[0]!.marketProviderCallCountB = 8;
    runtime.markets[0]!.totalProviderCallCountA = 25;
    runtime.markets[0]!.totalProviderCallCountB = 25;
    runtime.markets.push({
      ...runtime.markets[0]!,
      optimisticMarketStateId: "00000000-0000-4000-8000-000000000025",
      poolId: `0x${"65".repeat(32)}`,
      tokenAddress: `0x${"66".repeat(20)}`,
      evidenceCommitment: `0x${"67".repeat(32)}`,
      marketCommitment: `0x${"68".repeat(32)}`,
      marketProviderAObservedAt: "2026-08-02T12:00:00.050Z",
      marketProviderBObservedAt: "2026-08-02T12:00:00.051Z",
    });

    expect(verifyRealBlockSlaDatabaseAttestation(resign(later), expected)).toMatchObject({
      ok: true,
      databaseAttested: true,
    });
  });

  it("rejects divergent cross-provider hashes at the same later height", () => {
    const divergent = attestation();
    divergent.runtimeReceipt.blockProviderAHead = "22000001";
    divergent.runtimeReceipt.blockProviderAHeadHash = `0x${"71".repeat(32)}`;
    divergent.runtimeReceipt.blockProviderBHead = "22000001";
    divergent.runtimeReceipt.blockProviderBHeadHash = `0x${"72".repeat(32)}`;
    divergent.runtimeReceipt.blockProviderCallCountA = 5;
    divergent.runtimeReceipt.blockProviderCallCountB = 5;
    expect(() => verifyRealBlockSlaDatabaseAttestation(
      resign(divergent),
      expected,
    )).toThrow(
      "real block SLA evidence same-height block head agreement is invalid",
    );
  });

  it("rejects target-height call counts for a later provider head", () => {
    const undercounted = attestation();
    undercounted.runtimeReceipt.blockProviderAHead = "22000001";
    undercounted.runtimeReceipt.blockProviderAHeadHash = `0x${"73".repeat(32)}`;
    expect(() => verifyRealBlockSlaDatabaseAttestation(
      resign(undercounted),
      expected,
    )).toThrow(
      "real block SLA evidence block provider call count is invalid",
    );
  });

  it("rejects API bytes bound to a stale Classic release", () => {
    const stale = attestation();
    stale.apiObservations[0]!.releaseVersion = "classic-v2";
    stale.apiObservations[1]!.releaseVersion = "classic-v2";
    expect(() => verifyRealBlockSlaDatabaseAttestation(
      resign(stale),
      expected,
    )).toThrow(
      "real block SLA evidence same-market public surfaces is invalid",
    );
  });

  it("rejects a recomputed HMAC when aggregate calls omit metadata work", () => {
    const undercounted = attestation();
    undercounted.runtimeReceipt.metadataTokenCount = 1;
    undercounted.runtimeReceipt.metadataProviderCallCountA = 2;
    undercounted.runtimeReceipt.metadataProviderCallCountB = 2;
    undercounted.runtimeReceipt.eventRowCount = 1;
    undercounted.runtimeReceipt.events = [{
      optimisticEventId: "00000000-0000-4000-8000-000000000026",
      payloadCommitment: `0x${"74".repeat(32)}`,
    }];
    expect(() => verifyRealBlockSlaDatabaseAttestation(
      resign(undercounted),
      expected,
    )).toThrow(
      "real block SLA evidence aggregate provider call count is invalid",
    );
  });
});
