import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import Ajv from "ajv";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

// @ts-expect-error Operational JavaScript modules intentionally have no declarations.
import * as realBlockSlaGate from "../../scripts/perf/read-model-real-block-sla-gate.mjs";

const {
  commitRealBlockSlaEvidence,
  databaseBundleEvidenceCommitment,
  queueRowEvidenceCommitment,
  REAL_BLOCK_SLA_EVIDENCE_KIND,
  realBlockSlaGateArgumentsFrom,
  verifyRealBlockSlaEvidence,
} = realBlockSlaGate;

const COMMIT = "a".repeat(40);
const DEPLOYMENT_ID = "dpl_aaaaaaaaaaaaaaaaaaaaaaaa";
const TARGET = "https://programmable-real-block-abc.vercel.app";
const BLOCK = "22000000";
const BLOCK_HASH = `0x${"11".repeat(32)}`;
const MARKET_COMMITMENT = `0x${"22".repeat(32)}`;
const TOKEN_ADDRESS = `0x${"12".repeat(20)}`;
const NOW = Date.parse("2026-08-02T12:00:08.500Z");

function provider(providerId: "drpc" | "quicknode") {
  const drpc = providerId === "drpc";
  return {
    providerId,
    providerDeploymentId: drpc
      ? "11111111-1111-4111-8111-111111111111"
      : "22222222-2222-4222-8222-222222222222",
    endpointHost: drpc
      ? "lb.drpc.live"
      : "hidden-name.quiknode.pro",
    endpointUrlSha256: drpc
      ? `0x${"33".repeat(32)}`
      : `0x${"44".repeat(32)}`,
    blockEvidenceHead: {
      blockNumber: drpc ? "22000001" : "22000002",
      blockHash: drpc
        ? `0x${"55".repeat(32)}`
        : `0x${"66".repeat(32)}`,
      observedAt: "2026-08-02T12:00:06.500Z",
    },
    marketStateHead: {
      blockNumber: drpc ? "22000002" : "22000003",
      blockHash: drpc
        ? `0x${"12".repeat(32)}`
        : `0x${"13".repeat(32)}`,
      observedAt: "2026-08-02T12:00:07.500Z",
    },
    blockEvidenceCallCount: 4,
    marketStateCallCount: 7,
    totalCallCount: 11,
  };
}

