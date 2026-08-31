import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  privyPolicyOwnerErrorMessage,
  REVIEWED_PRIVY_POLICY_BINDINGS,
  REVIEWED_PRIVY_POLICY_BODY_SHA256,
  reviewPrivyPolicyOwnerRequest,
  signReviewedPrivyPolicyOwnerRequest,
  type PrivyPolicyOwnerOperation,
  type PrivyPolicyOwnerSession,
} from "../lib/privy-policy-owner/handoff";

const OWNER_USER = "did:privy:OwnerHandoffTestOnly";
const OTHER_USER = "did:privy:DifferentTestOwner";
const CREATED = Date.parse("2026-08-31T20:00:00.000Z");
const NOW = CREATED + 1_000;
const EXPIRES = CREATED + 30_000;
const BINDINGS = {
  appId: "cms0vmhok003f0cl93ou53auq",
  policyId: "sf86euttztysqlocsx2url2y",
  ownerId: "wtlwv5eybvh4mmj3xdqof9vw",
  conditionSetId: "urs76jlku0tb9bitkc4lxb7d",
};

// Independent Node hashing and fixture serialization exercise the browser wire
// against exact builder-derived PATCH bodies, without bypassing production pins.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonical(Reflect.get(value, key))}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function serialize(value: unknown): string {
  return `${canonical(value)}\n`;
}

function reviewedBody(operation: PrivyPolicyOwnerOperation) {
  const rules = [
    ["Mainnet", "1", "0x755509eA6e3F5Ec1aA2E797bb68f1B87DD8b886b"],
    ["Robinhood", "4663", "0xeD617CE7f82e2AB589aDeFFD319D1D872Bc8De06"],
  ].map(([network, chainId, authority]) => ({
    name: `Allow admitted ${network} permit SafeMessage`,
    method: "eth_signTypedData_v4",
    action: "ALLOW",
    conditions: [
      { field_source: "ethereum_typed_data_domain", field: "chainId", operator: "eq", value: chainId },
      { field_source: "ethereum_typed_data_domain", field: "verifyingContract", operator: "eq", value: authority },
      {
        field_source: "ethereum_typed_data_message",
        typed_data: {
          types: {
            EIP712Domain: [
              { name: "chainId", type: "uint256" },
              { name: "verifyingContract", type: "address" },
            ],
            SafeMessage: [{ name: "message", type: "bytes" }],
          },
          primary_type: "SafeMessage",
        },
        field: "message",
        operator: "in_condition_set",
        value: BINDINGS.conditionSetId,
      },
    ],
  }));
  return {
    name: "Programmable permit SafeMessage condition set v2",
    rules: operation === "reconcile" ? rules : rules.slice(0, 1),
  };
}

function fixture(
  operation: PrivyPolicyOwnerOperation = "reconcile",
  created = CREATED,
  expires = EXPIRES,
) {
  const request = {
    version: 1,
    method: "PATCH",
    url: `https://api.privy.io/v1/policies/${BINDINGS.policyId}`,
    headers: {
      "privy-app-id": BINDINGS.appId,
      "privy-request-expiry": String(expires),
    },
    body: reviewedBody(operation),
  };
  const requestBytes = new TextEncoder().encode(canonical(request));
  const artifact = {
    schemaVersion: "programmable.privy-permit-policy.app-user-request.v4",
    operation,
    bindings: { ...BINDINGS },
    ownerUserSha256: digest(`programmable.privy-policy-owner-user.v4\0${OWNER_USER}`),
    createdAt: new Date(created).toISOString(),
    expiresAt: new Date(expires).toISOString(),
    sourcePolicySha256: digest("test source policy"),
    targetPolicySha256: digest("test target policy"),
    rollbackArtifactSha256: digest("test rollback artifact"),
    requestBodySha256: digest(canonical(request.body)),
    requestBytesBase64: Buffer.from(requestBytes).toString("base64"),
    requestSha256: digest(requestBytes),
  };
  const text = serialize(artifact);
  return { request, artifact, text, requestBytes };
}

function replaceRequest(subject: ReturnType<typeof fixture>, request: unknown): string {
  const bytes = new TextEncoder().encode(canonical(request));
  return serialize({
    ...subject.artifact,
    requestBytesBase64: Buffer.from(bytes).toString("base64"),
    requestSha256: digest(bytes),
  });
}

