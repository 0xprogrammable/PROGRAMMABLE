import "server-only";

import {
  canonicalSha256,
  type Sha256Digest,
} from "../projection-target/hashing";

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const NUMERIC_ID = /^[1-9][0-9]{0,31}$/u;
const GIT_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const ADAPTER_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
const SEMVER = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const CAIP2 = /^[a-z0-9][a-z0-9-]{2,7}:[A-Za-z0-9][A-Za-z0-9-]{0,31}$/u;
const HASH32 = /^0x[0-9a-f]{64}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]{0,77})$/u;

export const GENERIC_LAUNCH_FEED_PATH_V1 =
  "/api/custom-launch/generic/v1/launches" as const;
export const GENERIC_LAUNCH_DETAIL_PATH_TEMPLATE_V1 =
  "/api/custom-launch/generic/v1/launches/{recordHash}" as const;

export type { Sha256Digest };

export interface ApplicantLaunchSubjectV1 {
  readonly schemaVersion: "programmable.applicant-launch-subject.v1";
  readonly subjectSourceBindingHash: Sha256Digest;
  readonly sourceRepository: Readonly<{
    forge: "github";
    repositoryId: string;
  }>;
  readonly application: Readonly<{
    repositoryId: string;
    pullRequestNumber: number;
    approvalBindingHash: Sha256Digest;
  }>;
  readonly sourceRevision: Readonly<{
    commitObjectId: string;
    treeObjectId: string;
  }>;
  readonly principalBindingHash: Sha256Digest;
  readonly subjectHash: Sha256Digest;
}

export interface RouteAdapterReleaseV1 {
  readonly schemaVersion: "programmable.route-adapter-release.v1";
  readonly adapterId: string;
  readonly releaseVersion: string;
  readonly sourceRepository: Readonly<{
    forge: "github";
    repositoryId: string;
  }>;
  readonly sourceRevision: Readonly<{
    commitObjectId: string;
    treeObjectId: string;
  }>;
  readonly contractBindings: Readonly<{
    subjectContractHash: Sha256Digest;
    executionContractHash: Sha256Digest;
    indexingContractHash: Sha256Digest;
    presentationContractHash: Sha256Digest;
  }>;
  readonly artifactManifestHash: Sha256Digest;
  readonly releaseHash: Sha256Digest;
}

export type CandidateExecutionStatusV1 = "succeeded" | "failed";

export interface CandidateExecutionResultV1 {
  readonly schemaVersion: "programmable.candidate-execution-result.v1";
  readonly executionResultSourceBindingHash: Sha256Digest;
  readonly attemptId: Sha256Digest;
  readonly subjectHash: Sha256Digest;
  readonly routeAdapterReleaseHash: Sha256Digest;
  readonly status: CandidateExecutionStatusV1;
  readonly network: Readonly<{
    caip2: string;
  }>;
  readonly transaction: Readonly<{
    transactionHash: `0x${string}`;
    blockHash: `0x${string}`;
    blockNumber: string;
    transactionIndex: number;
  }>;
  readonly finality: Readonly<{
    requiredConfirmations: number;
    observedConfirmations: number;
    policyBindingHash: Sha256Digest;
    evidenceBindingHash: Sha256Digest;
    observedAt: string;
  }>;
  readonly resultPayloadHash: Sha256Digest;
  readonly resultHash: Sha256Digest;
}

export interface GenericLaunchRecordV1 {
  readonly schemaVersion: "programmable.generic-launch-record.v1";
  readonly subject: ApplicantLaunchSubjectV1;
  readonly routeAdapterRelease: RouteAdapterReleaseV1;
  readonly executionResult: CandidateExecutionResultV1;
  readonly readModelBindingHash: Sha256Digest;
  readonly publicProjectionHash: Sha256Digest;
  readonly recordHash: Sha256Digest;
}

