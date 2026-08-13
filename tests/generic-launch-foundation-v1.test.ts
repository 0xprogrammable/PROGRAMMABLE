import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { describe, expect, it, vi } from "vitest";

import descriptorSchema from
  "../config/generic-launch-foundation.v1.schema.json";
import descriptorSource from
  "../config/generic-launch-foundation.prelaunch.v1.json";

vi.mock("server-only", () => ({}));

import {
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
  createGenericLaunchReadHandlersV1,
  PRELAUNCH_GENERIC_LAUNCH_FOUNDATION_DESCRIPTOR_V1,
  type GenericLaunchReadStoreV1,
} from "../lib/server/custom-launch/generic-launch-read-v1";

const digest = (character: string): Sha256Digest =>
  `sha256:${character.repeat(64)}` as Sha256Digest;

function subject() {
  return createApplicantLaunchSubjectV1({
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
    principalBindingHash: digest("d"),
  });
}

function adapter(adapterId = "adapter-a", sourceByte = "e") {
  return createRouteAdapterReleaseV1({
    adapterId,
    releaseVersion: "1.0.0",
    sourceRepository: { forge: "github", repositoryId: "3000000001" },
    sourceRevision: {
      commitObjectId: sourceByte.repeat(40),
      treeObjectId: "f".repeat(40),
    },
    contractBindings: {
      subjectContractHash: digest("1"),
      executionContractHash: digest("2"),
      indexingContractHash: digest("3"),
      presentationContractHash: digest("4"),
    },
    artifactManifestHash: digest("5"),
  });
}

function executionResult(
  launchSubject = subject(),
  release = adapter(),
) {
  return createCandidateExecutionResultV1({
    attemptId: digest("6"),
    subjectHash: launchSubject.subjectHash,
    routeAdapterReleaseHash: release.releaseHash,
    status: "succeeded",
    network: { caip2: "eip155:1" },
    transaction: {
      transactionHash: `0x${"7".repeat(64)}`,
      blockHash: `0x${"8".repeat(64)}`,
      blockNumber: "123",
      transactionIndex: 0,
    },
    finality: {
      requiredConfirmations: 2,
      observedConfirmations: 2,
      policyBindingHash: digest("9"),
      evidenceBindingHash: digest("a"),
      observedAt: "2026-08-13T00:00:00.000Z",
    },
    resultPayloadHash: digest("b"),
  });
}

function launchRecord(
  launchSubject = subject(),
  release = adapter(),
): GenericLaunchRecordV1 {
  return createGenericLaunchRecordV1({
    subject: launchSubject,
    routeAdapterRelease: release,
    executionResult: executionResult(launchSubject, release),
    publicProjectionHash: digest("c"),
  });
}

function activeDescriptor(releases: readonly RouteAdapterReleaseV1[]) {
  return parseGenericLaunchFoundationDescriptorV1({
    schemaVersion: "programmable.generic-launch-foundation-descriptor.v1",
    activation: true,
    activationBindingHash: digest("d"),
    activatedAt: "2026-08-13T00:00:00.000Z",
    subjectSourceBindingHash: digest("e"),
    executionResultSourceBindingHash: digest("f"),
    readModelBindingHash: digest("1"),
    routeAdapterReleases: [...releases].sort((left, right) =>
      left.releaseHash.localeCompare(right.releaseHash)),
    api: {
      feedPath: "/api/custom-launch/generic/v1/launches",
      detailPathTemplate:
        "/api/custom-launch/generic/v1/launches/{recordHash}",
    },
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
    const record = createGenericLaunchRecordV1({
      subject: launchSubject,
      routeAdapterRelease: release,
      executionResult: result,
      publicProjectionHash: digest("c"),
    });

    expect(parseApplicantLaunchSubjectV1(launchSubject)).toEqual(launchSubject);
    expect(parseRouteAdapterReleaseV1(release)).toEqual(release);
    expect(parseCandidateExecutionResultV1(result)).toEqual(result);
    expect(parseGenericLaunchRecordV1(record)).toEqual(record);

    expect(() => parseApplicantLaunchSubjectV1({
      ...launchSubject,
      sourceRevision: {
        ...launchSubject.sourceRevision,
        treeObjectId: "0".repeat(40),
      },
    })).toThrow(/subject hash/u);
    expect(() => parseRouteAdapterReleaseV1({
      ...release,
      artifactManifestHash: digest("0"),
    })).toThrow(/release hash/u);
    expect(() => parseCandidateExecutionResultV1({
      ...result,
      resultPayloadHash: digest("0"),
    })).toThrow(/result hash/u);
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
      publicProjectionHash: digest("c"),
    })).toThrow(/bindings are inconsistent/u);
    expect(() => createGenericLaunchRecordV1({
      subject: launchSubject,
      routeAdapterRelease: release,
      executionResult: { ...result, status: "failed" },
      publicProjectionHash: digest("c"),
    })).toThrow();
    expect(() => createCandidateExecutionResultV1({
      ...result,
      finality: { ...result.finality, observedConfirmations: 1 },
    })).toThrow(/not final/u);
  });

  it("supports a bounded N-valued, content-addressed adapter release set", () => {
    const releases = [adapter("adapter-a", "e"), adapter("adapter-b", "0")];
    const sorted = [...releases].sort((left, right) =>
      left.releaseHash.localeCompare(right.releaseHash));
    const descriptor = activeDescriptor(releases);
    expect(descriptor.activation).toBe(true);
    expect(descriptor.routeAdapterReleases).toHaveLength(2);
    expect(descriptor.routeAdapterReleases?.map(({ releaseHash }) => releaseHash))
      .toEqual(sorted.map(({ releaseHash }) => releaseHash));

    expect(() => parseGenericLaunchFoundationDescriptorV1({
      ...descriptor,
      routeAdapterReleases: [...sorted].reverse(),
    })).toThrow(/unique and hash-sorted/u);
    expect(() => parseGenericLaunchFoundationDescriptorV1({
      ...descriptor,
      routeAdapterReleases: [],
    })).toThrow(/release set is invalid/u);
  });
});

