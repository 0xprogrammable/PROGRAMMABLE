import {
  createHash,
  generateKeyPairSync,
  sign as signBytes,
  verify as verifyBytes,
  type KeyObject,
} from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createActiveGenericLaunchReadBindingV2,
  createGenericLaunchReadHandlersV2,
  GENERIC_LAUNCH_DETAIL_PATH_TEMPLATE_V2,
  GENERIC_LAUNCH_FEED_PATH_V2,
  type GenericLaunchReadBindingV2,
  type GenericLaunchReadModelContractV2,
  type GenericLaunchReadStoreV2,
} from "../lib/server/custom-launch/generic-launch-read-v2";
import {
  createProductionGenericLaunchReadSignerV2,
  createRemoteGenericLaunchReadSignerV2,
  GENERIC_LAUNCH_READ_SIGNER_AUDIENCE_V2,
  GENERIC_LAUNCH_READ_SIGNER_BINDING_ENV_V2,
  parseGenericLaunchReadSignerBindingV2,
  type GenericLaunchReadSignerBindingV2,
} from "../lib/server/custom-launch/generic-launch-read-signer-v2";
import {
  canonicalizeJson,
  type JsonValue,
} from "../lib/server/projection-target/canonical-json";
import {
  canonicalSha256,
  type Sha256Digest,
} from "../lib/server/projection-target/hashing";

const NOW = new Date("2026-08-14T00:00:00.000Z");
const REQUEST_HASH = digest("a");
const RECORD_HASH = digest("b");
const CREDENTIAL = "vercel-context-header.payload.signature";

const READ_MODEL_CONTRACT = Object.freeze({
  schemaVersion: "programmable.generic-launch-read-model-contract.v2" as const,
  sourceLane: "generic.finalized-launch-v2" as const,
  implementationBindingHash: digest("1"),
  persistenceBindingHash: digest("2"),
  queryContractBindingHash: digest("3"),
  approvalArtifactSchemaBindingHash: digest("4"),
  approvalReleaseBindingHash: digest("5"),
  registryProjectionBindingHash: digest("6"),
}) satisfies GenericLaunchReadModelContractV2;