function review(text: string, operation: PrivyPolicyOwnerOperation = "reconcile", now = NOW) {
  return reviewPrivyPolicyOwnerRequest({ text, operation, userId: OWNER_USER, nowMilliseconds: now });
}

function ownerSession(): PrivyPolicyOwnerSession {
  return { ready: true, authenticated: true, userId: OWNER_USER };
}

function signInput(subject = fixture()) {
  return {
    text: subject.text,
    operation: subject.artifact.operation,
    reviewedRequestArtifactSha256: digest(subject.text),
    readSession: ownerSession,
    now: () => NOW,
    signAuthorization: vi.fn(async () => ({ signature: "opaque.sdk-signature:v1/+=_~" })),
  };
}

describe("reviewed Privy policy owner request", () => {
  it.each(["reconcile", "rollback"] as const)("accepts only the independently reconstructed %s body", async (operation) => {
    const subject = fixture(operation);
    expect(REVIEWED_PRIVY_POLICY_BINDINGS).toEqual(BINDINGS);
    expect(subject.artifact.requestBodySha256).toBe(REVIEWED_PRIVY_POLICY_BODY_SHA256[operation]);
    const result = await review(subject.text, operation);
    expect(result.requestBytes).toEqual(subject.requestBytes);
    expect(result.requestArtifactSha256).toBe(digest(subject.text));
    expect(result.artifact).toEqual(subject.artifact);
    expect(result.request).toEqual(subject.request);
    expect(new TextDecoder().decode(result.requestBytes)).not.toMatch(/\n$/u);
  });

  it("derives the owner binding from the authenticated DID", async () => {
    await expect(reviewPrivyPolicyOwnerRequest({
      text: fixture().text, operation: "reconcile", userId: OTHER_USER, nowMilliseconds: NOW,
    })).rejects.toThrow("OWNER_HANDOFF_BINDING_MISMATCH");
  });

  it.each(["appId", "policyId", "ownerId", "conditionSetId"] as const)("rejects a different %s", async (key) => {
    const subject = fixture();
    subject.artifact.bindings[key] = "aaaaaaaaaaaaaaaaaaaaaaaa";
    await expect(review(serialize(subject.artifact))).rejects.toThrow(/OWNER_HANDOFF_BINDING/u);
  });

  it("does not treat the reviewed rollback as reconcile consent", async () => {
    await expect(review(fixture("rollback").text)).rejects.toThrow("OWNER_HANDOFF_BINDING_MISMATCH");
  });

  it("rejects an arbitrary policy even when all attacker-controlled digests are recomputed", async () => {
    const subject = fixture();
    subject.request.body.rules = [];
    subject.artifact.requestBodySha256 = digest(canonical(subject.request.body));
    const input = { ...signInput(subject), text: replaceRequest(subject, subject.request) };
    input.reviewedRequestArtifactSha256 = digest(input.text);
    await expect(signReviewedPrivyPolicyOwnerRequest(input)).rejects.toThrow("OWNER_HANDOFF_BINDING_MISMATCH");
    expect(input.signAuthorization).not.toHaveBeenCalled();
  });

  it("checks the actual request body rather than trusting its pinned digest field", async () => {
    const subject = fixture();
    subject.request.body.rules = [];
    await expect(review(replaceRequest(subject, subject.request)))
      .rejects.toThrow("OWNER_HANDOFF_REQUEST_BYTES_MISMATCH");
  });

  it.each([
    ["method", "POST"],
    ["url", "https://api.privy.io/v1/wallets/aaaaaaaaaaaaaaaaaaaaaaaa"],
  ] as const)("rejects another signed %s", async (key, value) => {
    const subject = fixture();
    subject.request[key] = value;
    await expect(review(replaceRequest(subject, subject.request)))
      .rejects.toThrow("OWNER_HANDOFF_REQUEST_BYTES_MISMATCH");
  });

  it("rejects a changed request-expiry header", async () => {
    const subject = fixture();
    subject.request.headers["privy-request-expiry"] = String(EXPIRES + 1);
    await expect(review(replaceRequest(subject, subject.request)))
      .rejects.toThrow("OWNER_HANDOFF_REQUEST_BYTES_MISMATCH");
  });

  it("rejects transport credentials and owner changes in the signed request", async () => {
    const subject = fixture();
    const request = {
      ...subject.request,
      headers: { ...subject.request.headers, authorization: "test-only-credential" },
      body: { ...subject.request.body, owner_id: "aaaaaaaaaaaaaaaaaaaaaaaa" },
    };
    await expect(review(replaceRequest(subject, request))).rejects.toThrow("OWNER_HANDOFF_FIELDS_INVALID");
  });

  it("rejects unknown artifact fields and noncanonical artifact bytes", async () => {
    const subject = fixture();
    await expect(review(serialize({ ...subject.artifact, unreviewed: true })))
      .rejects.toThrow("OWNER_HANDOFF_FIELDS_INVALID");
    await expect(review(subject.text.trimEnd())).rejects.toThrow("OWNER_HANDOFF_ARTIFACT_NON_CANONICAL");
    await expect(review(JSON.stringify(subject.artifact, null, 2) + "\n"))
      .rejects.toThrow("OWNER_HANDOFF_ARTIFACT_NON_CANONICAL");
  });

  it("rejects a signing-byte newline even with its matching digest", async () => {
    const subject = fixture();
    const bytes = new TextEncoder().encode(canonical(subject.request) + "\n");
    await expect(review(serialize({
      ...subject.artifact,
      requestBytesBase64: Buffer.from(bytes).toString("base64"),
      requestSha256: digest(bytes),
    }))).rejects.toThrow("OWNER_HANDOFF_REQUEST_BYTES_MISMATCH");
  });

  it.each([
    ["expired", CREATED, EXPIRES, EXPIRES],
    ["future", CREATED, EXPIRES, CREATED - 1],
    ["extended", CREATED, EXPIRES + 1, NOW],
    ["shortened", CREATED, EXPIRES - 1, NOW],
    ["fractional clock", CREATED, EXPIRES, NOW + 0.5],
  ] as const)("rejects %s request timing", async (_name, created, expires, now) => {
    await expect(review(fixture("reconcile", created, expires).text, "reconcile", now))
      .rejects.toThrow("OWNER_HANDOFF_REQUEST_EXPIRED_OR_CLOCK_INVALID");
  });

  it("accepts the last millisecond but never extends the original expiry", async () => {
    const result = await review(fixture().text, "reconcile", EXPIRES - 1);
    expect(result.request.headers).toEqual({
      "privy-app-id": BINDINGS.appId, "privy-request-expiry": String(EXPIRES),
    });
  });
});

