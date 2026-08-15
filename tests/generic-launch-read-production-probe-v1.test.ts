import { createHash, generateKeyPairSync } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  GENERIC_LAUNCH_READ_STAGE_PROBE_PATH_V1,
  GENERIC_LAUNCH_READ_STAGE_PROBE_EXPECTED_ENV_V1,
  GENERIC_LAUNCH_READ_STAGE_PROBE_REQUEST_SCHEMA_V1,
  GENERIC_LAUNCH_READ_STAGE_PROBE_SECRET_ENV_V1,
  handleProductionGenericLaunchReadStageProbeV1,
} from "../lib/server/custom-launch/generic-launch-read-production-probe-v1";
import type {
  GenericLaunchReadProbeSignerV1,
} from "../lib/server/custom-launch/generic-launch-read-signer-v2";
import {
  createActiveGenericLaunchReadBindingV2,
  GENERIC_LAUNCH_DETAIL_PATH_TEMPLATE_V2,
  GENERIC_LAUNCH_FEED_PATH_V2,
} from "../lib/server/custom-launch/generic-launch-read-v2";
import { canonicalizeJson, type JsonValue } from
  "../lib/server/projection-target/canonical-json";
import { canonicalSha256, type Sha256Digest } from
  "../lib/server/projection-target/hashing";

const NOW = "2026-08-14T00:00:00.000Z";
const SECRET = "stage-probe-secret-that-is-never-returned";
const MACHINE = "abcdef12345678";