export interface GenericLaunchFoundationDescriptorV1 {
  readonly schemaVersion: "programmable.generic-launch-foundation-descriptor.v1";
  readonly activation: false | true;
  readonly activationBindingHash: Sha256Digest | null;
  readonly activatedAt: string | null;
  readonly subjectSourceBindingHash: Sha256Digest | null;
  readonly executionResultSourceBindingHash: Sha256Digest | null;
  readonly readModelBindingHash: Sha256Digest | null;
  readonly readModelVerifierBindingHash: Sha256Digest | null;
  readonly routeAdapterReleases: readonly RouteAdapterReleaseV1[] | null;
  readonly api: Readonly<{
    feedPath: typeof GENERIC_LAUNCH_FEED_PATH_V1;
    detailPathTemplate: typeof GENERIC_LAUNCH_DETAIL_PATH_TEMPLATE_V1;
  }>;
}

export function createApplicantLaunchSubjectV1(
  input: Omit<ApplicantLaunchSubjectV1, "schemaVersion" | "subjectHash">,
): ApplicantLaunchSubjectV1 {
  const sourceRepository = githubRepository(input.sourceRepository);
  const applicationValue = exactObject(input.application, [
    "approvalBindingHash", "pullRequestNumber", "repositoryId",
  ], "Applicant application binding");
  const application = Object.freeze({
    repositoryId: numericId(applicationValue.repositoryId, "application repository id"),
    pullRequestNumber: positiveInteger(
      applicationValue.pullRequestNumber,
      "application pull request number",
    ),
    approvalBindingHash: digest(
      applicationValue.approvalBindingHash,
      "application approval binding",
    ),
  });
  const sourceRevision = gitRevision(input.sourceRevision);
  const core = Object.freeze({
    schemaVersion: "programmable.applicant-launch-subject.v1" as const,
    subjectSourceBindingHash: digest(
      input.subjectSourceBindingHash,
      "Applicant subject source",
    ),
    sourceRepository,
    application,
    sourceRevision,
    principalBindingHash: digest(
      input.principalBindingHash,
      "Applicant principal binding",
    ),
  });
  return Object.freeze({
    ...core,
    subjectHash: canonicalSha256(core.schemaVersion, core),
  });
}

export function parseApplicantLaunchSubjectV1(
  raw: unknown,
): ApplicantLaunchSubjectV1 {
  const value = exactObject(raw, [
    "application", "principalBindingHash", "schemaVersion", "sourceRepository",
    "sourceRevision", "subjectHash", "subjectSourceBindingHash",
  ], "Applicant launch subject");
  literal(
    value.schemaVersion,
    "programmable.applicant-launch-subject.v1",
    "Applicant launch subject schema",
  );
  const subject = createApplicantLaunchSubjectV1({
    subjectSourceBindingHash: value.subjectSourceBindingHash as Sha256Digest,
    sourceRepository: value.sourceRepository as ApplicantLaunchSubjectV1["sourceRepository"],
    application: value.application as ApplicantLaunchSubjectV1["application"],
    sourceRevision: value.sourceRevision as ApplicantLaunchSubjectV1["sourceRevision"],
    principalBindingHash: value.principalBindingHash as Sha256Digest,
  });
  if (subject.subjectHash !== value.subjectHash) {
    throw new TypeError("Applicant launch subject hash is invalid");
  }
  return subject;
}