describe("Generic launch V2 remote read signer", () => {
  it("produces the exact signed envelope consumed by the active Generic V2 read adapter", async () => {
    const harness = signerHarness();
    const signer = createRemoteGenericLaunchReadSignerV2({
      binding: harness.signerBinding,
      activeReadBinding: harness.readBinding,
      credential: CREDENTIAL,
      fetch: harness.fetch,
      now: () => NOW,
    });
    const handlers = createGenericLaunchReadHandlersV2({
      binding: harness.readBinding,
      store: Object.freeze({
        sourceLane: "generic.finalized-launch-v2" as const,
        readModelContract: READ_MODEL_CONTRACT,
        findFinalizedLaunches: async ({ requestBindingHash, signal }) =>
          signer.sign({
            requestBindingHash,
            payload: Object.freeze({ records: [], nextCursor: null, total: "0" }),
            signal,
          }),
        findFinalizedLaunchByRecordHash: async ({ requestBindingHash, signal }) =>
          signer.sign({ requestBindingHash, payload: null, signal }),
      } satisfies GenericLaunchReadStoreV2),
    });

    const response = await handlers.detail(
      new Request(`https://programmable.example${
        GENERIC_LAUNCH_DETAIL_PATH_TEMPLATE_V2.replace("{recordHash}", RECORD_HASH)
      }`, { headers: { accept: "application/json" } }),
      RECORD_HASH,
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      schemaVersion: "programmable.custom-launch-error.v1",
      code: "generic_launch_v2_not_found",
    });
  });

  it("binds the remote-signing-v2 request to its dedicated audience, key epoch and provider", async () => {
    const harness = signerHarness();
    let capturedUrl = "";
    let capturedAuthorization = "";
    let capturedBody: Readonly<Record<string, string>> | null = null;
    const signer = createRemoteGenericLaunchReadSignerV2({
      binding: harness.signerBinding,
      activeReadBinding: harness.readBinding,
      credential: CREDENTIAL,
      now: () => NOW,
      fetch: async (url, init) => {
        capturedUrl = String(url);
        capturedAuthorization = new Headers(init?.headers).get("authorization") ?? "";
        capturedBody = JSON.parse(String(init?.body)) as Record<string, string>;
        return harness.fetch(url, init);
      },
    });
    const payload = Object.freeze({ records: [], nextCursor: null, total: "0" });

    const encodedEnvelope = await signer.sign({
      requestBindingHash: REQUEST_HASH,
      payload,
    });

    expect(capturedUrl).toBe("https://signer.example/v2/sign");
    expect(capturedAuthorization).toBe(`Bearer ${CREDENTIAL}`);
    expect(capturedBody).not.toBeNull();
    expect(capturedBody).toMatchObject({
      schemaVersion: "programmable.remote-signing-request.v2",
      audience: GENERIC_LAUNCH_READ_SIGNER_AUDIENCE_V2,
      keyId: "generic-launch-read",
      keyEpoch: "epoch-7",
      algorithm: "Ed25519",
      providerIdentityHash: harness.signerBinding.providerIdentityHash,
      messageEncoding: "base64url",
    });
    const message = JSON.parse(Buffer.from(
      capturedBody!.message!,
      "base64url",
    ).toString("utf8"));
    expect(message).toEqual({
      schemaVersion: "programmable.generic-launch-read-signature-message.v2",
      activationBindingHash: harness.readBinding.activationBindingHash,
      readModelBindingHash: harness.readBinding.readModelBindingHash,
      requestBindingHash: REQUEST_HASH,
      payload,
    });
    const envelope = JSON.parse(encodedEnvelope) as Record<string, unknown>;
    expect(envelope).toMatchObject({
      activationBindingHash: message.activationBindingHash,
      readModelBindingHash: message.readModelBindingHash,
      requestBindingHash: message.requestBindingHash,
      payload: message.payload,
    });
    expect(envelope.schemaVersion).toBe(
      "programmable.signed-generic-launch-read-envelope.v2",
    );
    expect(Object.keys(envelope).sort()).toEqual([
      "activationBindingHash",
      "payload",
      "readModelBindingHash",
      "requestBindingHash",
      "schemaVersion",
      "signatureBase64Url",
    ]);
    expect(verifyBytes(
      null,
      Buffer.from(canonicalizeJson(message), "utf8"),
      harness.publicKey,
      Buffer.from(String(envelope.signatureBase64Url), "base64url"),
    )).toBe(true);
  });

  it("rejects any signer SPKI that is not the active Generic V2 verifier", () => {
    const active = signerHarness();
    const foreign = signerHarness();

    expect(() => createRemoteGenericLaunchReadSignerV2({
      binding: foreign.signerBinding,
      activeReadBinding: active.readBinding,
      credential: CREDENTIAL,
      fetch: foreign.fetch,
      now: () => NOW,
    })).toThrow("does not match the active Generic V2 verifier");

    const wrongVerifierHash = createActiveGenericLaunchReadBindingV2({
      activatedAt: active.readBinding.activatedAt,
      readModelBindingHash: active.readBinding.readModelBindingHash,
      readModelVerifier: {
        ...active.readBinding.readModelVerifier,
        publicKeySha256: digest("f"),
      },
      registryIdentity: active.readBinding.registryIdentity,
      api: active.readBinding.api,
    });
    expect(() => createRemoteGenericLaunchReadSignerV2({
      binding: active.signerBinding,
      activeReadBinding: wrongVerifierHash,
      credential: CREDENTIAL,
      fetch: active.fetch,
      now: () => NOW,
    })).toThrow("does not match the active Generic V2 verifier");
  });

  it("uses only Vercel OIDC in production and fails closed without the exact public binding", async () => {
    const harness = signerHarness();
    await expect(createProductionGenericLaunchReadSignerV2({
      activeReadBinding: harness.readBinding,
      environment: {},
      credentialProvider: async () => CREDENTIAL,
      fetch: harness.fetch,
      now: () => NOW,
    })).rejects.toThrow("is not configured");

    await expect(createProductionGenericLaunchReadSignerV2({
      activeReadBinding: harness.readBinding,
      environment: {
        [GENERIC_LAUNCH_READ_SIGNER_BINDING_ENV_V2]: canonicalizeJson({
          ...harness.signerBinding,
          privateKeyBase64Url: "forbidden-local-fallback",
        } as unknown as JsonValue),
      },
      credentialProvider: async () => CREDENTIAL,
      fetch: harness.fetch,
      now: () => NOW,
    })).rejects.toThrow("unknown or missing fields");

    let authorization = "";
    const signer = await createProductionGenericLaunchReadSignerV2({
      activeReadBinding: harness.readBinding,
      environment: {
        [GENERIC_LAUNCH_READ_SIGNER_BINDING_ENV_V2]:
          canonicalizeJson(harness.signerBinding as unknown as JsonValue),
      },
      credentialProvider: async () => CREDENTIAL,
      fetch: async (url, init) => {
        authorization = new Headers(init?.headers).get("authorization") ?? "";
        return harness.fetch(url, init);
      },
      now: () => NOW,
    });
    await signer.sign({ requestBindingHash: REQUEST_HASH, payload: null });
    expect(authorization).toBe(`Bearer ${CREDENTIAL}`);
  });

  it("fails closed on timeout, redirects and unauthenticated provider responses", async () => {
    const harness = signerHarness();
    const common = {
      binding: harness.signerBinding,
      activeReadBinding: harness.readBinding,
      credential: CREDENTIAL,
      now: () => NOW,
    } as const;
    const timedOut = createRemoteGenericLaunchReadSignerV2({
      ...common,
      timeoutMs: 500,
      fetch: async (_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
          once: true,
        });
      }),
    });
    await expect(timedOut.sign({
      requestBindingHash: REQUEST_HASH,
      payload: null,
    })).rejects.toThrow("deadline");

    const redirected = createRemoteGenericLaunchReadSignerV2({
      ...common,
      fetch: async () => ({ redirected: true, status: 200 }) as Response,
    });
    await expect(redirected.sign({
      requestBindingHash: REQUEST_HASH,
      payload: null,
    })).rejects.toThrow("rejected");

    const forged = createRemoteGenericLaunchReadSignerV2({
      ...common,
      fetch: signerTransport(harness.privateKey, {
        providerReceiptSignature: "A".repeat(86),
      }),
    });
    await expect(forged.sign({
      requestBindingHash: REQUEST_HASH,
      payload: null,
    })).rejects.toThrow("signature is invalid");

    const mismatched = createRemoteGenericLaunchReadSignerV2({
      ...common,
      fetch: signerTransport(harness.privateKey, {
        keyEpoch: "epoch-8",
      }),
    });
    await expect(mismatched.sign({
      requestBindingHash: REQUEST_HASH,
      payload: null,
    })).rejects.toThrow("response binding is invalid");

    const missingField = createRemoteGenericLaunchReadSignerV2({
      ...common,
      fetch: async (url, init) => {
        const response = await harness.fetch(url, init);
        const malformed = await response.json() as {
          providerReceipt: Record<string, JsonValue>;
        };
        delete malformed.providerReceipt.expiresAt;
        return new Response(canonicalizeJson(malformed), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    await expect(missingField.sign({
      requestBindingHash: REQUEST_HASH,
      payload: null,
    })).rejects.toThrow("unknown or missing fields");
  });
});