describe("explicit policy owner signing", () => {
  it.each(["reconcile", "rollback"] as const)("passes original %s bytes and preserves the opaque SDK signature", async (operation) => {
    const subject = fixture(operation);
    const input = signInput(subject);
    const text = await signReviewedPrivyPolicyOwnerRequest(input);
    expect(input.signAuthorization).toHaveBeenCalledExactlyOnceWith(subject.requestBytes);
    expect(text).toBe(serialize({
      schemaVersion: "programmable.privy-permit-policy.app-user-signature.v4",
      requestArtifactSha256: digest(subject.text),
      requestSha256: subject.artifact.requestSha256,
      authorizationSignature: "opaque.sdk-signature:v1/+=_~",
    }));
  });

  it("requires consent for the exact imported artifact, not just an equivalent policy", async () => {
    const subject = fixture();
    const input = signInput(subject);
    subject.artifact.rollbackArtifactSha256 = digest("different rollback artifact");
    input.text = serialize(subject.artifact);
    await expect(signReviewedPrivyPolicyOwnerRequest(input)).rejects.toThrow("OWNER_HANDOFF_REVIEW_CHANGED");
    expect(input.signAuthorization).not.toHaveBeenCalled();
  });

  it.each([
    { ready: false, authenticated: true, userId: OWNER_USER },
    { ready: true, authenticated: false, userId: OWNER_USER },
    { ready: true, authenticated: true, userId: null },
  ])("rejects a missing ready authenticated session before signing: %j", async (session) => {
    const input = { ...signInput(), readSession: () => session };
    await expect(signReviewedPrivyPolicyOwnerRequest(input)).rejects.toThrow("OWNER_HANDOFF_SESSION_CHANGED");
    expect(input.signAuthorization).not.toHaveBeenCalled();
  });

  it("rejects a valid but different owner session before signing", async () => {
    const input = { ...signInput(), readSession: () => ({ ...ownerSession(), userId: OTHER_USER }) };
    await expect(signReviewedPrivyPolicyOwnerRequest(input)).rejects.toThrow("OWNER_HANDOFF_BINDING_MISMATCH");
    expect(input.signAuthorization).not.toHaveBeenCalled();
  });

  it("rechecks session identity after asynchronous validation", async () => {
    const input = {
      ...signInput(),
      readSession: vi.fn().mockReturnValueOnce(ownerSession()).mockReturnValue({ ...ownerSession(), userId: OTHER_USER }),
    };
    await expect(signReviewedPrivyPolicyOwnerRequest(input)).rejects.toThrow("OWNER_HANDOFF_SESSION_CHANGED");
    expect(input.signAuthorization).not.toHaveBeenCalled();
  });

  it("rechecks expiry after asynchronous validation before invoking the SDK", async () => {
    const input = { ...signInput(), now: vi.fn().mockReturnValueOnce(NOW).mockReturnValue(EXPIRES) };
    await expect(signReviewedPrivyPolicyOwnerRequest(input))
      .rejects.toThrow("OWNER_HANDOFF_REQUEST_EXPIRED_OR_CLOCK_INVALID");
    expect(input.signAuthorization).not.toHaveBeenCalled();
  });

  it("does not release a signature when the session changes while awaiting the SDK", async () => {
    let session = ownerSession();
    const input = {
      ...signInput(),
      readSession: () => session,
      signAuthorization: vi.fn(async () => {
        session = { ...session, userId: OTHER_USER };
        return { signature: "test-only-signature" };
      }),
    };
    await expect(signReviewedPrivyPolicyOwnerRequest(input)).rejects.toThrow("OWNER_HANDOFF_SESSION_CHANGED");
    expect(input.signAuthorization).toHaveBeenCalledTimes(1);
  });

  it("does not release a signature that expires while awaiting the SDK", async () => {
    let now = NOW;
    const input = {
      ...signInput(),
      now: () => now,
      signAuthorization: vi.fn(async () => {
        now = EXPIRES;
        return { signature: "test-only-signature" };
      }),
    };
    await expect(signReviewedPrivyPolicyOwnerRequest(input))
      .rejects.toThrow("OWNER_HANDOFF_REQUEST_EXPIRED_OR_CLOCK_INVALID");
    expect(input.signAuthorization).toHaveBeenCalledTimes(1);
  });

  it.each(["", "line\r\nbreak", "has space", "\u007f", "é", "a".repeat(8_193)])(
    "rejects an unsafe or oversized opaque signature (case %#)", async (signature) => {
      const input = { ...signInput(), signAuthorization: vi.fn(async () => ({ signature })) };
      await expect(signReviewedPrivyPolicyOwnerRequest(input))
        .rejects.toThrow("OWNER_HANDOFF_SIGNATURE_BINDING_INVALID");
    },
  );

  it("accepts the documented maximum safe opaque signature without rewriting it", async () => {
    const signature = "a".repeat(8_192);
    const input = { ...signInput(), signAuthorization: vi.fn(async () => ({ signature })) };
    const result = JSON.parse(await signReviewedPrivyPolicyOwnerRequest(input));
    expect(result.authorizationSignature).toBe(signature);
  });

  it("does not expose raw provider errors or request/session material in UI errors", () => {
    const sensitive = "test-only-session-token-and-request";
    for (const error of [new Error(sensitive), { message: sensitive }, sensitive, new Error(`OWNER_HANDOFF_${sensitive}`)]) {
      const message = privyPolicyOwnerErrorMessage(error);
      expect(message).not.toContain(sensitive);
      expect(message).toMatch(/request|file/u);
    }
    expect(privyPolicyOwnerErrorMessage(new Error("OWNER_HANDOFF_REQUEST_EXPIRED_OR_CLOCK_INVALID")))
      .toContain("fresh 30 second request");
  });
});