export function createRouteAdapterReleaseV1(
  input: Omit<RouteAdapterReleaseV1, "schemaVersion" | "releaseHash">,
): RouteAdapterReleaseV1 {
  const contractValue = exactObject(input.contractBindings, [
    "executionContractHash", "indexingContractHash", "presentationContractHash",
    "subjectContractHash",
  ], "route adapter contract bindings");
  const contractBindings = Object.freeze({
    subjectContractHash: digest(
      contractValue.subjectContractHash,
      "route adapter subject contract",
    ),
    executionContractHash: digest(
      contractValue.executionContractHash,
      "route adapter execution contract",
    ),
    indexingContractHash: digest(
      contractValue.indexingContractHash,
      "route adapter indexing contract",
    ),
    presentationContractHash: digest(
      contractValue.presentationContractHash,
      "route adapter presentation contract",
    ),
  });
  const core = Object.freeze({
    schemaVersion: "programmable.route-adapter-release.v1" as const,
    adapterId: patternedString(input.adapterId, ADAPTER_ID, "route adapter id"),
    releaseVersion: patternedString(
      input.releaseVersion,
      SEMVER,
      "route adapter release version",
      128,
    ),
    sourceRepository: githubRepository(input.sourceRepository),
    sourceRevision: gitRevision(input.sourceRevision),
    contractBindings,
    artifactManifestHash: digest(
      input.artifactManifestHash,
      "route adapter artifact manifest",
    ),
  });
  return Object.freeze({
    ...core,
    releaseHash: canonicalSha256(core.schemaVersion, core),
  });
}

export function parseRouteAdapterReleaseV1(raw: unknown): RouteAdapterReleaseV1 {
  const value = exactObject(raw, [
    "adapterId", "artifactManifestHash", "contractBindings", "releaseHash",
    "releaseVersion", "schemaVersion", "sourceRepository", "sourceRevision",
  ], "route adapter release");
  literal(
    value.schemaVersion,
    "programmable.route-adapter-release.v1",
    "route adapter release schema",
  );
  const release = createRouteAdapterReleaseV1({
    adapterId: value.adapterId as string,
    releaseVersion: value.releaseVersion as string,
    sourceRepository: value.sourceRepository as RouteAdapterReleaseV1["sourceRepository"],
    sourceRevision: value.sourceRevision as RouteAdapterReleaseV1["sourceRevision"],
    contractBindings: value.contractBindings as RouteAdapterReleaseV1["contractBindings"],
    artifactManifestHash: value.artifactManifestHash as Sha256Digest,
  });
  if (release.releaseHash !== value.releaseHash) {
    throw new TypeError("route adapter release hash is invalid");
  }
  return release;
}

export function createCandidateExecutionResultV1(
  input: Omit<CandidateExecutionResultV1, "schemaVersion" | "resultHash">,
): CandidateExecutionResultV1 {
  const networkValue = exactObject(input.network, ["caip2"], "execution network");
  const network = Object.freeze({
    caip2: patternedString(networkValue.caip2, CAIP2, "execution CAIP-2 id"),
  });
  const transactionValue = exactObject(input.transaction, [
    "blockHash", "blockNumber", "transactionHash", "transactionIndex",
  ], "execution transaction");
  const transaction = Object.freeze({
    transactionHash: hash32(
      transactionValue.transactionHash,
      "execution transaction hash",
    ),
    blockHash: hash32(transactionValue.blockHash, "execution block hash"),
    blockNumber: patternedString(
      transactionValue.blockNumber,
      DECIMAL,
      "execution block number",
    ),
    transactionIndex: nonnegativeInteger(
      transactionValue.transactionIndex,
      "execution transaction index",
    ),
  });
  const finalityValue = exactObject(input.finality, [
    "evidenceBindingHash", "observedAt", "observedConfirmations",
    "policyBindingHash", "requiredConfirmations",
  ], "execution finality");
  const finality = Object.freeze({
    requiredConfirmations: positiveInteger(
      finalityValue.requiredConfirmations,
      "required confirmations",
    ),
    observedConfirmations: positiveInteger(
      finalityValue.observedConfirmations,
      "observed confirmations",
    ),
    policyBindingHash: digest(finalityValue.policyBindingHash, "finality policy"),
    evidenceBindingHash: digest(
      finalityValue.evidenceBindingHash,
      "finality evidence",
    ),
    observedAt: instant(finalityValue.observedAt, "finality observation"),
  });
  if (finality.observedConfirmations < finality.requiredConfirmations) {
    throw new TypeError("execution result is not final");
  }
  const status = enumValue(input.status, ["succeeded", "failed"] as const,
    "candidate execution status");
  const core = Object.freeze({
    schemaVersion: "programmable.candidate-execution-result.v1" as const,
    executionResultSourceBindingHash: digest(
      input.executionResultSourceBindingHash,
      "execution result source",
    ),
    attemptId: digest(input.attemptId, "execution attempt id"),
    subjectHash: digest(input.subjectHash, "execution subject"),
    routeAdapterReleaseHash: digest(
      input.routeAdapterReleaseHash,
      "execution route adapter release",
    ),
    status,
    network,
    transaction,
    finality,
    resultPayloadHash: digest(input.resultPayloadHash, "adapter result payload"),
  });
  return Object.freeze({
    ...core,
    resultHash: canonicalSha256(core.schemaVersion, core),
  });
}

