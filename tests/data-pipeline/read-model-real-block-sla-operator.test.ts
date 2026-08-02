import { mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error Operational JavaScript modules intentionally have no declarations.
import * as realBlockSlaOperator from "../../scripts/perf/read-model-real-block-sla-operator.mjs";

const {
  REAL_BLOCK_SLA_OPERATOR_MAXIMUM_WAIT_MS,
  realBlockSlaOperatorArgumentsFrom,
  runRealBlockSlaOperator,
  writeRealBlockSlaEvidenceExclusive,
} = realBlockSlaOperator;

const TARGET_URL = "https://programmable-candidate-abc.vercel.app";
const DEPLOYMENT_ID = "dpl_aaaaaaaaaaaaaaaaaaaaaaaa";
const COMMIT = "a".repeat(40);
const PROJECT_ID = "prj_programmable";
const STREAM_ID = "programmable-mainnet-head";
const PROBE_TOKEN = "performance-probe-secret-at-least-32-bytes";
const BYPASS_SECRET = "automation-bypass-secret";
const ARM_ID = "00000000-0000-4000-8000-000000000019";
const CHALLENGE = `0x${"55".repeat(32)}`;

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })
  ));
});

function privateJson(value: object, status: number) {
  return Response.json(value, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
}

function evidence(overrides: Record<string, string> = {}) {
  return {
    challenge: CHALLENGE,
    runtimeReceipt: {
      repositoryCommit: COMMIT,
      deploymentId: DEPLOYMENT_ID,
      deploymentOrigin: TARGET_URL,
      projectId: PROJECT_ID,
      streamId: STREAM_ID,
      ...overrides,
    },
  };
}

function operatorInput(overrides: Record<string, unknown> = {}) {
  return {
    targetUrl: TARGET_URL,
    deploymentId: DEPLOYMENT_ID,
    expectedRepositoryCommit: COMMIT,
    projectId: PROJECT_ID,
    streamId: STREAM_ID,
    outputPath: "/secure/cutover/real-block-sla-attestation.json",
    probeToken: PROBE_TOKEN,
    automationBypassSecret: BYPASS_SECRET,
    randomBytesImpl: () => Buffer.alloc(32, 0x55),
    signalFactory: () => new AbortController().signal,
    ...overrides,
  };
}

describe("real-block SLA operator CLI", () => {
  it("accepts only non-secret exact deployment binding arguments", () => {
    const parsed = realBlockSlaOperatorArgumentsFrom([
      "--target-url", TARGET_URL,
      "--deployment-id", DEPLOYMENT_ID,
      "--expected-commit", COMMIT,
      "--project-id", PROJECT_ID,
      "--stream-id", STREAM_ID,
      "--output", "/secure/cutover/real-block-sla-attestation.json",
    ]);

    expect(parsed).toMatchObject({
      targetUrl: TARGET_URL,
      deploymentId: DEPLOYMENT_ID,
      expectedRepositoryCommit: COMMIT,
      projectId: PROJECT_ID,
      streamId: STREAM_ID,
      outputPath: "/secure/cutover/real-block-sla-attestation.json",
    });
    expect(() => realBlockSlaOperatorArgumentsFrom([
      "--probe-token", PROBE_TOKEN,
    ])).toThrow("usage:");
    expect(() => realBlockSlaOperatorArgumentsFrom([
      "--target-url", "https://programmable.family",
      "--deployment-id", DEPLOYMENT_ID,
      "--expected-commit", COMMIT,
      "--project-id", PROJECT_ID,
      "--stream-id", STREAM_ID,
      "--output", "/secure/cutover/real-block-sla-attestation.json",
    ])).toThrow();
  });

  it("arms once, validates the arm ID, retries bounded readiness and exports safely", async () => {
    let clock = 1_000;
    const sleep = vi.fn(async (delay: number) => { clock += delay; });
    const requests: Array<{ method: string; body: unknown; headers: Headers }> = [];
    const replies: Array<Response | Error> = [
      new TypeError("transport"),
      privateJson({ error: "retry" }, 503),
      privateJson({ armed: true, armId: ARM_ID }, 200),
      privateJson({ error: "not ready" }, 409),
      privateJson({ error: "retry" }, 503),
      privateJson(evidence(), 200),
    ];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      requests.push({
        method: init.method!,
        body: JSON.parse(String(init.body)),
        headers: new Headers(init.headers),
      });
      const reply = replies.shift()!;
      if (reply instanceof Error) throw reply;
      return reply;
    });
    const verifyEvidence = vi.fn(() => ({ ok: true }));
    const writeEvidence = vi.fn(async () =>
      "/secure/cutover/real-block-sla-attestation.json"
    );

    const result = await runRealBlockSlaOperator(operatorInput({
      fetchImpl,
      monotonicNow: () => clock,
      wallNow: () => clock,
      sleep,
      verifyEvidence,
      writeEvidence,
    }));

    expect(result).toEqual({
      ok: true,
      evidencePath: "/secure/cutover/real-block-sla-attestation.json",
    });
    expect(requests.map(({ method }) => method)).toEqual([
      "PUT", "PUT", "PUT", "POST", "POST", "POST",
    ]);
    expect(requests[2]!.body).toEqual({
      action: "arm-provider-retry",
      streamId: STREAM_ID,
    });
    expect(requests[3]!.body).toEqual({ armId: ARM_ID, challenge: CHALLENGE });
    for (const request of requests) {
      expect(request.headers.get("x-programmable-performance-probe-token"))
        .toBe(PROBE_TOKEN);
      expect(request.headers.get("x-vercel-protection-bypass")).toBe(BYPASS_SECRET);
    }
    expect(sleep).toHaveBeenCalledTimes(4);
    expect(verifyEvidence).toHaveBeenCalledWith(evidence(), {
      expectedRepositoryCommit: COMMIT,
      expectedDeploymentId: DEPLOYMENT_ID,
      expectedTargetUrl: TARGET_URL,
      nowMs: clock,
      probeToken: PROBE_TOKEN,
    });
    expect(writeEvidence).toHaveBeenCalledWith(
      "/secure/cutover/real-block-sla-attestation.json",
      evidence(),
    );
    expect(JSON.stringify(result)).not.toContain(PROBE_TOKEN);
    expect(JSON.stringify(result)).not.toContain(BYPASS_SECRET);
    expect(JSON.stringify(result)).not.toContain(ARM_ID);
    expect(JSON.stringify(result)).not.toContain(CHALLENGE);
  });

  it("fails on an invalid arm receipt or any non-retriable status", async () => {
    const invalidArmFetch = vi.fn(async () => privateJson({
      armed: true,
      armId: "not-a-uuid",
    }, 200));
    await expect(runRealBlockSlaOperator(operatorInput({
      fetchImpl: invalidArmFetch,
    }))).rejects.toThrow("operator failed");

    const forbiddenFetch = vi.fn(async () => privateJson({ error: "forbidden" }, 401));
    await expect(runRealBlockSlaOperator(operatorInput({
      fetchImpl: forbiddenFetch,
    }))).rejects.toThrow("operator failed");
    expect(forbiddenFetch).toHaveBeenCalledTimes(1);
  });

  it("rejects response cache drift and exact project or stream binding drift", async () => {
    const cachedFetch = vi.fn(async () => Response.json({
      armed: true,
      armId: ARM_ID,
    }, { headers: { "cache-control": "public, max-age=60" } }));
    await expect(runRealBlockSlaOperator(operatorInput({
      fetchImpl: cachedFetch,
    }))).rejects.toThrow("operator failed");

    const drifts: Array<Record<string, string>> = [
      { projectId: "prj_wrong" },
      { streamId: "wrong-stream" },
      { deploymentOrigin: "https://other.vercel.app" },
      { deploymentId: "dpl_bbbbbbbbbbbbbbbbbbbbbbbb" },
      { repositoryCommit: "b".repeat(40) },
    ];
    for (const drift of drifts) {
      const replies = [
        privateJson({ armed: true, armId: ARM_ID }, 200),
        privateJson(evidence(drift), 200),
      ];
      const writeEvidence = vi.fn();
      await expect(runRealBlockSlaOperator(operatorInput({
        fetchImpl: vi.fn(async () => replies.shift()!),
        verifyEvidence: vi.fn(),
        writeEvidence,
      }))).rejects.toThrow("operator failed");
      expect(writeEvidence).not.toHaveBeenCalled();
    }
  });

  it("stops retries at five minutes or less without writing evidence", async () => {
    let clock = 10_000;
    const replies = [
      privateJson({ armed: true, armId: ARM_ID }, 200),
      privateJson({ error: "not ready" }, 503),
    ];
    const writeEvidence = vi.fn();
    await expect(runRealBlockSlaOperator(operatorInput({
      fetchImpl: vi.fn(async () => replies.shift()!),
      monotonicNow: () => clock,
      sleep: vi.fn(async (delay: number) => { clock += delay; }),
      maximumWaitMs: 1_000,
      writeEvidence,
    }))).rejects.toThrow("operator failed");
    expect(clock).toBe(11_000);
    expect(writeEvidence).not.toHaveBeenCalled();

    await expect(runRealBlockSlaOperator(operatorInput({
      maximumWaitMs: REAL_BLOCK_SLA_OPERATOR_MAXIMUM_WAIT_MS + 1,
    }))).rejects.toThrow("operator failed");
  });

  it("never accepts a null challenge", async () => {
    const fetchImpl = vi.fn(async () => privateJson({
      armed: true,
      armId: ARM_ID,
    }, 200));
    const writeEvidence = vi.fn();
    await expect(runRealBlockSlaOperator(operatorInput({
      fetchImpl,
      randomBytesImpl: () => Buffer.alloc(32),
      writeEvidence,
    }))).rejects.toThrow("operator failed");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(writeEvidence).not.toHaveBeenCalled();
  });

  it("creates evidence exclusively with mode 0600 and never overwrites", async () => {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), "programmable-sla-operator-")),
    );
    temporaryDirectories.push(directory);
    const output = join(directory, "evidence.json");
    const value = evidence();

    await expect(writeRealBlockSlaEvidenceExclusive(output, value))
      .resolves.toBe(output);
    expect((await stat(output)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(output, "utf8"))).toEqual(value);
    await expect(writeRealBlockSlaEvidenceExclusive(output, { replacement: true }))
      .rejects.toThrow();
    expect(JSON.parse(await readFile(output, "utf8"))).toEqual(value);
  });
});
