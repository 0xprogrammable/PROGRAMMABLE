import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { describe, expect, it, vi } from "vitest";

import descriptorSchema from
  "../config/generic-launch-foundation.v1.schema.json";
import descriptorSource from
  "../config/generic-launch-foundation.prelaunch.v1.json";

vi.mock("server-only", () => ({}));

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
  type GenericLaunchRecordV1,
  type RouteAdapterReleaseV1,
  type Sha256Digest,
} from "../lib/server/custom-launch/generic-launch-contract-v1";
import {
  authenticateGenericLaunchReadStoreV1,
  createGenericLaunchReadHandlersV1,
  createGenericLaunchReadStoreAuthenticatorV1,
  PRELAUNCH_GENERIC_LAUNCH_FOUNDATION_DESCRIPTOR_V1,
  type GenericLaunchReadModelContractV1,
  type GenericLaunchReadStoreV1,
} from "../lib/server/custom-launch/generic-launch-read-v1";

const digest = (character: string): Sha256Digest =>
  `sha256:${character.repeat(64)}` as Sha256Digest;
const SUBJECT_SOURCE = digest("d");
const EXECUTION_SOURCE = digest("e");
const VERIFIER_BINDING = digest("f");

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

function subject(subjectSourceBindingHash = SUBJECT_SOURCE) {
  return createApplicantLaunchSubjectV1({
    subjectSourceBindingHash,
    sourceRepository: { forge: "github", repositoryId: "1000000001" },
    application: {
      repositoryId: "2000000001",
      pullRequestNumber: 7,
      approvalBindingHash: digest("a"),
    },
    sourceRevision: {
      commitObjectId: "b".repeat(40),
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
    readModelVerifierBindingHash: VERIFIER_BINDING,
    routeAdapterReleases: [...releases].sort((left, right) =>
      left.releaseHash.localeCompare(right.releaseHash)),
    api: {
      feedPath: "/api/custom-launch/generic/v1/launches",
      detailPathTemplate:
        "/api/custom-launch/generic/v1/launches/{recordHash}",
    },
  } as const;
}

function store(
  records: readonly GenericLaunchRecordV1[],
  readModelContract: GenericLaunchReadModelContractV1 = READ_MODEL_CONTRACT,
): GenericLaunchReadStoreV1 {
  return {
    sourceLane: "generic.finalized-launch",
    readModelContract,
    async findFinalizedLaunches({ limit, cursor }) {
      const offset = cursor === undefined ? 0 : Number(cursor.slice(1));
      const page = records.slice(offset, offset + limit);
      const nextOffset = offset + page.length;
      return {
        records: page,
        nextCursor: nextOffset < records.length ? `c${nextOffset}` : null,
        total: String(records.length),
      };
    },
    async findFinalizedLaunchByRecordHash({ recordHash }) {
      return records.find((record) => record.recordHash === recordHash) ?? null;
    },
  };
}

async function authenticatedStore(
  descriptor: ReturnType<typeof activeDescriptor>,
  readStore: GenericLaunchReadStoreV1,
) {
  const authenticator = createGenericLaunchReadStoreAuthenticatorV1({
    verifierBindingHash: VERIFIER_BINDING,
    async verifyCanonicalReadModel(evidence) {
      return evidence.activationBindingHash === descriptor.activationBindingHash
        && evidence.subjectSourceBindingHash === SUBJECT_SOURCE
        && evidence.executionResultSourceBindingHash === EXECUTION_SOURCE
        && evidence.readModelBindingHash === READ_MODEL_BINDING
        && evidence.verifierBindingHash === VERIFIER_BINDING
        && evidence.canonicalReadModelContract.includes(
          "programmable.generic-launch-read-model-contract.v1",
        );
    },
  });
  return authenticateGenericLaunchReadStoreV1({
    descriptor,
    store: readStore,
    authenticator,
    signal: new AbortController().signal,
  });
}

function request(path: string): Request {
  return new Request(`https://programmable.family${path}`, {
    headers: { accept: "application/json" },
  });
}

describe("generic launch V1 canonical contracts", () => {
  it("content-addresses Applicant, adapter, execution and public record bytes", () => {
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

  it("rejects cross-subject, cross-adapter, failed and non-final records", () => {
    const launchSubject = subject();
    const release = adapter();
    const result = executionResult(launchSubject, release);
    const otherRelease = adapter("adapter-b", "0");

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
      executionResult: { ...result, status: "failed" },
      readModelBindingHash: READ_MODEL_BINDING,
      publicProjectionHash: digest("7"),
    })).toThrow();
    expect(() => createCandidateExecutionResultV1({
      ...result,
      finality: { ...result.finality, observedConfirmations: 1 },
    })).toThrow(/not final/u);
  });

  it("binds an N-valued adapter set without release identity equivocation", () => {
    const releases = [adapter("adapter-a", "e"), adapter("adapter-b", "0")];
    const sorted = [...releases].sort((left, right) =>
      left.releaseHash.localeCompare(right.releaseHash));
    const descriptor = activeDescriptor(releases);
    expect(parseGenericLaunchFoundationDescriptorV1(descriptor)).toEqual(descriptor);
    expect(descriptor.routeAdapterReleases?.map(({ releaseHash }) => releaseHash))
      .toEqual(sorted.map(({ releaseHash }) => releaseHash));
    expect(createActiveGenericLaunchFoundationDescriptorV1({
      ...activeDescriptorInput(releases),
      routeAdapterReleases: [...sorted].reverse(),
    }).routeAdapterReleases).toEqual(sorted);

    const sameIdentity = adapter("adapter-a", "0");
    expect(() => createActiveGenericLaunchFoundationDescriptorV1({
      ...activeDescriptorInput(releases),
      routeAdapterReleases: [adapter(), sameIdentity].sort((left, right) =>
        left.releaseHash.localeCompare(right.releaseHash)),
    })).toThrow(/identities must be unique/u);
  });

  it("derives activation from every source, verifier, adapter and API binding", () => {
    const descriptor = activeDescriptor([adapter()]);
    for (const mutation of [
      { subjectSourceBindingHash: digest("0") },
      { executionResultSourceBindingHash: digest("0") },
      { readModelBindingHash: digest("0") },
      { readModelVerifierBindingHash: digest("0") },
      { activatedAt: "2026-08-13T00:00:01.000Z" },
    ]) {
      expect(() => parseGenericLaunchFoundationDescriptorV1({
        ...descriptor,
        ...mutation,
      })).toThrow(/activation binding/u);
    }
  });
});

describe("generic launch V1 schema and dark API", () => {
  it("keeps schema/runtime parity for the checked-in descriptor and contracts", () => {
    expect(PRELAUNCH_GENERIC_LAUNCH_FOUNDATION_DESCRIPTOR_V1).toEqual(
      descriptorSource,
    );
    expect(PRELAUNCH_GENERIC_LAUNCH_FOUNDATION_DESCRIPTOR_V1).toMatchObject({
      activation: false,
      activationBindingHash: null,
      subjectSourceBindingHash: null,
      executionResultSourceBindingHash: null,
      readModelBindingHash: null,
      readModelVerifierBindingHash: null,
      routeAdapterReleases: null,
    });

    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    const validate = ajv.compile(descriptorSchema);
    expect(validate(descriptorSource), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...descriptorSource, routeAdapterReleases: [] })).toBe(false);

    const launchSubject = subject();
    const release = adapter();
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

    expect(validate({
      ...activeDescriptor([release]),
      activatedAt: "2026-08-13T00:00:00Z",
    })).toBe(false);
    expect(validate({
      ...activeDescriptor([release]),
      routeAdapterReleases: [release, release],
    })).toBe(false);
  });

  it("returns fail-closed responses before an authenticated store can be bound", async () => {
    const handlers = createGenericLaunchReadHandlersV1({
      descriptor: PRELAUNCH_GENERIC_LAUNCH_FOUNDATION_DESCRIPTOR_V1,
      authenticatedStore: null,
    });
    const feed = await handlers.feed(request(
      "/api/custom-launch/generic/v1/launches",
    ));
    const detail = await handlers.detail(
      request(`/api/custom-launch/generic/v1/launches/${digest("1")}`),
      digest("1"),
    );
    expect(feed.status).toBe(503);
    expect(detail.status).toBe(503);
    await expect(feed.json()).resolves.toMatchObject({
      code: "generic_launch_foundation_not_active",
    });
  });

  it("authenticates the exact read-model contract and rejects substitution", async () => {
    const descriptor = activeDescriptor([adapter()]);
    const readStore = store([launchRecord()]);
    await expect(authenticatedStore(descriptor, readStore)).resolves.toBeDefined();

    const substituted = store([launchRecord()], {
      ...READ_MODEL_CONTRACT,
      persistenceBindingHash: digest("0"),
    });
    await expect(authenticatedStore(descriptor, substituted)).rejects.toThrow(
      /not descriptor-bound/u,
    );

    const mutableStore = store([launchRecord()]);
    const capability = await authenticatedStore(descriptor, mutableStore);
    mutableStore.findFinalizedLaunches = async () => ({
      records: [], nextCursor: null, total: "0",
    });
    const handlers = createGenericLaunchReadHandlersV1({
      descriptor,
      authenticatedStore: capability,
    });
    const response = await handlers.feed(request(
      "/api/custom-launch/generic/v1/launches",
    ));
    await expect(response.json()).resolves.toMatchObject({ total: "1" });
  });

  it("serves paginated descriptor-bound records and rejects source substitution", async () => {
    const release = adapter();
    const descriptor = activeDescriptor([release]);
    const record = launchRecord(subject(), release);
    const readStore = store([record]);
    const capability = await authenticatedStore(descriptor, readStore);
    const handlers = createGenericLaunchReadHandlersV1({
      descriptor,
      authenticatedStore: capability,
    });
    const feed = await handlers.feed(request(
      "/api/custom-launch/generic/v1/launches?limit=1",
    ));
    const detail = await handlers.detail(
      request(`/api/custom-launch/generic/v1/launches/${record.recordHash}`),
      record.recordHash,
    );
    expect(feed.status).toBe(200);
    expect(detail.status).toBe(200);
    await expect(feed.json()).resolves.toMatchObject({
      records: [record], nextCursor: null, total: "1",
    });

    const wrongSource = launchRecord(subject(digest("0")), release);
    const wrongStore = store([wrongSource]);
    const wrongCapability = await authenticatedStore(descriptor, wrongStore);
    const wrongHandlers = createGenericLaunchReadHandlersV1({
      descriptor,
      authenticatedStore: wrongCapability,
    });
    expect((await wrongHandlers.feed(request(
      "/api/custom-launch/generic/v1/launches",
    ))).status).toBe(503);

    const wrongExecutionSource = launchRecord(
      subject(), release, digest("0"),
    );
    const executionStore = store([wrongExecutionSource]);
    const executionCapability = await authenticatedStore(
      descriptor,
      executionStore,
    );
    expect((await createGenericLaunchReadHandlersV1({
      descriptor,
      authenticatedStore: executionCapability,
    }).feed(request("/api/custom-launch/generic/v1/launches"))).status).toBe(503);

    const unboundRelease = adapter("adapter-b", "0");
    const unboundStore = store([launchRecord(subject(), unboundRelease)]);
    const unboundCapability = await authenticatedStore(descriptor, unboundStore);
    expect((await createGenericLaunchReadHandlersV1({
      descriptor,
      authenticatedStore: unboundCapability,
    }).feed(request("/api/custom-launch/generic/v1/launches"))).status).toBe(503);
  });

  it("rejects duplicate/oversized pages, noncanonical cursors and detail key mismatch", async () => {
    const release = adapter();
    const descriptor = activeDescriptor([release]);
    const record = launchRecord(subject(), release);
    const duplicateStore: GenericLaunchReadStoreV1 = {
      ...store([record]),
      async findFinalizedLaunches() {
        return { records: [record, record], nextCursor: null, total: "2" };
      },
      async findFinalizedLaunchByRecordHash() {
        return record;
      },
    };
    const capability = await authenticatedStore(descriptor, duplicateStore);
    const handlers = createGenericLaunchReadHandlersV1({
      descriptor,
      authenticatedStore: capability,
    });
    expect((await handlers.feed(request(
      "/api/custom-launch/generic/v1/launches?limit=2",
    ))).status).toBe(503);
    expect((await handlers.feed(request(
      "/api/custom-launch/generic/v1/launches?cursor=x&limit=1",
    ))).status).toBe(400);
    expect((await handlers.detail(
      request(`/api/custom-launch/generic/v1/launches/${digest("0")}`),
      digest("0"),
    )).status).toBe(503);

    const oversizedStore: GenericLaunchReadStoreV1 = {
      ...store([record]),
      async findFinalizedLaunches() {
        return {
          records: Array.from({ length: 101 }, () => record),
          nextCursor: "c101",
          total: "101",
        };
      },
    };
    const oversizedCapability = await authenticatedStore(
      descriptor,
      oversizedStore,
    );
    expect((await createGenericLaunchReadHandlersV1({
      descriptor,
      authenticatedStore: oversizedCapability,
    }).feed(request("/api/custom-launch/generic/v1/launches"))).status).toBe(503);
  });
});