export function parseCandidateExecutionResultV1(
  raw: unknown,
): CandidateExecutionResultV1 {
  const value = exactObject(raw, [
    "attemptId", "finality", "network", "resultHash", "resultPayloadHash",
    "routeAdapterReleaseHash", "schemaVersion", "status", "subjectHash",
    "transaction", "executionResultSourceBindingHash",
  ], "candidate execution result");
  literal(
    value.schemaVersion,
    "programmable.candidate-execution-result.v1",
    "candidate execution result schema",
  );
  const result = createCandidateExecutionResultV1({
    executionResultSourceBindingHash:
      value.executionResultSourceBindingHash as Sha256Digest,
    attemptId: value.attemptId as Sha256Digest,
    subjectHash: value.subjectHash as Sha256Digest,
    routeAdapterReleaseHash: value.routeAdapterReleaseHash as Sha256Digest,
    status: value.status as CandidateExecutionStatusV1,
    network: value.network as CandidateExecutionResultV1["network"],
    transaction: value.transaction as CandidateExecutionResultV1["transaction"],
    finality: value.finality as CandidateExecutionResultV1["finality"],
    resultPayloadHash: value.resultPayloadHash as Sha256Digest,
  });
  if (result.resultHash !== value.resultHash) {
    throw new TypeError("candidate execution result hash is invalid");
  }
  return result;
}

export function createGenericLaunchRecordV1(
  input: Omit<GenericLaunchRecordV1, "schemaVersion" | "recordHash">,
): GenericLaunchRecordV1 {
  const subject = parseApplicantLaunchSubjectV1(input.subject);
  const routeAdapterRelease = parseRouteAdapterReleaseV1(
    input.routeAdapterRelease,
  );
  const executionResult = parseCandidateExecutionResultV1(input.executionResult);
  if (
    executionResult.status !== "succeeded"
    || executionResult.subjectHash !== subject.subjectHash
    || executionResult.routeAdapterReleaseHash !== routeAdapterRelease.releaseHash
  ) {
    throw new TypeError("generic launch record bindings are inconsistent");
  }
  const core = Object.freeze({
    schemaVersion: "programmable.generic-launch-record.v1" as const,
    subject,
    routeAdapterRelease,
    executionResult,
    readModelBindingHash: digest(
      input.readModelBindingHash,
      "generic launch read model",
    ),
    publicProjectionHash: digest(
      input.publicProjectionHash,
      "generic launch public projection",
    ),
  });
  return Object.freeze({
    ...core,
    recordHash: canonicalSha256(core.schemaVersion, core),
  });
}

