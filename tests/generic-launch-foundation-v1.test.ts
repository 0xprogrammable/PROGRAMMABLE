import {
  createHash,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { describe, expect, it, vi } from "vitest";

import descriptorSchema from
  "../config/generic-launch-foundation.v1.schema.json";
import descriptorSource from
  "../config/generic-launch-foundation.prelaunch.v1.json";

vi.mock("server-only", () => ({}));

import {
  canonicalizeJson,
  type JsonValue,
} from "../lib/server/projection-target/canonical-json";
import { canonicalSha256 } from
  "../lib/server/projection-target/hashing";
import {
  createActiveGenericLaunchFoundationDescriptorV1,
  createApplicantLaunchSubjectV1,
  createCandidateExecutionResultV1,
  createGenericLaunchRecordV1,
  createRouteAdapterReleaseV1,
  parseApplicantLaunchSubjectV1,
  parseCandidateExecutionResultV1,
  parseGenericLaunchFoundationDescriptorV1,
  parseGenericLaunchRecordV1,
  parseRouteAdapterReleaseV1,
  type GenericLaunchFoundationDescriptorV1,
  type GenericLaunchRecordV1,
  type RouteAdapterReleaseV1,
  type Sha256Digest,
} from "../lib/server/custom-launch/generic-launch-contract-v1";
import {
  createGenericLaunchReadHandlersV1,
  PRELAUNCH_GENERIC_LAUNCH_FOUNDATION_DESCRIPTOR_V1,
  type GenericLaunchReadModelContractV1,
  type GenericLaunchReadStoreV1,
  type SignedGenericLaunchReadEnvelopeV1,
} from "../lib/server/custom-launch/generic-launch-read-v1";

const digest = (character: string): Sha256Digest =>
  `sha256:${character.repeat(64)}` as Sha256Digest;
const SUBJECT_SOURCE = digest("d");
const EXECUTION_SOURCE = digest("e");

const READ_MODEL_CONTRACT = Object.freeze({
  schemaVersion: "programmable.generic-launch-read-model-contract.v1" as const,
  sourceLane: "generic.finalized-launch" as const,
  implementationBindingHash: digest("1"),
  persistenceBindingHash: digest("2"),
  queryContractBindingHash: digest("3"),
});
const READ_MODEL_BINDING = canonicalSha256(
  READ_MODEL_CONTRACT.schemaVersion,
  READ_MODEL_CONTRACT,
);

const signingKeys = generateKeyPairSync("ed25519");
const signingPublicKeySpki = signingKeys.publicKey.export({
  format: "der",
  type: "spki",
}) as Buffer;
const READ_MODEL_VERIFIER = Object.freeze({
  algorithm: "ed25519" as const,
  publicKeySpkiBase64Url: signingPublicKeySpki.toString("base64url"),
  publicKeySha256: (
    `sha256:${createHash("sha256").update(signingPublicKeySpki).digest("hex")}`
  ) as Sha256Digest,
});

function subject(
  subjectSourceBindingHash = SUBJECT_SOURCE,
  sourceByte = "b",
) {
  return createApplicantLaunchSubjectV1({
    subjectSourceBindingHash,
    sourceRepository: { forge: "github", repositoryId: "1000000001" },
    application: {
      repositoryId: "2000000001",
      pullRequestNumber: 7,
      approvalBindingHash: digest("a"),
    },
    sourceRevision: {
      commitObjectId: sourceByte.repeat(40),
      treeObjectId: "c".repeat(40),
    },
    principalBindingHash: digest("4"),
  });
}

function adapter(adapterId = "adapter-a", sourceByte = "e", version = "1.0.0") {
  return createRouteAdapterReleaseV1({
    adapterId,
    releaseVersion: version,
    sourceRepository: { forge: "github", repositoryId: "3000000001" },
    sourceRevision: {
      commitObjectId: sourceByte.repeat(40),
      treeObjectId: "f".repeat(40),
    },
    contractBindings: {
      subjectContractHash: digest("5"),
      executionContractHash: digest("6"),
      indexingContractHash: digest("7"),
      presentationContractHash: digest("8"),
    },
    artifactManifestHash: digest("9"),
  });
}

function executionResult(
  launchSubject = subject(),
  release = adapter(),
  executionResultSourceBindingHash = EXECUTION_SOURCE,
) {
  return createCandidateExecutionResultV1({
    executionResultSourceBindingHash,
    attemptId: digest("a"),
    subjectHash: launchSubject.subjectHash,
    routeAdapterReleaseHash: release.releaseHash,
    status: "succeeded",
    network: { caip2: "eip155:1" },
    transaction: {
      transactionHash: `0x${"b".repeat(64)}`,
      blockHash: `0x${"c".repeat(64)}`,
      blockNumber: "123",
      transactionIndex: 0,
    },
    finality: {
      requiredConfirmations: 2,
      observedConfirmations: 2,
      policyBindingHash: digest("4"),
      evidenceBindingHash: digest("5"),
      observedAt: "2026-08-13T00:00:00.000Z",
    },
    resultPayloadHash: digest("6"),
  });
}

function launchRecord(
  launchSubject = subject(),
  release = adapter(),
  executionResultSourceBindingHash = EXECUTION_SOURCE,
  readModelBindingHash = READ_MODEL_BINDING,
): GenericLaunchRecordV1 {
  return createGenericLaunchRecordV1({
    subject: launchSubject,
    routeAdapterRelease: release,
    executionResult: executionResult(
      launchSubject,
      release,
      executionResultSourceBindingHash,
    ),
    readModelBindingHash,
    publicProjectionHash: digest("7"),
  });
}

function releaseMap(releases: readonly RouteAdapterReleaseV1[]) {
  return Object.fromEntries(releases.map((release) => [
    `${release.adapterId}@${release.releaseVersion}`,
    release,
  ]));
}

function activeDescriptor(releases: readonly RouteAdapterReleaseV1[]) {
  return createActiveGenericLaunchFoundationDescriptorV1(
    activeDescriptorInput(releases),
  );
}

function activeDescriptorInput(releases: readonly RouteAdapterReleaseV1[]) {
  return {
    activatedAt: "2026-08-13T00:00:00.000Z",
    subjectSourceBindingHash: SUBJECT_SOURCE,
    executionResultSourceBindingHash: EXECUTION_SOURCE,
    readModelBindingHash: READ_MODEL_BINDING,
    readModelVerifier: READ_MODEL_VERIFIER,
    routeAdapterReleases: releaseMap(releases),
    api: {
      feedPath: "/api/custom-launch/generic/v1/launches",
      detailPathTemplate:
        "/api/custom-launch/generic/v1/launches/{recordHash}",
    },
  } as const;
}

function signedEnvelope(
  descriptor: GenericLaunchFoundationDescriptorV1,
  requestBindingHash: Sha256Digest,
  payload: unknown,
  privateKey: KeyObject = signingKeys.privateKey,
): SignedGenericLaunchReadEnvelopeV1 {
  if (descriptor.activationBindingHash === null
    || descriptor.readModelBindingHash === null) {
    throw new TypeError("test descriptor must be active");
  }
  const message = Object.freeze({
    schemaVersion: "programmable.generic-launch-read-signature-message.v1" as const,
    activationBindingHash: descriptor.activationBindingHash,
    readModelBindingHash: descriptor.readModelBindingHash,
    requestBindingHash,
    payload,
  });
  return Object.freeze({
    schemaVersion: "programmable.signed-generic-launch-read-envelope.v1" as const,
    activationBindingHash: descriptor.activationBindingHash,
    readModelBindingHash: descriptor.readModelBindingHash,
    requestBindingHash,
    payload,
    signatureBase64Url: sign(
      null,
      Buffer.from(canonicalizeJson(message as unknown as JsonValue), "utf8"),
      privateKey,
    ).toString("base64url"),
  });
}

function store(
  descriptor: GenericLaunchFoundationDescriptorV1,
  records: readonly GenericLaunchRecordV1[],
  readModelContract: GenericLaunchReadModelContractV1 = READ_MODEL_CONTRACT,
  privateKey: KeyObject = signingKeys.privateKey,
): GenericLaunchReadStoreV1 {
  return {
    sourceLane: "generic.finalized-launch",
    readModelContract,
    async findFinalizedLaunches({ limit, cursor, requestBindingHash }) {
      const offset = cursor === undefined ? 0 : Number(cursor.slice(1));
      const page = records.slice(offset, offset + limit);
      const nextOffset = offset + page.length;
      return signedEnvelope(descriptor, requestBindingHash, {
        records: page,
        nextCursor: nextOffset < records.length ? `c${nextOffset}` : null,
        total: String(records.length),
      }, privateKey);
    },
    async findFinalizedLaunchByRecordHash({
      recordHash,
      requestBindingHash,
    }) {
      return signedEnvelope(
        descriptor,
        requestBindingHash,
        records.find((record) => record.recordHash === recordHash) ?? null,
        privateKey,
      );
    },
  };
}

function request(path: string, accept = "application/json"): Request {
  return new Request(`https://programmable.family${path}`, {
    headers: { accept },
  });
}

describe("generic launch V1 canonical contracts", () => {
  it("content-addresses applicant, adapter, execution and public record bytes", () => {
    const launchSubject = subject();
    const release = adapter();
    const result = executionResult(launchSubject, release);
    const record = launchRecord(launchSubject, release);

    expect(parseApplicantLaunchSubjectV1(launchSubject)).toEqual(launchSubject);
    expect(parseRouteAdapterReleaseV1(release)).toEqual(release);
    expect(parseCandidateExecutionResultV1(result)).toEqual(result);
    expect(parseGenericLaunchRecordV1(record)).toEqual(record);

    expect(() => parseApplicantLaunchSubjectV1({
      ...launchSubject,
      subjectSourceBindingHash: digest("0"),
    })).toThrow(/subject hash/u);
    expect(() => parseRouteAdapterReleaseV1({
      ...release,
      artifactManifestHash: digest("0"),
    })).toThrow(/release hash/u);
    expect(() => parseCandidateExecutionResultV1({
      ...result,
      executionResultSourceBindingHash: digest("0"),
    })).toThrow(/result hash/u);
    expect(() => parseGenericLaunchRecordV1({
      ...record,
      readModelBindingHash: digest("0"),
    })).toThrow(/record hash/u);
  });

  it("rejects cross-bindings, failed results, non-finality and invalid versions", () => {
    const launchSubject = subject();
    const release = adapter();
    const result = executionResult(launchSubject, release);
    const otherRelease = adapter("adapter-b", "0");
    const failedResult = createCandidateExecutionResultV1({
      ...result,
      status: "failed",
    });

    expect(() => createGenericLaunchRecordV1({
      subject: launchSubject,
      routeAdapterRelease: otherRelease,
      executionResult: result,
      readModelBindingHash: READ_MODEL_BINDING,
      publicProjectionHash: digest("7"),
    })).toThrow(/bindings are inconsistent/u);
    expect(() => createGenericLaunchRecordV1({
      subject: launchSubject,
      routeAdapterRelease: release,
      executionResult: failedResult,
      readModelBindingHash: READ_MODEL_BINDING,
      publicProjectionHash: digest("7"),
    })).toThrow(/bindings are inconsistent/u);
    expect(() => createCandidateExecutionResultV1({
      ...result,
      finality: { ...result.finality, observedConfirmations: 1 },
    })).toThrow(/not final/u);
    for (const version of ["1.0.0-..", "1.0.0-01", "01.0.0", "1.0.0-"]) {
      expect(() => adapter("adapter-a", "e", version)).toThrow(/version/u);
    }
    expect(adapter("adapter-a", "e", "1.0.0-01a").releaseVersion)
      .toBe("1.0.0-01a");
  });

  it("binds an N-valued adapter map without release identity equivocation", () => {
    const releases = [adapter("adapter-b", "0"), adapter("adapter-a", "e")];
    const descriptor = activeDescriptor(releases);
    expect(parseGenericLaunchFoundationDescriptorV1(descriptor)).toEqual(descriptor);
    expect(Object.keys(descriptor.routeAdapterReleases ?? {})).toEqual([
      "adapter-a@1.0.0",
      "adapter-b@1.0.0",
    ]);
    expect(() => createActiveGenericLaunchFoundationDescriptorV1({
      ...activeDescriptorInput(releases),
      routeAdapterReleases: {
        "adapter-a@1.0.0": adapter("adapter-b", "0"),
      },
    })).toThrow(/identity/u);
  });

  it("derives activation from every source, verifier, adapter and API binding", () => {
    const descriptor = activeDescriptor([adapter()]);
    for (const mutation of [
      { subjectSourceBindingHash: digest("0") },
      { executionResultSourceBindingHash: digest("0") },
      { readModelBindingHash: digest("0") },
      { readModelVerifierBindingHash: digest("0") },
      { activatedAt: "2026-08-13T00:00:01.000Z" },
      {
        readModelVerifier: {
          ...descriptor.readModelVerifier,
          publicKeySha256: digest("0"),
        },
      },
    ]) {
      expect(() => parseGenericLaunchFoundationDescriptorV1({
        ...descriptor,
        ...mutation,
      })).toThrow(/activation binding/u);
    }
  });
});

describe("generic launch V1 schema and dark API", () => {
  it("keeps schema/runtime parity for checked-in and active contracts", () => {
    expect(PRELAUNCH_GENERIC_LAUNCH_FOUNDATION_DESCRIPTOR_V1).toEqual(
      descriptorSource,
    );
    expect(PRELAUNCH_GENERIC_LAUNCH_FOUNDATION_DESCRIPTOR_V1).toMatchObject({
      activation: false,
      activationBindingHash: null,
      subjectSourceBindingHash: null,
      executionResultSourceBindingHash: null,
      readModelBindingHash: null,
      readModelVerifier: null,
      readModelVerifierBindingHash: null,
      routeAdapterReleases: null,
    });

    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    const validate = ajv.compile(descriptorSchema);
    const release = adapter();
    const descriptor = activeDescriptor([release]);
    expect(validate(descriptorSource), JSON.stringify(validate.errors)).toBe(true);
    expect(validate(descriptor), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...descriptorSource, routeAdapterReleases: [] })).toBe(false);
    expect(validate({ ...descriptor, routeAdapterReleases: [release] })).toBe(false);
    expect(validate({
      ...descriptor,
      activatedAt: "2026-08-13T00:00:00Z",
    })).toBe(false);

    const launchSubject = subject();
    const result = executionResult(launchSubject, release);
    const record = launchRecord(launchSubject, release);
    for (const [definition, value] of [
      ["applicantLaunchSubject", launchSubject],
      ["routeAdapterRelease", release],
      ["candidateExecutionResult", result],
      ["genericLaunchRecord", record],
      ["genericLaunchReadModelContract", READ_MODEL_CONTRACT],
    ] as const) {
      const component = ajv.compile({
        $ref: `${descriptorSchema.$id}#/$defs/${definition}`,
      });
      expect(component(value), JSON.stringify(component.errors)).toBe(true);
    }
    const releaseComponent = ajv.compile({
      $ref: `${descriptorSchema.$id}#/$defs/routeAdapterRelease`,
    });
    for (const version of ["1.0.0-..", "1.0.0-01", "01.0.0", "1.0.0-"]) {
      expect(releaseComponent({ ...release, releaseVersion: version })).toBe(false);
    }
    expect(releaseComponent({
      ...release,
      releaseVersion: "1.0.0-01a",
    })).toBe(true);
    const envelopeComponent = ajv.compile({
      $ref: `${descriptorSchema.$id}#/$defs/signedGenericLaunchReadEnvelope`,
    });
    expect(envelopeComponent(signedEnvelope(
      descriptor,
      digest("0"),
      { records: [], nextCursor: null, total: "0" },
    )), JSON.stringify(envelopeComponent.errors)).toBe(true);
  });

  it("returns canonical fail-closed responses while activation is absent", async () => {
    const handlers = createGenericLaunchReadHandlersV1({
      descriptor: PRELAUNCH_GENERIC_LAUNCH_FOUNDATION_DESCRIPTOR_V1,
      store: null,
    });
    const feed = await handlers.feed(request(
      "/api/custom-launch/generic/v1/launches",
    ));
    const detail = await handlers.detail(
      request(`/api/custom-launch/generic/v1/launches/${digest("1")}`),
      digest("1"),
    );
    const invalid = await handlers.feed(request(
      "/api/custom-launch/generic/v1/launches",
      "*/*",
    ));
    expect(feed.status).toBe(503);
    expect(detail.status).toBe(503);
    expect(invalid.status).toBe(400);
    expect(feed.headers.get("cache-control")).toBe("no-store");
    expect(feed.headers.get("x-content-type-options")).toBe("nosniff");
    await expect(feed.json()).resolves.toMatchObject({
      code: "generic_launch_foundation_not_active",
    });
  });
});