describe("Generic launch read production stage probe", () => {
  it("binds the exact immutable Vercel stage, request and public signer evidence", async () => {
    const harness = probeHarness();
    let observedMachine = "";
    const response = await handleProductionGenericLaunchReadStageProbeV1(
      probeRequest(SECRET, "https://exact-stage.vercel.app", harness.requestBody),
      {
        environment: harness.environment,
        createProbeSigner: async () => Object.freeze({
          ...harness.signer,
          async signWithEvidence(
            input: Parameters<GenericLaunchReadProbeSignerV1["signWithEvidence"]>[0],
          ) {
            observedMachine = input.targetMachineId;
            return await harness.signer.signWithEvidence(input);
          },
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(observedMachine).toBe(MACHINE);
    const body = await response.json() as Readonly<{
      [key: string]: unknown;
      deployment: Readonly<Record<string, unknown>>;
      signerBinding: Readonly<Record<string, unknown>>;
      providerResponse: Readonly<{
        schemaVersion: string;
        providerReceipt: Readonly<{ observedAt: string; expiresAt: string }>;
      }>;
      signedEnvelope: Readonly<{
        payload: Readonly<{
          request: unknown;
          workloadIdentity: unknown;
          deployment: unknown;
        }>;
      }>;
      workloadIdentity: unknown;
      observedAt: string;
      expiresAt: string;
      providerResponseSha256: string;
    }>;
    expect(Object.keys(body).sort()).toEqual([
      "activationBindingHash", "deployment", "expiresAt",
      "genericBindingSha256", "genericImageDigest", "genericSignRequestSha256",
      "nonceSha256", "observedAt", "operationId", "providerResponse",
      "providerResponseSha256", "readModelBindingHash", "requestBindingHash",
      "schemaVersion", "signedEnvelope", "signerBinding", "sourceCommit",
      "sourceTree", "status", "targetMachineId", "workloadIdentity",
    ].sort());
    expect(body).toMatchObject({
      schemaVersion:
        "programmable.website-generic-launch-read-stage-probe-receipt.v1",
      status: "verified",
      targetMachineId: MACHINE,
      deployment: {
        deploymentId: "dpl_12345678901234567890",
        origin: "https://exact-stage.vercel.app",
        projectId: "prj_MM8nbhoztJnz1yhimwc9CVFYhAd7",
        targetEnvironment: "production",
        gitCommitSha: "d".repeat(40),
      },
      signerBinding: {
        schemaVersion:
          "programmable.website-generic-launch-read-stage-probe-signer.v1",
        keyId: "generic-launch-read",
        keyEpoch: "epoch-7",
        publicKeySpkiSha256: harness.signer.binding.publicKeySpkiSha256,
      },
      providerResponse: {
        schemaVersion: "programmable.remote-signing-authenticated-response.v2",
      },
    });
    expect(body.signedEnvelope.payload.request).toEqual(harness.requestBody);
    expect(body.signedEnvelope.payload.workloadIdentity).toEqual(
      harness.signer.workloadIdentity,
    );
    expect(body.signedEnvelope.payload.deployment).toEqual(body.deployment);
    expect(body.observedAt).toBe(body.providerResponse.providerReceipt.observedAt);
    expect(body.expiresAt).toBe(body.providerResponse.providerReceipt.expiresAt);
    expect(body.providerResponseSha256).toBe(rawDigest(Buffer.from(
      canonicalizeJson(body.providerResponse as unknown as JsonValue),
      "utf8",
    )));
  });

  it("is inert without its one-shot secret and rejects aliases fail closed", async () => {
    const harness = probeHarness();
    const unavailable = await handleProductionGenericLaunchReadStageProbeV1(
      probeRequest(SECRET, "https://exact-stage.vercel.app", harness.requestBody),
      { environment: { ...harness.environment,
        [GENERIC_LAUNCH_READ_STAGE_PROBE_SECRET_ENV_V1]: undefined } },
    );
    expect(unavailable.status).toBe(503);

    const unauthorized = await handleProductionGenericLaunchReadStageProbeV1(
      probeRequest(
        "wrong-secret-that-is-long-enough-to-compare",
        "https://exact-stage.vercel.app",
        harness.requestBody,
      ),
      { environment: harness.environment },
    );
    expect(unauthorized.status).toBe(401);

    const alias = await handleProductionGenericLaunchReadStageProbeV1(
      probeRequest(SECRET, "https://programmable.market", harness.requestBody),
      {
        environment: harness.environment,
        createProbeSigner: async () => harness.signer,
      },
    );
    expect(alias.status).toBe(503);
  });
});

function probeRequest(
  secret = SECRET,
  origin = "https://exact-stage.vercel.app",
  body = probeBody(),
): Request {
  return new Request(`${origin}${GENERIC_LAUNCH_READ_STAGE_PROBE_PATH_V1}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: canonicalizeJson(body),
  });
}

function probeBody(genericBindingSha256 = digest("6")) {
  return Object.freeze({
    schemaVersion: GENERIC_LAUNCH_READ_STAGE_PROBE_REQUEST_SCHEMA_V1,
    operationId: "1".repeat(32),
    nonceSha256: digest("2"),
    sourceCommit: "3".repeat(40),
    sourceTree: "4".repeat(40),
    genericImageDigest: digest("5"),
    genericBindingSha256,
    genericSignRequestSha256: digest("7"),
    targetMachineId: MACHINE,
  });
}

function probeHarness() {
  const { publicKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" });
  const publicKeySpkiSha256 = rawDigest(spki);
  const endpoint = "https://generic-signer.example/v1/sign";
  const providerIdentityHash = canonicalSha256(
    "programmable.remote-ed25519-provider-identity.v2",
    {
      schemaVersion: "programmable.remote-ed25519-provider-identity.v2",
      endpoint,
      audience: "programmable.generic-launch-read.v2",
      keyId: "generic-launch-read",
      keyEpoch: "epoch-7",
      publicKeySpkiSha256,
    },
  );
  const readModelBindingHash = digest("8");
  const activeReadBinding = createActiveGenericLaunchReadBindingV2({
    activatedAt: NOW,
    readModelBindingHash,
    readModelVerifier: {
      algorithm: "ed25519",
      publicKeySpkiBase64Url: spki.toString("base64url"),
      publicKeySha256: publicKeySpkiSha256,
    },
    registryIdentity: {
      chainId: "1",
      generation: "2",
      registryAddress: `0x${"1".repeat(40)}`,
      registryRuntimeCodeKeccak256: `0x${"2".repeat(64)}`,
      registryPolicyCommitment: `0x${"3".repeat(64)}`,
      minimumFinalityBlocks: "12",
    },
    api: {
      feedPath: GENERIC_LAUNCH_FEED_PATH_V2,
      detailPathTemplate: GENERIC_LAUNCH_DETAIL_PATH_TEMPLATE_V2,
    },
  });
  const workloadIdentity = Object.freeze({
    schemaVersion: "programmable.vercel-workload-identity.v1" as const,
    issuer: "https://oidc.vercel.com/aficialais-projects",
    audience: "https://vercel.com/aficialais-projects",
    subject:
      "owner:aficialais-projects:project:launcher-v4:environment:production",
    owner: "aficialais-projects",
    ownerId: "team_x9QVubeZTF27TMYRLZWRvltj",
    project: "launcher-v4",
    projectId: "prj_MM8nbhoztJnz1yhimwc9CVFYhAd7",
    environment: "production" as const,
    issuedAt: "2026-08-13T23:59:00.000Z",
    notBefore: "2026-08-13T23:59:00.000Z",
    expiresAt: "2026-08-14T00:50:00.000Z",
  });
  const binding = Object.freeze({
      schemaVersion: "programmable.generic-launch-read-signer-binding.v2",
      endpoint,
      audience: "programmable.generic-launch-read.v2",
      keyId: "generic-launch-read",
      keyEpoch: "epoch-7",
      publicKeySpkiBase64Url: spki.toString("base64url"),
      publicKeySpkiSha256,
      providerIdentityHash,
      credentialMode: "vercel-oidc-bearer",
  } as const);
  const requestBody = probeBody(rawDigest(Buffer.from(
    canonicalizeJson(binding),
    "utf8",
  )));
  const signer: GenericLaunchReadProbeSignerV1 = Object.freeze({
    binding,
    workloadIdentity,
    async signWithEvidence(
      input: Parameters<GenericLaunchReadProbeSignerV1["signWithEvidence"]>[0],
    ) {
      const signedEnvelope = Object.freeze({
        schemaVersion: "programmable.signed-generic-launch-read-envelope.v2" as const,
        activationBindingHash: activeReadBinding.activationBindingHash,
        readModelBindingHash: activeReadBinding.readModelBindingHash,
        requestBindingHash: input.requestBindingHash,
        payload: input.payload,
        signatureBase64Url: "A".repeat(86),
      });
      const providerReceipt = Object.freeze({
        schemaVersion: "programmable.remote-signing-provider-receipt.v2" as const,
        outcome: "completed" as const,
        audience: "programmable.generic-launch-read.v2" as const,
        keyId: "generic-launch-read",
        keyEpoch: "epoch-7",
        algorithm: "Ed25519" as const,
        providerIdentityHash,
        idempotencyKey: digest("9"),
        messageSha256: digest("a"),
        requestDigest: digest("b"),
        signature: "A".repeat(86),
        observedAt: NOW,
        expiresAt: "2026-08-14T00:05:00.000Z",
      });
      return Object.freeze({
        signedEnvelope,
        providerResponse: Object.freeze({
          schemaVersion:
            "programmable.remote-signing-authenticated-response.v2" as const,
          providerReceipt,
          providerReceiptDigest: digest("c"),
          providerReceiptSignature: "B".repeat(86),
        }),
      });
    },
  });
  return Object.freeze({
    signer,
    environment: Object.freeze({
      [GENERIC_LAUNCH_READ_STAGE_PROBE_SECRET_ENV_V1]: SECRET,
      [GENERIC_LAUNCH_READ_STAGE_PROBE_EXPECTED_ENV_V1]: canonicalizeJson({
        schemaVersion:
          "programmable.website-generic-launch-read-stage-probe-expected.v1",
        operationId: requestBody.operationId,
        nonceSha256: requestBody.nonceSha256,
        sourceCommit: requestBody.sourceCommit,
        sourceTree: requestBody.sourceTree,
        genericImageDigest: requestBody.genericImageDigest,
        genericBindingSha256: requestBody.genericBindingSha256,
        genericSignRequestSha256: requestBody.genericSignRequestSha256,
        machineIds: [MACHINE, "bcdefa12345678"].sort(),
      }),
      PROGRAMMABLE_GENERIC_LAUNCH_READ_BINDING_V2_JSON:
        canonicalizeJson(activeReadBinding),
      VERCEL_URL: "exact-stage.vercel.app",
      VERCEL_DEPLOYMENT_ID: "dpl_12345678901234567890",
      VERCEL_PROJECT_ID: "prj_MM8nbhoztJnz1yhimwc9CVFYhAd7",
      VERCEL_TARGET_ENV: "production",
      VERCEL_GIT_COMMIT_SHA: "d".repeat(40),
    }),
    requestBody,
  });
}

function digest(nibble: string): Sha256Digest {
  return `sha256:${nibble.repeat(64)}` as Sha256Digest;
}

function rawDigest(bytes: Uint8Array): Sha256Digest {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