export function parseGenericLaunchRecordV1(raw: unknown): GenericLaunchRecordV1 {
  const value = exactObject(raw, [
    "executionResult", "publicProjectionHash", "recordHash",
    "readModelBindingHash", "routeAdapterRelease", "schemaVersion", "subject",
  ], "generic launch record");
  literal(
    value.schemaVersion,
    "programmable.generic-launch-record.v1",
    "generic launch record schema",
  );
  const record = createGenericLaunchRecordV1({
    subject: value.subject as ApplicantLaunchSubjectV1,
    routeAdapterRelease: value.routeAdapterRelease as RouteAdapterReleaseV1,
    executionResult: value.executionResult as CandidateExecutionResultV1,
    readModelBindingHash: value.readModelBindingHash as Sha256Digest,
    publicProjectionHash: value.publicProjectionHash as Sha256Digest,
  });
  if (record.recordHash !== value.recordHash) {
    throw new TypeError("generic launch record hash is invalid");
  }
  return record;
}

export function parseGenericLaunchFoundationDescriptorV1(
  raw: unknown,
): GenericLaunchFoundationDescriptorV1 {
  const value = exactObject(raw, [
    "activatedAt", "activation", "activationBindingHash", "api",
    "executionResultSourceBindingHash", "readModelBindingHash",
    "readModelVerifierBindingHash",
    "routeAdapterReleases", "schemaVersion", "subjectSourceBindingHash",
  ], "generic launch foundation descriptor");
  literal(
    value.schemaVersion,
    "programmable.generic-launch-foundation-descriptor.v1",
    "generic launch foundation descriptor schema",
  );
  if (typeof value.activation !== "boolean") {
    throw new TypeError("generic launch foundation activation is invalid");
  }
  const apiValue = exactObject(value.api, ["detailPathTemplate", "feedPath"],
    "generic launch API paths");
  literal(apiValue.feedPath, GENERIC_LAUNCH_FEED_PATH_V1, "generic launch feed path");
  literal(
    apiValue.detailPathTemplate,
    GENERIC_LAUNCH_DETAIL_PATH_TEMPLATE_V1,
    "generic launch detail path",
  );
  const api = Object.freeze({
    feedPath: GENERIC_LAUNCH_FEED_PATH_V1,
    detailPathTemplate: GENERIC_LAUNCH_DETAIL_PATH_TEMPLATE_V1,
  });
  if (value.activation === false) {
    if (
      value.activationBindingHash !== null
      || value.activatedAt !== null
      || value.subjectSourceBindingHash !== null
      || value.executionResultSourceBindingHash !== null
      || value.readModelBindingHash !== null
      || value.readModelVerifierBindingHash !== null
      || value.routeAdapterReleases !== null
    ) {
      throw new TypeError("disabled generic launch foundation must retain null bindings");
    }
    return Object.freeze({
      schemaVersion: "programmable.generic-launch-foundation-descriptor.v1" as const,
      activation: false as const,
      activationBindingHash: null,
      activatedAt: null,
      subjectSourceBindingHash: null,
      executionResultSourceBindingHash: null,
      readModelBindingHash: null,
      readModelVerifierBindingHash: null,
      routeAdapterReleases: null,
      api,
    });
  }
  if (!Array.isArray(value.routeAdapterReleases)
    || value.routeAdapterReleases.length < 1
    || value.routeAdapterReleases.length > 256) {
    throw new TypeError("active generic launch adapter release set is invalid");
  }
  const routeAdapterReleases = Object.freeze(
    value.routeAdapterReleases.map(parseRouteAdapterReleaseV1).sort(
      (left, right) => left.releaseHash.localeCompare(right.releaseHash),
    ),
  );
  const releaseHashes = routeAdapterReleases.map(({ releaseHash }) => releaseHash);
  const releaseIdentities = routeAdapterReleases.map(
    ({ adapterId, releaseVersion }) => `${adapterId}\0${releaseVersion}`,
  );
  if (new Set(releaseHashes).size !== releaseHashes.length
    || new Set(releaseIdentities).size !== releaseIdentities.length) {
    throw new TypeError("generic launch adapter release identities must be unique");
  }
  const descriptor = createActiveGenericLaunchFoundationDescriptorV1({
    activatedAt: value.activatedAt as string,
    subjectSourceBindingHash: value.subjectSourceBindingHash as Sha256Digest,
    executionResultSourceBindingHash:
      value.executionResultSourceBindingHash as Sha256Digest,
    readModelBindingHash: value.readModelBindingHash as Sha256Digest,
    readModelVerifierBindingHash:
      value.readModelVerifierBindingHash as Sha256Digest,
    routeAdapterReleases,
    api,
  });
  if (descriptor.activationBindingHash !== value.activationBindingHash) {
    throw new TypeError("generic launch activation binding is invalid");
  }
  return descriptor;
}