function payload() {
  const queue = {
    wakeId: "91",
    blockNumber: BLOCK,
    nonceDigest: `0x${"77".repeat(32)}`,
    payloadSha256: `0x${"88".repeat(32)}`,
    enqueued: true,
    persistedAt: "2026-08-02T12:00:05.700Z",
    rowCommitment: "",
    response: {
      status: 202,
      sentAt: "2026-08-02T12:00:05.800Z",
      cacheControl: "no-store",
    },
    duplicate: {
      receivedAt: "2026-08-02T12:00:08.100Z",
      responseStatus: 202,
      enqueued: false,
      wakeId: "91",
      queueRowCountBefore: 1,
      queueRowCountAfter: 1,
      secondJobCreated: false,
    },
  };
  queue.rowCommitment = queueRowEvidenceCommitment(queue);
  const optimisticDatabase = {
    transactionCommittedAt: "2026-08-02T12:00:05.950Z",
    chainHead: {
      chainId: 1,
      blockNumber: BLOCK,
      blockHash: BLOCK_HASH,
      generation: "4",
    },
    blockEvidence: {
      blockNumber: BLOCK,
      blockHash: BLOCK_HASH,
      evidenceCommitment: `0x${"99".repeat(32)}`,
    },
    eventEvidence: {
      blockNumber: BLOCK,
      blockHash: BLOCK_HASH,
      rowCount: 0,
      evidenceCommitment: `0x${"aa".repeat(32)}`,
    },
    marketEvidence: {
      blockNumber: BLOCK,
      blockHash: BLOCK_HASH,
      rowCount: 1,
      evidenceCommitment: MARKET_COMMITMENT,
    },
    bundleEvidenceCommitment: "",
  };
  optimisticDatabase.bundleEvidenceCommitment =
    databaseBundleEvidenceCommitment(optimisticDatabase);
  return {
    kind: REAL_BLOCK_SLA_EVIDENCE_KIND,
    schemaVersion: 1,
    repositoryCommit: COMMIT,
    capturedAt: "2026-08-02T12:00:08.500Z",
    deployment: {
      id: DEPLOYMENT_ID,
      url: TARGET,
      projectId: "prj_programmable_test",
      readyState: "READY",
      repositoryCommit: COMMIT,
    },
    activity: {
      kind: "organic-stream-block",
      signingPerformed: false,
      spendingPerformed: false,
    },
    quickNodeDelivery: {
      deliveryId: "delivery:organic:91",
      streamId: "stream_mainnet_blocks",
      nonceDigest: queue.nonceDigest,
      payloadSha256: queue.payloadSha256,
      chainId: 1,
      blockNumber: BLOCK,
      blockHash: BLOCK_HASH,
      blockTimestamp: "2026-08-02T12:00:00.000Z",
      signedAt: "2026-08-02T12:00:05.000Z",
      requestReceivedAt: "2026-08-02T12:00:05.500Z",
    },
    queue,
    dualRpc: {
      block: {
        chainId: 1,
        blockNumber: BLOCK,
        blockHash: BLOCK_HASH,
        parentHash: `0x${"bb".repeat(32)}`,
        blockTimestamp: "2026-08-02T12:00:00.000Z",
        logsCommitment: `0x${"cc".repeat(32)}`,
      },
      drpc: provider("drpc"),
      quicknode: provider("quicknode"),
    },
    optimisticDatabase,
    api: {
      firstVisibleAt: "2026-08-02T12:00:08.000Z",
      observations: [
        {
          url: `${TARGET}/api/explore/token?address=${TOKEN_ADDRESS}`,
          surface: "explore-token",
          tokenAddress: TOKEN_ADDRESS,
          releaseVersion: "classic-v3",
          status: 200,
          cacheControl: "no-store",
          source: "dual-rpc-head",
          finality: "optimistic",
          chainId: 1,
          blockNumber: BLOCK,
          blockHash: BLOCK_HASH,
          confirmations: 2,
          marketEvidenceCommitment: MARKET_COMMITMENT,
          responseSha256: `0x${"dd".repeat(32)}`,
          observedAt: "2026-08-02T12:00:08.000Z",
        },
        {
          url: `${TARGET}/api/explore/token/chart?address=${TOKEN_ADDRESS}&range=1h`,
          surface: "classic-chart",
          tokenAddress: TOKEN_ADDRESS,
          releaseVersion: "classic-v3",
          status: 200,
          cacheControl: "no-store",
          source: "dual-rpc-head",
          finality: "optimistic",
          chainId: 1,
          blockNumber: BLOCK,
          blockHash: BLOCK_HASH,
          confirmations: 2,
          marketEvidenceCommitment: MARKET_COMMITMENT,
          responseSha256: `0x${"de".repeat(32)}`,
          observedAt: "2026-08-02T12:00:08.050Z",
        },
      ],
    },
    sla: {
      maximumDeliveryToFirstVisibleMs: 10_000,
      deliveryToFirstVisibleMs: 2_500,
      deliveryToAllRequiredSurfacesVisibleMs: 2_550,
    },
  };
}

function evidence() {
  return commitRealBlockSlaEvidence(payload());
}

function expected() {
  return {
    expectedRepositoryCommit: COMMIT,
    expectedDeploymentId: DEPLOYMENT_ID,
    expectedTargetUrl: TARGET,
    nowMs: NOW,
  };
}

function mutateAndRecommit(
  mutate: (candidate: ReturnType<typeof payload>) => void,
) {
  const candidate = structuredClone(payload());
  mutate(candidate);
  candidate.queue.rowCommitment = queueRowEvidenceCommitment(candidate.queue);
  candidate.optimisticDatabase.bundleEvidenceCommitment =
    databaseBundleEvidenceCommitment(candidate.optimisticDatabase);
  return commitRealBlockSlaEvidence(candidate);
}

