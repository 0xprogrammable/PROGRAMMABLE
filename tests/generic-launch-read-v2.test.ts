import {
  createHash,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { canonicalizeJson, type JsonValue } from
  "../lib/server/projection-target/canonical-json";
import { canonicalSha256, type Sha256Digest } from
  "../lib/server/projection-target/hashing";
import {
  createGenericLaunchRecordV2,
  type GenericLaunchRecordV2,
  type GenericLaunchSourceProjectionV2,
} from "../lib/server/custom-launch/generic-launch-contract-v2";
import {
  createActiveGenericLaunchReadBindingV2,
  createGenericLaunchReadHandlersV2,
  type GenericLaunchReadBindingV2,
  type GenericLaunchReadModelContractV2,
  type GenericLaunchReadStoreV2,
  type SignedGenericLaunchReadEnvelopeV2,
} from "../lib/server/custom-launch/generic-launch-read-v2";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import publicSchema from "../config/generic-launch-public.v2.schema.json";

const sha = (character: string) => `sha256:${character.repeat(64)}` as const;
const hash = (character: string) => `0x${character.repeat(64)}` as const;
const address = (character: string) => `0x${character.repeat(40)}` as const;
const signingKeys = generateKeyPairSync("ed25519");
const publicKeySpki = signingKeys.publicKey.export({ format: "der", type: "spki" });

const READ_MODEL_CONTRACT: GenericLaunchReadModelContractV2 = {
  schemaVersion: "programmable.generic-launch-read-model-contract.v2",
  sourceLane: "generic.finalized-launch-v2",
  implementationBindingHash: sha("1"),
  persistenceBindingHash: sha("2"),
  queryContractBindingHash: sha("3"),
  approvalArtifactSchemaBindingHash: sha("4"),
  approvalReleaseBindingHash: sha("5"),
  registryProjectionBindingHash: sha("6"),
};
const READ_MODEL_BINDING = canonicalSha256(
  READ_MODEL_CONTRACT.schemaVersion,
  READ_MODEL_CONTRACT,
);

function projection(seed = "3"): GenericLaunchSourceProjectionV2 {
  return {
    schemaVersion: "programmable.generic-launch-source-projection.v2",
    sourceRevision: {
      repositoryId: seed === "3" ? "123456789" : "987654321",
      repositoryFullName: `alice/example-hook-${seed}`,
      commitObjectId: seed.repeat(40),
      treeObjectId: (seed === "3" ? "4" : "5").repeat(40),
    },
    approval: {
      approvalRevision: "7",
      approvalId: hash("1"),
      approvalEvidenceHash: hash("2"),
      signedReceiptArtifactHash: sha("2"),
    },
    descriptor: {
      descriptorHash: hash("3"),
      launchId: hash(seed === "3" ? "4" : "5"),
      launchWallet: address("5"),
      primaryContract: address("7"),
      primaryRuntimeCodeHash: hash("8"),
      componentSetHash: hash("9"),
      sourceArtifactHash: hash("a"),
      configurationHash: hash("b"),
      launchPlanHash: hash("c"),
      projectCommitment: hash("d"),
      marketMode: "Standard10",
      marketModeValue: 1,
      protocolFeeBps: 10,
    },
    lifecycle: {
      chainId: "1",
      generation: "2",
      registryAddress: address("6"),
      registryRuntimeCodeKeccak256: hash("7"),
      registryPolicyCommitment: hash("8"),
      minimumFinalityBlocks: "12",
      primaryLaunch: {
        transactionHash: hash("9"),
        sender: address("5"),
        blockHash: hash("a"),
        blockNumber: "88",
        transactionIndex: "2",
        status: "success",
      },
      authorization: {
        eventName: "CustomLaunchApprovalAuthorizedV2",
        transactionHash: hash("a"),
        blockHash: hash("b"),
        blockNumber: "90",
        transactionIndex: "3",
        logIndex: "4",
        removed: false,
      },
      registration: [
        {
          eventName: "CustomLaunchRegisteredV2",
          transactionHash: hash("b"),
          blockHash: hash("c"),
          blockNumber: "95",
          transactionIndex: "4",
          logIndex: "5",
          removed: false,
        },
        {
          eventName: "CustomLaunchDescriptorCommittedV2",
          transactionHash: hash("b"),
          blockHash: hash("c"),
          blockNumber: "95",
          transactionIndex: "4",
          logIndex: "6",
          removed: false,
        },
        {
          eventName: "CustomLaunchDescriptorEvidenceCommittedV2",
          transactionHash: hash("b"),
          blockHash: hash("c"),
          blockNumber: "95",
          transactionIndex: "4",
          logIndex: "7",
          removed: false,
        },
      ],
      finalization: {
        eventName: "CustomLaunchFinalizedV2",
        transactionHash: hash("c"),
        blockHash: hash("d"),
        blockNumber: "100",
        transactionIndex: "5",
        logIndex: "8",
        removed: false,
      },
      latestCommonHead: "112",
      latestCommonHeadHash: hash("e"),
      latestStatus: "finalized",
      revokedAtBlock: "0",
      revocationEvidenceHash: hash("0"),
    },
  };
}

function record(seed = "3"): GenericLaunchRecordV2 {
  return createGenericLaunchRecordV2({
    sourceProjection: projection(seed),
    readModelBindingHash: READ_MODEL_BINDING,
  });
}

function activeBinding(): GenericLaunchReadBindingV2 {
  return createActiveGenericLaunchReadBindingV2({
    activatedAt: "2026-08-13T20:00:00.000Z",
    readModelBindingHash: READ_MODEL_BINDING,
    readModelVerifier: {
      algorithm: "ed25519",
      publicKeySpkiBase64Url: publicKeySpki.toString("base64url"),
      publicKeySha256:
        `sha256:${createHash("sha256").update(publicKeySpki).digest("hex")}`,
    },
    registryIdentity: {
      chainId: "1",
      generation: "2",
      registryAddress: address("6"),
      registryRuntimeCodeKeccak256: hash("7"),
      registryPolicyCommitment: hash("8"),
      minimumFinalityBlocks: "12",
    },
    api: {
      feedPath: "/api/custom-launch/generic/v2/launches",
      detailPathTemplate:
        "/api/custom-launch/generic/v2/launches/{recordHash}",
    },
  });
}

function signedEnvelope(
  binding: GenericLaunchReadBindingV2,
  requestBindingHash: Sha256Digest,
  payload: unknown,
  privateKey: KeyObject = signingKeys.privateKey,
): SignedGenericLaunchReadEnvelopeV2 {
  if (binding.activationBindingHash === null
    || binding.readModelBindingHash === null) {
    throw new TypeError("test binding must be active");
  }
  const message = Object.freeze({
    schemaVersion: "programmable.generic-launch-read-signature-message.v2" as const,
    activationBindingHash: binding.activationBindingHash,
    readModelBindingHash: binding.readModelBindingHash,
    requestBindingHash,
    payload,
  });
  return Object.freeze({
    schemaVersion: "programmable.signed-generic-launch-read-envelope.v2" as const,
    activationBindingHash: binding.activationBindingHash,
    readModelBindingHash: binding.readModelBindingHash,
    requestBindingHash,
    payload,
    signatureBase64Url: sign(
      null,
      Buffer.from(canonicalizeJson(message as unknown as JsonValue), "utf8"),
      privateKey,
    ).toString("base64url"),
  });
}

function envelopeBytes(
  binding: GenericLaunchReadBindingV2,
  requestBindingHash: Sha256Digest,
  payload: unknown,
  privateKey: KeyObject = signingKeys.privateKey,
): string {
  return canonicalizeJson(signedEnvelope(
    binding,
    requestBindingHash,
    payload,
    privateKey,
  ) as unknown as JsonValue);
}

function store(
  binding: GenericLaunchReadBindingV2,
  records: readonly GenericLaunchRecordV2[],
  contract: GenericLaunchReadModelContractV2 = READ_MODEL_CONTRACT,
  privateKey: KeyObject = signingKeys.privateKey,
): GenericLaunchReadStoreV2 {
  return {
    sourceLane: "generic.finalized-launch-v2",
    readModelContract: contract,
    async findFinalizedLaunches({ limit, cursor, requestBindingHash }) {
      const offset = cursor === undefined ? 0 : Number(cursor.slice(1));
      const page = records.slice(offset, offset + limit);
      const nextOffset = offset + page.length;
      return envelopeBytes(binding, requestBindingHash, {
        records: page,
        nextCursor: nextOffset < records.length ? `c${nextOffset}` : null,
        total: String(records.length),
      }, privateKey);
    },
    async findFinalizedLaunchByRecordHash({ recordHash, requestBindingHash }) {
      return envelopeBytes(
        binding,
        requestBindingHash,
        records.find((candidate) => candidate.recordHash === recordHash) ?? null,
        privateKey,
      );
    },
  };
}

function request(path: string, accept = "application/json"): Request {
  return new Request(`https://programmable.market${path}`, {
    headers: { accept },
  });
}

describe("Generic launch V2 signed read adapter", () => {
  it("keeps the public JSON schema aligned with records and read contracts", () => {
    const binding = activeBinding();
    const envelope = signedEnvelope(binding, sha("f"), {
      records: [record()], nextCursor: null, total: "1",
    });
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    const validate = ajv.compile(publicSchema);
    for (const [definition, value] of [
      ["genericLaunchRecord", record()],
      ["genericLaunchReadModelContract", READ_MODEL_CONTRACT],
      ["genericLaunchReadBinding", binding],
      ["signedGenericLaunchReadEnvelope", envelope],
      ["genericLaunchFeed", {
        schemaVersion: "programmable.generic-launch-feed.v2",
        records: [record()],
        nextCursor: null,
        total: "1",
      }],
      ["genericLaunchView", {
        schemaVersion: "programmable.generic-launch-view.v2",
        record: record(),
      }],
    ] as const) {
      const component = ajv.compile({
        $ref: `${publicSchema.$id}#/$defs/${definition}`,
      });
      expect(component(value), JSON.stringify(component.errors)).toBe(true);
    }
    expect(validate({ ...record(), criteria: [] })).toBe(false);
  });

  it("keeps production routes dark without an exact activation and store", async () => {
    const handlers = createGenericLaunchReadHandlersV2({ binding: null, store: null });
    const feed = await handlers.feed(request(
      "/api/custom-launch/generic/v2/launches",
    ));
    const detail = await handlers.detail(
      request(`/api/custom-launch/generic/v2/launches/${sha("1")}`),
      sha("1"),
    );

    expect(feed.status).toBe(503);
    expect(detail.status).toBe(503);
    expect(feed.headers.get("cache-control")).toBe("no-store");
    await expect(feed.json()).resolves.toEqual({
      schemaVersion: "programmable.custom-launch-error.v1",
      code: "generic_launch_v2_not_active",
    });
    expect(() => createGenericLaunchReadHandlersV2({
      binding: null,
      store: store(activeBinding(), []),
    })).toThrow(/cannot bind a read store/u);
  });

  it("serves identical signed V2 records from feed and detail", async () => {
    const binding = activeBinding();
    const records = [record("3"), record("a")];
    const handlers = createGenericLaunchReadHandlersV2({
      binding,
      store: store(binding, records),
    });

    const feed = await handlers.feed(request(
      "/api/custom-launch/generic/v2/launches?limit=1",
    ));
    const detail = await handlers.detail(
      request(`/api/custom-launch/generic/v2/launches/${records[0].recordHash}`),
      records[0].recordHash,
    );

    expect(feed.status).toBe(200);
    expect(detail.status).toBe(200);
    await expect(feed.json()).resolves.toEqual({
      schemaVersion: "programmable.generic-launch-feed.v2",
      records: [records[0]],
      nextCursor: "c1",
      total: "2",
    });
    await expect(detail.json()).resolves.toEqual({
      schemaVersion: "programmable.generic-launch-view.v2",
      record: records[0],
    });
  });

  it("rejects a store contract or record outside the exact activation", async () => {
    const binding = activeBinding();
    expect(() => createGenericLaunchReadHandlersV2({
      binding,
      store: store(binding, [], {
        ...READ_MODEL_CONTRACT,
        registryProjectionBindingHash: sha("f"),
      }),
    })).toThrow(/not activation-bound/u);

    const sourceProjection = projection();
    const changedProjection = {
      ...sourceProjection,
      lifecycle: {
        ...sourceProjection.lifecycle,
        registryPolicyCommitment: hash("f"),
      },
    };
    const unbound = createGenericLaunchRecordV2({
      sourceProjection: changedProjection,
      readModelBindingHash: READ_MODEL_BINDING,
    });
    const handlers = createGenericLaunchReadHandlersV2({
      binding,
      store: store(binding, [unbound]),
    });
    expect((await handlers.feed(request(
      "/api/custom-launch/generic/v2/launches?limit=1",
    ))).status).toBe(503);
  });

  it("rejects forged signatures, request replay and detail substitution", async () => {
    const binding = activeBinding();
    const value = record();
    const attacker = generateKeyPairSync("ed25519");
    const forged = createGenericLaunchReadHandlersV2({
      binding,
      store: store(binding, [value], READ_MODEL_CONTRACT, attacker.privateKey),
    });
    expect((await forged.feed(request(
      "/api/custom-launch/generic/v2/launches?limit=1",
    ))).status).toBe(503);

    const replayStore = store(binding, [value]);
    let replayed: string | null = null;
    replayStore.findFinalizedLaunches = async ({ requestBindingHash }) => {
      replayed ??= envelopeBytes(binding, requestBindingHash, {
        records: [value], nextCursor: null, total: "1",
      });
      return replayed;
    };
    const replay = createGenericLaunchReadHandlersV2({ binding, store: replayStore });
    expect((await replay.feed(request(
      "/api/custom-launch/generic/v2/launches?limit=1",
    ))).status).toBe(200);
    expect((await replay.feed(request(
      "/api/custom-launch/generic/v2/launches?limit=1",
    ))).status).toBe(503);

    const substitutedStore = store(binding, [value]);
    substitutedStore.findFinalizedLaunchByRecordHash = async ({
      requestBindingHash,
    }) => envelopeBytes(binding, requestBindingHash, value);
    const substituted = createGenericLaunchReadHandlersV2({
      binding,
      store: substitutedStore,
    });
    expect((await substituted.detail(
      request(`/api/custom-launch/generic/v2/launches/${sha("f")}`),
      sha("f"),
    )).status).toBe(503);
  });

  it("rejects invalid pages and captures exact own data methods once", async () => {
    const binding = activeBinding();
    const value = record();
    const mutableStore = store(binding, [value]);
    const handlers = createGenericLaunchReadHandlersV2({
      binding,
      store: mutableStore,
    });
    mutableStore.findFinalizedLaunches = async () => {
      throw new TypeError("substituted after capture");
    };
    expect((await handlers.feed(request(
      "/api/custom-launch/generic/v2/launches?limit=1",
    ))).status).toBe(200);

    const duplicateStore = store(binding, [value]);
    duplicateStore.findFinalizedLaunches = async ({ requestBindingHash }) =>
      envelopeBytes(binding, requestBindingHash, {
        records: [value, value], nextCursor: null, total: "2",
      });
    const duplicate = createGenericLaunchReadHandlersV2({
      binding,
      store: duplicateStore,
    });
    expect((await duplicate.feed(request(
      "/api/custom-launch/generic/v2/launches?limit=2",
    ))).status).toBe(503);

    const getterStore = store(binding, [value]);
    const getter = getterStore.findFinalizedLaunches;
    Object.defineProperty(getterStore, "findFinalizedLaunches", {
      get: () => getter,
      enumerable: true,
      configurable: true,
    });
    expect(() => createGenericLaunchReadHandlersV2({
      binding,
      store: getterStore,
    })).toThrow(/non-data properties/u);
  });
});