export function createActiveGenericLaunchFoundationDescriptorV1(
  input: Readonly<{
    activatedAt: string;
    subjectSourceBindingHash: Sha256Digest;
    executionResultSourceBindingHash: Sha256Digest;
    readModelBindingHash: Sha256Digest;
    readModelVerifierBindingHash: Sha256Digest;
    routeAdapterReleases: readonly RouteAdapterReleaseV1[];
    api: Readonly<{
      feedPath: typeof GENERIC_LAUNCH_FEED_PATH_V1;
      detailPathTemplate: typeof GENERIC_LAUNCH_DETAIL_PATH_TEMPLATE_V1;
    }>;
  }>,
): GenericLaunchFoundationDescriptorV1 {
  if (!Array.isArray(input.routeAdapterReleases)
    || input.routeAdapterReleases.length < 1
    || input.routeAdapterReleases.length > 256) {
    throw new TypeError("active generic launch adapter release set is invalid");
  }
  const routeAdapterReleases = Object.freeze(
    input.routeAdapterReleases.map(parseRouteAdapterReleaseV1).sort(
      (left, right) => left.releaseHash.localeCompare(right.releaseHash),
    ),
  );
  const routeAdapterReleaseHashes = routeAdapterReleases.map(
    ({ releaseHash }) => releaseHash,
  );
  const routeAdapterReleaseIdentities = routeAdapterReleases.map(
    ({ adapterId, releaseVersion }) => `${adapterId}\0${releaseVersion}`,
  );
  if (new Set(routeAdapterReleaseHashes).size !== routeAdapterReleaseHashes.length
    || new Set(routeAdapterReleaseIdentities).size
      !== routeAdapterReleaseIdentities.length) {
    throw new TypeError("generic launch adapter release identities must be unique");
  }
  const apiValue = exactObject(input.api, ["detailPathTemplate", "feedPath"],
    "generic launch API paths");
  literal(apiValue.feedPath, GENERIC_LAUNCH_FEED_PATH_V1, "generic launch feed path");
  literal(
    apiValue.detailPathTemplate,
    GENERIC_LAUNCH_DETAIL_PATH_TEMPLATE_V1,
    "generic launch detail path",
  );
  const api = Object.freeze({
    feedPath: GENERIC_LAUNCH_FEED_PATH_V1,
    detailPathTemplate: GENERIC_LAUNCH_DETAIL_PATH_TEMPLATE_V1,
  });
  const activatedAt = instant(input.activatedAt, "generic launch activation time");
  const subjectSourceBindingHash = digest(
    input.subjectSourceBindingHash,
    "generic launch subject source",
  );
  const executionResultSourceBindingHash = digest(
    input.executionResultSourceBindingHash,
    "generic launch execution result source",
  );
  const readModelBindingHash = digest(
    input.readModelBindingHash,
    "generic launch read model",
  );
  const readModelVerifierBindingHash = digest(
    input.readModelVerifierBindingHash,
    "generic launch read model verifier",
  );
  const activationCore = Object.freeze({
    schemaVersion: "programmable.generic-launch-foundation-activation.v1" as const,
    activatedAt,
    subjectSourceBindingHash,
    executionResultSourceBindingHash,
    readModelBindingHash,
    readModelVerifierBindingHash,
    routeAdapterReleaseHashes: Object.freeze(routeAdapterReleaseHashes),
    api,
  });
  return Object.freeze({
    schemaVersion: "programmable.generic-launch-foundation-descriptor.v1" as const,
    activation: true as const,
    activationBindingHash: canonicalSha256(
      activationCore.schemaVersion,
      activationCore,
    ),
    activatedAt,
    subjectSourceBindingHash,
    executionResultSourceBindingHash,
    readModelBindingHash,
    readModelVerifierBindingHash,
    routeAdapterReleases,
    api,
  });
}