describe("real block SLA release gate", () => {
  it("accepts exact organic QuickNode to optimistic API evidence", () => {
    expect(verifyRealBlockSlaEvidence(evidence(), expected())).toMatchObject({
      ok: true,
      repositoryCommit: COMMIT,
      deploymentId: DEPLOYMENT_ID,
      targetOrigin: TARGET,
      deliveryId: "delivery:organic:91",
      blockNumber: BLOCK,
      blockHash: BLOCK_HASH,
      confirmations: 2,
      deliveryToFirstVisibleMs: 2_500,
      deliveryToAllRequiredSurfacesVisibleMs: 2_550,
    });
  });

  it("matches the committed JSON evidence schema", () => {
    const schema = JSON.parse(
      readFileSync(
        resolve("config/read-model-real-block-sla-evidence.schema.json"),
        "utf8",
      ),
    );
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    expect(validate(evidence()), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects tampered and unknown evidence fields", () => {
    const tampered = evidence();
    tampered.sla.deliveryToFirstVisibleMs = 1;
    expect(() => verifyRealBlockSlaEvidence(tampered, expected())).toThrow(
      "top-level commitment",
    );

    const smuggled = mutateAndRecommit((candidate) => {
      Object.assign(candidate.quickNodeDelivery, { signature: "do-not-log" });
    });
    expect(() => verifyRealBlockSlaEvidence(smuggled, expected())).toThrow(
      "delivery is invalid",
    );
  });

  it.each([
    ["repository commit", (candidate: ReturnType<typeof payload>) => {
      candidate.repositoryCommit = "b".repeat(40);
    }],
    ["deployment ID", (candidate: ReturnType<typeof payload>) => {
      candidate.deployment.id = "dpl_bbbbbbbbbbbbbbbbbbbbbbbb";
    }],
    ["deployment origin", (candidate: ReturnType<typeof payload>) => {
      candidate.deployment.url = "https://programmable-other.vercel.app";
    }],
  ])("rejects a mismatched %s binding", (_label, mutate) => {
    expect(() =>
      verifyRealBlockSlaEvidence(mutateAndRecommit(mutate), expected())
    ).toThrow();
  });

  it("rejects stale, future and non-organic delivery evidence", () => {
    const stale = mutateAndRecommit((candidate) => {
      candidate.quickNodeDelivery.signedAt = "2026-08-02T11:50:00.000Z";
    });
    expect(() => verifyRealBlockSlaEvidence(stale, expected())).toThrow(
      "delivery freshness",
    );

    const future = mutateAndRecommit((candidate) => {
      candidate.quickNodeDelivery.blockTimestamp = "2026-08-02T12:01:00.000Z";
      candidate.dualRpc.block.blockTimestamp = "2026-08-02T12:01:00.000Z";
    });
    expect(() => verifyRealBlockSlaEvidence(future, expected())).toThrow(
      "delivery freshness",
    );

    const staleProvider = mutateAndRecommit((candidate) => {
      candidate.dualRpc.drpc.blockEvidenceHead.observedAt =
        "2026-08-02T11:59:00.000Z";
    });
    expect(() => verifyRealBlockSlaEvidence(staleProvider, expected())).toThrow(
      "provider observation freshness",
    );

    const authOnly = mutateAndRecommit((candidate) => {
      candidate.activity.kind = "auth-only-canary";
    });
    expect(() => verifyRealBlockSlaEvidence(authOnly, expected())).toThrow(
      "organic activity",
    );
  });

  it("requires durable persistence before the 202 response", () => {
    const invalid = mutateAndRecommit((candidate) => {
      candidate.queue.persistedAt = "2026-08-02T12:00:05.900Z";
    });
    expect(() => verifyRealBlockSlaEvidence(invalid, expected())).toThrow(
      "persisted-before-202",
    );
  });

  it("requires the duplicate nonce to reuse one queue row without a second job", () => {
    const invalid = mutateAndRecommit((candidate) => {
      candidate.queue.duplicate.enqueued = true;
      candidate.queue.duplicate.queueRowCountAfter = 2;
      candidate.queue.duplicate.secondJobCreated = true;
    });
    expect(() => verifyRealBlockSlaEvidence(invalid, expected())).toThrow(
      "duplicate nonce proof",
    );
  });

  it("rejects provider drift, disagreement and confirmation 12", () => {
    const callDrift = mutateAndRecommit((candidate) => {
      candidate.dualRpc.quicknode.totalCallCount = 10;
    });
    expect(() => verifyRealBlockSlaEvidence(callDrift, expected())).toThrow(
      "quicknode call count",
    );

    const disagreement = mutateAndRecommit((candidate) => {
      candidate.dualRpc.quicknode.marketStateHead.blockNumber = "22000002";
      candidate.dualRpc.quicknode.marketStateHead.blockHash =
        candidate.dualRpc.quicknode.blockEvidenceHead.blockHash;
    });
    expect(() => verifyRealBlockSlaEvidence(disagreement, expected())).toThrow(
      "provider independence",
    );

    const safe = mutateAndRecommit((candidate) => {
      candidate.dualRpc.drpc.marketStateHead.blockNumber = "22000012";
      candidate.dualRpc.quicknode.marketStateHead.blockNumber = "22000012";
      candidate.dualRpc.quicknode.marketStateHead.blockHash =
        candidate.dualRpc.drpc.marketStateHead.blockHash;
      candidate.api.observations[0]!.confirmations = 11;
    });
    expect(() => verifyRealBlockSlaEvidence(safe, expected())).toThrow(
      "drpc market state confirmations",
    );
  });

  it("requires exact optimistic DB and API commitments", () => {
    const noMarket = mutateAndRecommit((candidate) => {
      candidate.optimisticDatabase.marketEvidence.rowCount = 0;
    });
    expect(() => verifyRealBlockSlaEvidence(noMarket, expected())).toThrow(
      "database market row count",
    );

    const wrongApiCommitment = mutateAndRecommit((candidate) => {
      candidate.api.observations[0]!.marketEvidenceCommitment =
        `0x${"ee".repeat(32)}`;
    });
    expect(() =>
      verifyRealBlockSlaEvidence(wrongApiCommitment, expected())
    ).toThrow("API observation 0");
  });

  it("binds first-visible to the earliest real API observation", () => {
    const forged = mutateAndRecommit((candidate) => {
      candidate.api.firstVisibleAt = "2026-08-02T12:00:07.000Z";
      candidate.sla.deliveryToFirstVisibleMs = 1_500;
    });
    expect(() => verifyRealBlockSlaEvidence(forged, expected())).toThrow(
      "required API surfaces",
    );
  });

  it("allows only one Classic token surface and its Classic chart", () => {
    const arbitraryApi = mutateAndRecommit((candidate) => {
      candidate.api.observations[1]!.url =
        `${TARGET}/api/ops/health?address=${TOKEN_ADDRESS}&range=1h`;
    });
    expect(() => verifyRealBlockSlaEvidence(arbitraryApi, expected())).toThrow(
      "API observation 1 URL",
    );

    const duplicate = mutateAndRecommit((candidate) => {
      candidate.api.observations[1]!.surface = "explore-token";
      candidate.api.observations[1]!.url = candidate.api.observations[0]!.url;
    });
    expect(() => verifyRealBlockSlaEvidence(duplicate, expected())).toThrow(
      "duplicate API observation URL",
    );

    const differentToken = mutateAndRecommit((candidate) => {
      candidate.api.observations[1]!.tokenAddress = `0x${"13".repeat(20)}`;
      candidate.api.observations[1]!.url =
        `${TARGET}/api/explore/token/chart?address=${candidate.api.observations[1]!.tokenAddress}&range=1h`;
    });
    expect(() => verifyRealBlockSlaEvidence(differentToken, expected())).toThrow(
      "required API surfaces",
    );
  });

  it("fails when the required chart surface exceeds ten seconds", () => {
    const slow = mutateAndRecommit((candidate) => {
      candidate.api.observations[1]!.observedAt = "2026-08-02T12:00:16.000Z";
      candidate.queue.duplicate.receivedAt = "2026-08-02T12:00:16.100Z";
      candidate.capturedAt = "2026-08-02T12:00:16.500Z";
      candidate.sla.deliveryToAllRequiredSurfacesVisibleMs = 10_500;
    });
    expect(() =>
      verifyRealBlockSlaEvidence(slow, {
        ...expected(),
        nowMs: Date.parse("2026-08-02T12:00:16.500Z"),
      })
    ).toThrow("latency SLA");
  });

  it("rejects archived evidence at the live release gate", () => {
    expect(() =>
      verifyRealBlockSlaEvidence(evidence(), {
        ...expected(),
        nowMs: NOW + 10 * 60 * 1_000 + 1,
      })
    ).toThrow("capture freshness");
  });

  it("parses only the exact release-gate argument set", () => {
    expect(
      realBlockSlaGateArgumentsFrom([
        "--evidence",
        "/tmp/evidence.json",
        "--expected-commit",
        COMMIT,
        "--deployment-id",
        DEPLOYMENT_ID,
        "--target-url",
        TARGET,
      ]),
    ).toEqual({
      evidencePath: "/tmp/evidence.json",
      expectedRepositoryCommit: COMMIT,
      expectedDeploymentId: DEPLOYMENT_ID,
      expectedTargetUrl: TARGET,
    });
    expect(() =>
      realBlockSlaGateArgumentsFrom([
        "--evidence",
        "/tmp/evidence.json",
        "--allow-auth-only",
        "true",
      ])
    ).toThrow("usage");
  });
});