describe("generic launch V1 schema and dark API", () => {
  it("keeps the checked-in production descriptor inactive with only null bindings", () => {
    expect(PRELAUNCH_GENERIC_LAUNCH_FOUNDATION_DESCRIPTOR_V1).toEqual(
      descriptorSource,
    );
    expect(PRELAUNCH_GENERIC_LAUNCH_FOUNDATION_DESCRIPTOR_V1).toMatchObject({
      activation: false,
      activationBindingHash: null,
      subjectSourceBindingHash: null,
      executionResultSourceBindingHash: null,
      readModelBindingHash: null,
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
    const record = createGenericLaunchRecordV1({
      subject: launchSubject,
      routeAdapterRelease: release,
      executionResult: result,
      publicProjectionHash: digest("c"),
    });
    for (const [definition, value] of [
      ["applicantLaunchSubject", launchSubject],
      ["routeAdapterRelease", release],
      ["candidateExecutionResult", result],
      ["genericLaunchRecord", record],
    ] as const) {
      const component = ajv.compile({
        $ref: `${descriptorSchema.$id}#/$defs/${definition}`,
      });
      expect(component(value), JSON.stringify(component.errors)).toBe(true);
    }
  });

  it("returns fail-closed prelaunch responses before any read store can be bound", async () => {
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
    expect(feed.status).toBe(503);
    expect(detail.status).toBe(503);
    await expect(feed.json()).resolves.toMatchObject({
      code: "generic_launch_foundation_not_active",
    });
    expect(() => createGenericLaunchReadHandlersV1({
      descriptor: PRELAUNCH_GENERIC_LAUNCH_FOUNDATION_DESCRIPTOR_V1,
      store: {} as GenericLaunchReadStoreV1,
    })).toThrow(/cannot bind a read store/u);
  });

  it("serves only canonical finalized records from an activated, adapter-bound store", async () => {
    const release = adapter();
    const record = launchRecord(subject(), release);
    const store: GenericLaunchReadStoreV1 = {
      sourceLane: "generic.finalized-launch",
      bindingHash: digest("1"),
      async findFinalizedLaunches() {
        return [record];
      },
      async findFinalizedLaunchByRecordHash({ recordHash }) {
        return recordHash === record.recordHash ? record : null;
      },
    };
    const handlers = createGenericLaunchReadHandlersV1({
      descriptor: activeDescriptor([release]),
      store,
    });
    const feed = await handlers.feed(request(
      "/api/custom-launch/generic/v1/launches",
    ));
    const detail = await handlers.detail(
      request(`/api/custom-launch/generic/v1/launches/${record.recordHash}`),
      record.recordHash,
    );
    expect(feed.status).toBe(200);
    expect(detail.status).toBe(200);
    await expect(feed.json()).resolves.toMatchObject({ records: [record] });
    await expect(detail.json()).resolves.toMatchObject({ record });

    const unboundHandlers = createGenericLaunchReadHandlersV1({
      descriptor: activeDescriptor([adapter("adapter-b", "0")]),
      store,
    });
    expect((await unboundHandlers.feed(request(
      "/api/custom-launch/generic/v1/launches",
    ))).status).toBe(503);

    expect(() => createGenericLaunchReadHandlersV1({
      descriptor: activeDescriptor([release]),
      store: { ...store, bindingHash: digest("2") },
    })).toThrow(/read store binding is invalid/u);
  });
});