function githubRepository(raw: unknown): ApplicantLaunchSubjectV1["sourceRepository"] {
  const value = exactObject(raw, ["forge", "repositoryId"], "GitHub repository binding");
  literal(value.forge, "github", "repository forge");
  return Object.freeze({
    forge: "github" as const,
    repositoryId: numericId(value.repositoryId, "repository id"),
  });
}

function gitRevision(raw: unknown): ApplicantLaunchSubjectV1["sourceRevision"] {
  const value = exactObject(raw, ["commitObjectId", "treeObjectId"], "Git revision");
  return Object.freeze({
    commitObjectId: patternedString(value.commitObjectId, GIT_OBJECT_ID, "Git commit object id"),
    treeObjectId: patternedString(value.treeObjectId, GIT_OBJECT_ID, "Git tree object id"),
  });
}

function exactObject(
  raw: unknown,
  expectedKeys: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(raw) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const ownKeys = Reflect.ownKeys(raw);
  if (ownKeys.some((key) => typeof key !== "string")) {
    throw new TypeError(`${label} contains symbol properties`);
  }
  const keys = (ownKeys as string[]).sort();
  const expected = [...expectedKeys].sort();
  if (keys.length !== expected.length
    || keys.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} has unexpected properties`);
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, key);
    if (descriptor === undefined || descriptor.get !== undefined
      || descriptor.set !== undefined || !descriptor.enumerable || !("value" in descriptor)) {
      throw new TypeError(`${label} contains non-data properties`);
    }
  }
  return raw as Readonly<Record<string, unknown>>;
}

function literal<T extends string>(raw: unknown, expected: T, label: string): T {
  if (raw !== expected) throw new TypeError(`${label} is invalid`);
  return expected;
}

function patternedString(
  raw: unknown,
  pattern: RegExp,
  label: string,
  maximumLength = 1024,
): string {
  if (typeof raw !== "string" || raw.length > maximumLength || !pattern.test(raw)) {
    throw new TypeError(`${label} is invalid`);
  }
  return raw;
}

function numericId(raw: unknown, label: string): string {
  return patternedString(raw, NUMERIC_ID, label);
}

function digest(raw: unknown, label: string): Sha256Digest {
  return patternedString(raw, DIGEST, label) as Sha256Digest;
}

function hash32(raw: unknown, label: string): `0x${string}` {
  return patternedString(raw, HASH32, label) as `0x${string}`;
}

function positiveInteger(raw: unknown, label: string): number {
  if (!Number.isSafeInteger(raw) || Number(raw) < 1) {
    throw new TypeError(`${label} is invalid`);
  }
  return Number(raw);
}

function nonnegativeInteger(raw: unknown, label: string): number {
  if (!Number.isSafeInteger(raw) || Number(raw) < 0) {
    throw new TypeError(`${label} is invalid`);
  }
  return Number(raw);
}

function enumValue<const T extends readonly string[]>(
  raw: unknown,
  values: T,
  label: string,
): T[number] {
  if (typeof raw !== "string" || !(values as readonly string[]).includes(raw)) {
    throw new TypeError(`${label} is invalid`);
  }
  return raw as T[number];
}

function instant(raw: unknown, label: string): string {
  if (typeof raw !== "string") throw new TypeError(`${label} is invalid`);
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== raw) {
    throw new TypeError(`${label} is invalid`);
  }
  return raw;
}
