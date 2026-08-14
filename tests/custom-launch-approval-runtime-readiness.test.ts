import {
  createHash,
  generateKeyPairSync,
  sign,
} from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  APPROVAL_DESCRIPTOR_AUDIENCE_V2,
  APPROVAL_RUNTIME_AGGREGATE_AUDIENCE_V1,
  APPROVAL_RUNTIME_AGGREGATE_PATH_V1,
  assertApprovalRuntimeAggregateReadinessV1,
  verifyAggregateReadinessEnvelope,
  type ExpectedApprovalRuntimeAggregateBindingV1,
} from "../lib/server/custom-launch/approval-runtime-readiness-v1";
import { canonicalizeJson } from
  "../lib/server/projection-target/canonical-json";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeySpki = publicKey.export({ format: "der", type: "spki" });
const publicKeySpkiBase64Url = publicKeySpki.toString("base64url");
const publicKeySpkiSha256 = `sha256:${createHash("sha256")
  .update(publicKeySpki)
  .digest("hex")}` as const;
const NOW = new Date("2026-08-13T12:00:00.000Z");

const expected: ExpectedApprovalRuntimeAggregateBindingV1 = Object.freeze({
  packageArtifactHash: `sha256:${"1".repeat(64)}`,
  sourceCommit: "2".repeat(40),
  sourceTree: "3".repeat(40),
  reviewAuthorityMode: "autonomous_ai",
  policyCommitment: `0x${"4".repeat(64)}`,
  acceptanceSchemaSha256: `sha256:${"5".repeat(64)}`,
  descriptorAuthority: Object.freeze({
    audience: APPROVAL_DESCRIPTOR_AUDIENCE_V2,
    keyId: "registry-projection-delivery",
    keyEpoch: "7",
    publicKeySpkiSha256: `sha256:${"6".repeat(64)}`,
  }),
  readinessAuthority: Object.freeze({
    algorithm: "ed25519",
    keyId: "approval-runtime-aggregate",
    keyEpoch: "3",
    publicKeySpkiBase64Url,
    publicKeySpkiSha256,
  }),
  services: Object.freeze([
    Object.freeze({
      serviceId: "autonomous-authority",
      deploymentId: "fly-machine-autonomous-v1",
      imageDigest: `sha256:${"7".repeat(64)}`,
      configurationBindingHash: `sha256:${"8".repeat(64)}`,
      status: "ready",
    }),
    Object.freeze({
      serviceId: "manual-authority",
      deploymentId: "fly-machine-manual-v1",
      imageDigest: `sha256:${"9".repeat(64)}`,
      configurationBindingHash: `sha256:${"a".repeat(64)}`,
      status: "ready",
    }),
  ]),
});

function signedEnvelope(challenge: string, mutate?: (core: Record<string, unknown>) => void) {
  const core: Record<string, unknown> = {
    schemaVersion: "programmable.approval-runtime-aggregate-readiness.v1",
    audience: APPROVAL_RUNTIME_AGGREGATE_AUDIENCE_V1,
    challengeBase64Url: challenge,
    checkedAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 30_000).toISOString(),
    status: "ready",
    release: {
      packageArtifactHash: expected.packageArtifactHash,
      sourceCommit: expected.sourceCommit,
      sourceTree: expected.sourceTree,
      reviewAuthorityMode: expected.reviewAuthorityMode,
      policyCommitment: expected.policyCommitment,
      acceptanceSchemaSha256: expected.acceptanceSchemaSha256,
    },
    descriptorAuthority: expected.descriptorAuthority,
    readinessAuthority: expected.readinessAuthority,
    services: expected.services,
  };
  mutate?.(core);
  const signature = sign(null, Buffer.from(canonicalizeJson({
    schemaVersion:
      "programmable.approval-runtime-aggregate-readiness-signature.v1",
    payload: core,
  }), "utf8"), privateKey).toString("base64url");
  return canonicalizeJson({ ...core, signatureBase64Url: signature });
}

describe("Approval runtime aggregate readiness contract", () => {
  it("accepts only a fresh challenge-bound signed exact release and service set", () => {
    const challenge = Buffer.alloc(32, 1).toString("base64url");
    expect(() => verifyAggregateReadinessEnvelope(
      signedEnvelope(challenge),
      challenge,
      expected,
      NOW,
    )).not.toThrow();
  });

  it("fetches only the exact aggregate route and binds its generated challenge", async () => {
    const serviceFetch = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe(APPROVAL_RUNTIME_AGGREGATE_PATH_V1);
      expect(url.searchParams.get("audience"))
        .toBe(APPROVAL_RUNTIME_AGGREGATE_AUDIENCE_V1);
      const challenge = url.searchParams.get("challenge")!;
      return new Response(signedEnvelope(challenge), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    await expect(assertApprovalRuntimeAggregateReadinessV1({
      origin: new URL("https://approval-readiness.programmable.example"),
      expected,
      serviceFetch,
      now: () => NOW,
    })).resolves.toBeUndefined();
    expect(serviceFetch).toHaveBeenCalledOnce();
  });

  it.each([
    ["replayed challenge", (core: Record<string, unknown>) => {
      core.challengeBase64Url = Buffer.alloc(32, 2).toString("base64url");
    }],
    ["release drift", (core: Record<string, unknown>) => {
      core.release = { ...(core.release as object), packageArtifactHash: `sha256:${"f".repeat(64)}` };
    }],
    ["policy drift", (core: Record<string, unknown>) => {
      core.release = { ...(core.release as object), policyCommitment: `0x${"f".repeat(64)}` };
    }],
    ["descriptor key drift", (core: Record<string, unknown>) => {
      core.descriptorAuthority = {
        ...(core.descriptorAuthority as object),
        keyEpoch: "8",
      };
    }],
    ["service image drift", (core: Record<string, unknown>) => {
      const services = [...(core.services as readonly Record<string, unknown>[])];
      services[0] = { ...services[0], imageDigest: `sha256:${"f".repeat(64)}` };
      core.services = services;
    }],
    ["expired attestation", (core: Record<string, unknown>) => {
      core.checkedAt = new Date(NOW.getTime() - 90_000).toISOString();
      core.expiresAt = new Date(NOW.getTime() - 30_000).toISOString();
    }],
  ])("rejects %s even when the response is freshly signed", (_label, mutate) => {
    const challenge = Buffer.alloc(32, 1).toString("base64url");
    expect(() => verifyAggregateReadinessEnvelope(
      signedEnvelope(challenge, mutate),
      challenge,
      expected,
      NOW,
    )).toThrow();
  });

  it("rejects a substituted readiness signature", () => {
    const challenge = Buffer.alloc(32, 1).toString("base64url");
    const parsed = JSON.parse(signedEnvelope(challenge));
    parsed.signatureBase64Url = Buffer.alloc(64, 9).toString("base64url");
    expect(() => verifyAggregateReadinessEnvelope(
      canonicalizeJson(parsed),
      challenge,
      expected,
      NOW,
    )).toThrow(/signature/u);
  });
});