type SignerHarness = Readonly<{
  privateKey: KeyObject;
  publicKey: KeyObject;
  readBinding: GenericLaunchReadBindingV2;
  signerBinding: GenericLaunchReadSignerBindingV2;
  fetch: typeof fetch;
}>;

function signerHarness(): SignerHarness {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const readBinding = readBindingForPublicKey(publicKey);
  const signerBinding = signerBindingForPublicKey(publicKey);
  return Object.freeze({
    privateKey,
    publicKey,
    readBinding,
    signerBinding,
    fetch: signerTransport(privateKey),
  });
}

function readBindingForPublicKey(publicKey: KeyObject): GenericLaunchReadBindingV2 {
  const spki = publicKey.export({ format: "der", type: "spki" });
  return createActiveGenericLaunchReadBindingV2({
    activatedAt: NOW.toISOString(),
    readModelBindingHash: canonicalSha256(
      READ_MODEL_CONTRACT.schemaVersion,
      READ_MODEL_CONTRACT,
    ),
    readModelVerifier: {
      algorithm: "ed25519",
      publicKeySpkiBase64Url: spki.toString("base64url"),
      publicKeySha256: rawDigest(spki),
    },
    registryIdentity: {
      chainId: "1",
      generation: "2",
      registryAddress: `0x${"1".repeat(40)}`,
      registryRuntimeCodeKeccak256: `0x${"2".repeat(64)}`,
      registryPolicyCommitment: `0x${"3".repeat(64)}`,
      minimumFinalityBlocks: "64",
    },
    api: {
      feedPath: GENERIC_LAUNCH_FEED_PATH_V2,
      detailPathTemplate: GENERIC_LAUNCH_DETAIL_PATH_TEMPLATE_V2,
    },
  });
}