describe("generic launch V1 signed read boundary", () => {
  it("serves signed paginated and detail records bound to exact requests", async () => {
    const release = adapter();
    const descriptor = activeDescriptor([release]);
    const records = [
      launchRecord(subject(SUBJECT_SOURCE, "a"), release),
      launchRecord(subject(SUBJECT_SOURCE, "b"), release),
    ];
    const handlers = createGenericLaunchReadHandlersV1({
      descriptor,
      store: store(descriptor, records),
    });
    const first = await handlers.feed(request(
      "/api/custom-launch/generic/v1/launches?limit=1",
    ));
    const second = await handlers.feed(request(
      "/api/custom-launch/generic/v1/launches?limit=1&cursor=c1",
    ));
    const detail = await handlers.detail(
      request(`/api/custom-launch/generic/v1/launches/${records[1].recordHash}`),
      records[1].recordHash,
    );
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(detail.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({
      records: [records[0]], nextCursor: "c1", total: "2",
    });
    await expect(second.json()).resolves.toMatchObject({
      records: [records[1]], nextCursor: null, total: "2",
    });
    await expect(detail.json()).resolves.toMatchObject({ record: records[1] });
  });

  it("rejects forged signatures, request replay and post-signature mutation", async () => {
    const release = adapter();
    const descriptor = activeDescriptor([release]);
    const record = launchRecord(subject(), release);
    const attacker = generateKeyPairSync("ed25519");
    const forgedHandlers = createGenericLaunchReadHandlersV1({
      descriptor,
      store: store(descriptor, [record], READ_MODEL_CONTRACT, attacker.privateKey),
    });
    expect((await forgedHandlers.feed(request(
      "/api/custom-launch/generic/v1/launches?limit=1",
    ))).status).toBe(503);

    const initialRequestBindingHash = canonicalSha256(
      "programmable.generic-launch-feed-request.v1",
      Object.freeze({ limit: 1, cursor: null }),
    );
    const replayed = signedEnvelope(descriptor, initialRequestBindingHash, {
      records: [record], nextCursor: null, total: "1",
    });
    const replayStore = store(descriptor, [record]);
    replayStore.findFinalizedLaunches = async () => replayed;
    const replayHandlers = createGenericLaunchReadHandlersV1({
      descriptor,
      store: replayStore,
    });
    expect((await replayHandlers.feed(request(
      "/api/custom-launch/generic/v1/launches?limit=1&cursor=c1",
    ))).status).toBe(503);

    const mutationStore = store(descriptor, [record]);
    mutationStore.findFinalizedLaunches = async ({ requestBindingHash }) => {
      const envelope = signedEnvelope(descriptor, requestBindingHash, {
        records: [record], nextCursor: null, total: "1",
      });
      return { ...envelope, payload: { records: [], nextCursor: null, total: "0" } };
    };
    const mutationHandlers = createGenericLaunchReadHandlersV1({
      descriptor,
      store: mutationStore,
    });
    expect((await mutationHandlers.feed(request(
      "/api/custom-launch/generic/v1/launches?limit=1",
    ))).status).toBe(503);
  });

  it("rejects descriptor, source, adapter, cursor and detail substitution", async () => {
    const release = adapter();
    const descriptor = activeDescriptor([release]);
    const validRecord = launchRecord(subject(), release);

    expect(() => createGenericLaunchReadHandlersV1({
      descriptor,
      store: store(descriptor, [validRecord], {
        ...READ_MODEL_CONTRACT,
        persistenceBindingHash: digest("0"),
      }),
    })).toThrow(/not descriptor-bound/u);
    const invalidVerifierDescriptor =
      createActiveGenericLaunchFoundationDescriptorV1({
        ...activeDescriptorInput([release]),
        readModelVerifier: {
          ...READ_MODEL_VERIFIER,
          publicKeySha256: digest("0"),
        },
      });
    expect(() => createGenericLaunchReadHandlersV1({
      descriptor: invalidVerifierDescriptor,
      store: store(invalidVerifierDescriptor, [validRecord]),
    })).toThrow(/public key hash/u);

    for (const invalidRecord of [
      launchRecord(subject(digest("0")), release),
      launchRecord(subject(), release, digest("0")),
      launchRecord(subject(), adapter("adapter-b", "0")),
    ]) {
      const handlers = createGenericLaunchReadHandlersV1({
        descriptor,
        store: store(descriptor, [invalidRecord]),
      });
      expect((await handlers.feed(request(
        "/api/custom-launch/generic/v1/launches?limit=1",
      ))).status).toBe(503);
    }

    const cursorStore = store(descriptor, [validRecord]);
    cursorStore.findFinalizedLaunches = async ({ requestBindingHash }) =>
      signedEnvelope(descriptor, requestBindingHash, {
        records: [validRecord], nextCursor: "c1", total: "1",
      });
    const cursorHandlers = createGenericLaunchReadHandlersV1({
      descriptor,
      store: cursorStore,
    });
    expect((await cursorHandlers.feed(request(
      "/api/custom-launch/generic/v1/launches?limit=1&cursor=c1",
    ))).status).toBe(503);

    for (const invalidPage of [
      { records: [validRecord, validRecord], nextCursor: "c2", total: "2" },
      { records: [validRecord], nextCursor: null, total: "0" },
      { records: [], nextCursor: "c2", total: "0" },
    ]) {
      const invalidPageStore = store(descriptor, [validRecord]);
      invalidPageStore.findFinalizedLaunches = async ({
        requestBindingHash,
      }) => signedEnvelope(descriptor, requestBindingHash, invalidPage);
      const invalidPageHandlers = createGenericLaunchReadHandlersV1({
        descriptor,
        store: invalidPageStore,
      });
      expect((await invalidPageHandlers.feed(request(
        "/api/custom-launch/generic/v1/launches?limit=1",
      ))).status).toBe(503);
    }
    const duplicateStore = store(descriptor, [validRecord]);
    duplicateStore.findFinalizedLaunches = async ({ requestBindingHash }) =>
      signedEnvelope(descriptor, requestBindingHash, {
        records: [validRecord, validRecord], nextCursor: null, total: "2",
      });
    const duplicateHandlers = createGenericLaunchReadHandlersV1({
      descriptor,
      store: duplicateStore,
    });
    expect((await duplicateHandlers.feed(request(
      "/api/custom-launch/generic/v1/launches?limit=2",
    ))).status).toBe(503);

    const detailStore = store(descriptor, [validRecord]);
    detailStore.findFinalizedLaunchByRecordHash = async ({
      requestBindingHash,
    }) => signedEnvelope(descriptor, requestBindingHash, validRecord);
    const detailHandlers = createGenericLaunchReadHandlersV1({
      descriptor,
      store: detailStore,
    });
    expect((await detailHandlers.detail(
      request(`/api/custom-launch/generic/v1/launches/${digest("0")}`),
      digest("0"),
    )).status).toBe(503);
  });

  it("captures exact own data methods once and rejects accessor stores", async () => {
    const release = adapter();
    const descriptor = activeDescriptor([release]);
    const record = launchRecord(subject(), release);
    const mutableStore = store(descriptor, [record]);
    const handlers = createGenericLaunchReadHandlersV1({
      descriptor,
      store: mutableStore,
    });
    mutableStore.findFinalizedLaunches = async () => {
      throw new TypeError("substituted after capture");
    };
    expect((await handlers.feed(request(
      "/api/custom-launch/generic/v1/launches?limit=1",
    ))).status).toBe(200);

    const getterStore = store(descriptor, [record]);
    const getter = getterStore.findFinalizedLaunches;
    Object.defineProperty(getterStore, "findFinalizedLaunches", {
      get: () => getter,
      enumerable: true,
      configurable: true,
    });
    expect(() => createGenericLaunchReadHandlersV1({
      descriptor,
      store: getterStore,
    })).toThrow(/non-data properties/u);
  });
});