function signerBindingForPublicKey(
  publicKey: KeyObject,
): GenericLaunchReadSignerBindingV2 {
  const spki = publicKey.export({ format: "der", type: "spki" });
  const endpoint = "https://signer.example/v2/sign";
  const publicKeySpkiBase64Url = spki.toString("base64url");
  const publicKeySpkiSha256 = rawDigest(spki);
  const identity = Object.freeze({
    schemaVersion: "programmable.remote-ed25519-provider-identity.v2" as const,
    endpoint,
    audience: GENERIC_LAUNCH_READ_SIGNER_AUDIENCE_V2,
    keyId: "generic-launch-read",
    keyEpoch: "epoch-7",
    publicKeySpkiSha256,
  });
  return parseGenericLaunchReadSignerBindingV2({
    schemaVersion: "programmable.generic-launch-read-signer-binding.v2",
    endpoint,
    audience: GENERIC_LAUNCH_READ_SIGNER_AUDIENCE_V2,
    keyId: identity.keyId,
    keyEpoch: identity.keyEpoch,
    publicKeySpkiBase64Url,
    publicKeySpkiSha256,
    providerIdentityHash: canonicalSha256(identity.schemaVersion, identity),
    credentialMode: "vercel-oidc-bearer",
  });
}

function signerTransport(
  privateKey: KeyObject,
  override: Readonly<{
    keyEpoch?: string;
    providerReceiptSignature?: string;
  }> = {},
): typeof fetch {
  return async (_url, init) => {
    const request = JSON.parse(String(init?.body)) as Record<string, string>;
    const message = Buffer.from(request.message!, "base64url");
    const signature = signBytes(null, message, privateKey).toString("base64url");
    const providerReceipt = Object.freeze({
      schemaVersion: "programmable.remote-signing-provider-receipt.v2",
      outcome: "completed",
      audience: request.audience,
      keyId: request.keyId,
      keyEpoch: override.keyEpoch ?? request.keyEpoch,
      algorithm: "Ed25519",
      providerIdentityHash: request.providerIdentityHash,
      idempotencyKey: request.idempotencyKey,
      messageSha256: request.messageSha256,
      requestDigest: request.requestDigest,
      signature,
      observedAt: NOW.toISOString(),
      expiresAt: new Date(NOW.getTime() + 300_000).toISOString(),
    });
    const receiptBytes = Buffer.from(canonicalizeJson(providerReceipt), "utf8");
    return new Response(canonicalizeJson({
      schemaVersion: "programmable.remote-signing-authenticated-response.v2",
      providerReceipt,
      providerReceiptDigest: rawDigest(receiptBytes),
      providerReceiptSignature: override.providerReceiptSignature
        ?? signBytes(null, receiptBytes, privateKey).toString("base64url"),
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

function digest(nibble: string): Sha256Digest {
  return `sha256:${nibble.repeat(64)}` as Sha256Digest;
}

function rawDigest(bytes: Uint8Array): Sha256Digest {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
