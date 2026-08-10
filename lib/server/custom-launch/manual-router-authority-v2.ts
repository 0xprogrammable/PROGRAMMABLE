import "server-only";

import { getAddress, isAddress } from "viem";

import * as portableManualRouterAuthorityV2 from
  // @ts-expect-error -- generated, hash-bound ESM has no handwritten types.
  "@/lib/vendor/manual-router-authority-v2/manual-router-portable.v2.mjs";

import {
  getActiveManualRouterProductionBindingV2,
  type ActiveManualRouterProductionBindingV2,
} from "@/lib/custom-launch/manual-router-bindings-v2";
import type {
  ManualRouterBrowserWalletActionV2,
  ManualRouterCompleteSignedArtifactViewV2,
  ManualRouterNestedFactoryPrimaryEvidenceV2,
  ManualRouterNestedFactoryRouteBindingV2,
} from "@/lib/server/custom-launch/manual-router-artifact-v2";
import { assertManualRouterApplicantSubjectV1 } from
  "@/lib/server/custom-launch/manual-router-state-v1";
import type {
  ManualRouterWebsiteAuthorityV1,
} from "@/lib/server/custom-launch/manual-router-service-v1";

export const PORTABLE_MANUAL_ROUTER_WEBSITE_AUTHORITY_FACTORY_V2 =
  "createPortableManualRouterWebsiteAuthorityV2" as const;

export type ManualRouterWebsiteAuthorityV2 = Omit<
  ManualRouterWebsiteAuthorityV1,
  "assertV2AcceptanceCurrent" | "assertV2ReadyCurrentness"
> & Readonly<{
  assertV2AcceptanceCurrent: NonNullable<
    ManualRouterWebsiteAuthorityV1["assertV2AcceptanceCurrent"]
  >;
  assertV2ReadyCurrentness: NonNullable<
    ManualRouterWebsiteAuthorityV1["assertV2ReadyCurrentness"]
  >;
}>;

export type PortableManualRouterWebsiteAuthorityFactoryV2 = (
  input: Readonly<{
    binding: ActiveManualRouterProductionBindingV2;
    env: Readonly<Record<string, string | undefined>>;
    fetch: typeof fetch;
  }>,
) => ManualRouterWebsiteAuthorityV2;

/**
 * Loads the one portable Authority-owned Website facade. The frozen b180aca
 * bundle intentionally does not export this surface, so production remains
 * fail-closed until a later immutable Authority release adds it and the
 * Website vendor/binding hashes are rebound together.
 */
export function createProductionManualRouterWebsiteAuthorityV2():
ManualRouterWebsiteAuthorityV2 {
  const binding = getActiveManualRouterProductionBindingV2();
  const factory = portableWebsiteAuthorityFactoryV2(
    portableManualRouterAuthorityV2,
  );
  return assertManualRouterWebsiteAuthorityV2(factory({
    binding,
    env: process.env,
    fetch,
  }));
}

/** Exact schema dispatch with no V1/V2 fallback. */
export function createManualRouterWebsiteAuthorityDispatchV2(input: Readonly<{
  v1: ManualRouterWebsiteAuthorityV1;
  loadV2: () => ManualRouterWebsiteAuthorityV2;
}>): ManualRouterWebsiteAuthorityV1 {
  if (
    input.v1 === null
    || typeof input.v1 !== "object"
    || typeof input.loadV2 !== "function"
  ) throw new TypeError("manual Router authority dispatch is invalid");
  let v2: ManualRouterWebsiteAuthorityV2 | null = null;
  const loadV2 = (): ManualRouterWebsiteAuthorityV2 => {
    v2 ??= input.loadV2();
    return v2;
  };
  return Object.freeze({
    assertCompleteSignedArtifact(raw: unknown) {
      return artifactVersionV2(raw, "manual Router signed artifact")
          === "programmable.manual-router-complete-signed-artifact.v2"
        ? loadV2().assertCompleteSignedArtifact(raw)
        : input.v1.assertCompleteSignedArtifact(raw);
    },
    async verifySignedPublish(request: Parameters<
      ManualRouterWebsiteAuthorityV1["verifySignedPublish"]
    >[0]) {
      return publishArtifactVersionV2(request.request)
          === "programmable.manual-router-complete-signed-artifact.v2"
        ? await loadV2().verifySignedPublish(request)
        : await input.v1.verifySignedPublish(request);
    },
    async readChainClock() {
      // Chain time is route-independent. Keeping the existing production
      // source preserves V1 behavior; the V2 facade must independently bind
      // its own dual-RPC observations during currentness/preflight.
      return await input.v1.readChainClock();
    },
    async assertV2AcceptanceCurrent(value: Parameters<NonNullable<
      ManualRouterWebsiteAuthorityV1["assertV2AcceptanceCurrent"]
    >>[0]) {
      return await loadV2().assertV2AcceptanceCurrent(value);
    },
    async assertV2ReadyCurrentness(value: Parameters<NonNullable<
      ManualRouterWebsiteAuthorityV1["assertV2ReadyCurrentness"]
    >>[0]) {
      return await loadV2().assertV2ReadyCurrentness(value);
    },
    async observeExactTransaction(value: Parameters<
      ManualRouterWebsiteAuthorityV1["observeExactTransaction"]
    >[0]) {
      return artifactVersionV2(value.artifact, "manual Router transaction artifact")
          === "programmable.manual-router-complete-signed-artifact.v2"
        ? await loadV2().observeExactTransaction(value)
        : await input.v1.observeExactTransaction(value);
    },
    async resolveReissueState(value: Parameters<
      ManualRouterWebsiteAuthorityV1["resolveReissueState"]
    >[0]) {
      return reissueArtifactVersionV2(value.request)
          === "programmable.manual-router-complete-signed-artifact.v2"
        ? await loadV2().resolveReissueState(value)
        : await input.v1.resolveReissueState(value);
    },
  });
}

/**
 * This is the Website's final fail-closed boundary after the portable
 * Authority parser. It cannot activate while any frozen release identity is
 * absent from the production binding.
 */
export function assertProductionManualRouterCompleteSignedArtifactV2(
  raw: unknown,
): ManualRouterCompleteSignedArtifactViewV2 {
  return createProductionManualRouterWebsiteAuthorityV2()
    .assertCompleteSignedArtifact(raw) as ManualRouterCompleteSignedArtifactViewV2;
}

/**
 * Narrow projection helper for already-portable-verified test artifacts. It is
 * deliberately not the production verifier and must never be wired directly
 * to an HTTP boundary.
 */
export function assertManualRouterCompleteSignedArtifactForBindingV2(
  raw: unknown,
  binding: ActiveManualRouterProductionBindingV2,
): ManualRouterCompleteSignedArtifactViewV2 {
  const value = exactObject(raw, [
    "artifactKind", "binding", "descriptor", "preparationArtifact",
    "prepared", "route", "schemaVersion", "signedArtifactHash",
  ], "manual Router V2 complete signed artifact");
  if (
    value.schemaVersion
      !== "programmable.manual-router-complete-signed-artifact.v2"
    || value.artifactKind !== "nested-factory"
  ) throw invalid("manual Router V2 artifact discriminator is invalid");
  const route = routeBinding(value.route, binding);
  const commitments = exactObject(value.binding, [
    "acceptanceSubjectHash", "applicantAcceptanceClaimSha256",
    "applicantAcceptanceRecordHash", "currentAcceptanceHash",
    "grantBindingHash", "launchArtifactCommitmentHash", "routeBindingHash",
  ], "manual Router V2 artifact binding");
  const descriptor = exactObject(value.descriptor, [
    "deadline", "descriptorHash", "envelopeHash", "reissueOf", "routeNonce",
    "signatureRequestHash", "validAfter",
  ], "manual Router V2 descriptor");
  const preparationArtifact = exactObject(value.preparationArtifact, [
    "approvalClaim", "preparationArtifactHash", "subject",
  ], "manual Router V2 preparation artifact");
  const approvalClaim = exactObject(preparationArtifact.approvalClaim, [
    "approvedGitHubUserId", "approvedLaunchWallet", "headSha", "treeSha",
  ], "manual Router V2 approval claim");
  const subject = assertManualRouterApplicantSubjectV1(
    preparationArtifact.subject,
  );
  const prepared = exactObject(value.prepared, [
    "browserAction", "expectedComponents", "expectedLaunchId",
    "expectedPoolId", "expectedToken", "launchWallet", "preparationHash",
    "primaryEvidence",
  ], "manual Router V2 prepared launch");
  const launchWallet = address(prepared.launchWallet);
  const expectedToken = address(prepared.expectedToken);
  const browserAction = action(prepared.browserAction, binding, launchWallet);
  const expectedComponents = components(prepared.expectedComponents);
  const primaryEvidence = evidence(
    prepared.primaryEvidence,
    binding,
    launchWallet,
  );
  const approvedWallet = address(approvalClaim.approvedLaunchWallet);
  if (
    subject.approvedGitHubUserId !== numericId(
      approvalClaim.approvedGitHubUserId,
    )
    || subject.approvedLaunchWallet !== approvedWallet.toLowerCase()
    || launchWallet !== approvedWallet
    || launchWallet !== getAddress(binding.exactPlan.launchWallet)
    || expectedComponents.find(({ kind }) => kind === "token")?.account
      !== expectedToken
    || primaryEvidence.poolId !== bytes32(prepared.expectedPoolId)
    || primaryEvidence.profileKey !== route.profileKey
    || commitments.acceptanceSubjectHash
      !== "sha256:948a920b86aa915bc2dfcdcf56b271f41a2843fc1360b734e9221c0533d960b8"
    || commitments.applicantAcceptanceClaimSha256
      !== binding.acceptanceClaimSha256
  ) throw invalid("manual Router V2 artifact principal binding is invalid");
  const validAfter = uint(descriptor.validAfter);
  const deadline = uint(descriptor.deadline);
  if (
    BigInt(validAfter) > BigInt(deadline)
    || BigInt(deadline) - BigInt(validAfter) > 3_600n
  ) {
    throw invalid("manual Router V2 artifact validity is invalid");
  }
  return deepFreeze({
    schemaVersion: value.schemaVersion,
    artifactKind: value.artifactKind,
    signedArtifactHash: sha256(value.signedArtifactHash),
    route,
    binding: {
      grantBindingHash: sha256(commitments.grantBindingHash),
      routeBindingHash: sha256(commitments.routeBindingHash),
      launchArtifactCommitmentHash: sha256(
        commitments.launchArtifactCommitmentHash,
      ),
      acceptanceSubjectHash: sha256(commitments.acceptanceSubjectHash),
      currentAcceptanceHash: sha256(commitments.currentAcceptanceHash),
      applicantAcceptanceClaimSha256: sha256(
        commitments.applicantAcceptanceClaimSha256,
      ),
      applicantAcceptanceRecordHash: sha256(
        commitments.applicantAcceptanceRecordHash,
      ),
    },
    descriptor: {
      descriptorHash: sha256(descriptor.descriptorHash),
      signatureRequestHash: sha256(descriptor.signatureRequestHash),
      envelopeHash: sha256(descriptor.envelopeHash),
      routeNonce: bytes32(descriptor.routeNonce),
      validAfter,
      deadline,
      reissueOf: nullableSha256(descriptor.reissueOf),
    },
    preparationArtifact: {
      preparationArtifactHash: sha256(
        preparationArtifact.preparationArtifactHash,
      ),
      subject,
      approvalClaim: {
        headSha: gitSha(approvalClaim.headSha),
        treeSha: gitSha(approvalClaim.treeSha),
        approvedGitHubUserId: subject.approvedGitHubUserId,
        approvedLaunchWallet: approvedWallet,
      },
    },
    prepared: {
      preparationHash: sha256(prepared.preparationHash),
      launchWallet,
      expectedLaunchId: bytes32(prepared.expectedLaunchId),
      expectedPoolId: bytes32(prepared.expectedPoolId),
      expectedToken,
      expectedComponents,
      browserAction,
      primaryEvidence,
    },
  });
}

function routeBinding(
  raw: unknown,
  binding: ActiveManualRouterProductionBindingV2,
): ManualRouterNestedFactoryRouteBindingV2 {
  const value = exactObject(raw, [
    "profileId", "profileKey", "profileVersion", "routeId", "routeVersion",
    "schemaVersion",
  ], "manual Router V2 route binding");
  if (
    value.schemaVersion !== "programmable.manual-router-route-binding.v2"
    || value.routeId !== binding.route.routeId
    || value.routeVersion !== binding.route.routeVersion
    || value.profileId !== binding.route.profileId
    || value.profileVersion !== binding.route.profileVersion
    || value.profileKey !== binding.route.profileKey
  ) throw invalid("manual Router V2 route binding is not the frozen capability");
  return deepFreeze({
    schemaVersion: value.schemaVersion,
    routeId: value.routeId,
    routeVersion: value.routeVersion,
    profileId: value.profileId,
    profileVersion: value.profileVersion,
    profileKey: bytes32(value.profileKey),
  });
}

function action(
  raw: unknown,
  binding: ActiveManualRouterProductionBindingV2,
  launchWallet: `0x${string}`,
): ManualRouterBrowserWalletActionV2 {
  const value = exactObject(raw, [
    "chainId", "method", "params", "pendingNonceAtPreparation",
    "schemaVersion", "walletExecutionKind",
  ], "manual Router V2 browser action");
  if (
    value.schemaVersion !== "programmable.browser-wallet-action.v2"
    || value.walletExecutionKind !== "eoa-direct"
    || value.method !== "eth_sendTransaction"
    || value.chainId !== binding.chainId
    || !Array.isArray(value.params)
    || value.params.length !== 1
    || (
      value.pendingNonceAtPreparation !== null
      && !isUint(value.pendingNonceAtPreparation)
    )
  ) throw invalid("manual Router V2 browser action is invalid");
  const transaction = exactObject(value.params[0], [
    "data", "from", "to", "value",
  ], "manual Router V2 browser transaction");
  const from = address(transaction.from);
  const to = address(transaction.to);
  const data = hex(transaction.data);
  if (
    from !== launchWallet
    || to !== getAddress(binding.router.address)
    || !data.startsWith(binding.router.directLaunchSelector)
    || data.length <= binding.router.directLaunchSelector.length
    || transaction.value !== "0x0"
  ) throw invalid("manual Router V2 browser transaction is not exact Shards");
  return deepFreeze({
    schemaVersion: value.schemaVersion,
    walletExecutionKind: value.walletExecutionKind,
    method: value.method,
    chainId: value.chainId,
    pendingNonceAtPreparation: value.pendingNonceAtPreparation as string | null,
    params: [{ from, to, data, value: "0x0" }],
  });
}

function components(raw: unknown) {
  if (!Array.isArray(raw) || raw.length !== 3) {
    throw invalid("manual Router V2 components are invalid");
  }
  const checked = raw.map((entry) => {
    const value = exactObject(entry, [
      "account", "kind", "runtimeCodeHash",
    ], "manual Router V2 component");
    if (!new Set(["token", "hook", "nft"]).has(String(value.kind))) {
      throw invalid("manual Router V2 component kind is invalid");
    }
    return deepFreeze({
      account: address(value.account),
      kind: value.kind as "token" | "hook" | "nft",
      runtimeCodeHash: bytes32(value.runtimeCodeHash),
    });
  });
  if (
    new Set(checked.map(({ kind }) => kind)).size !== 3
    || new Set(checked.map(({ account }) => account)).size !== 3
  ) throw invalid("manual Router V2 components are ambiguous");
  return deepFreeze(checked);
}

function evidence(
  raw: unknown,
  binding: ActiveManualRouterProductionBindingV2,
  launchWallet: `0x${string}`,
): ManualRouterNestedFactoryPrimaryEvidenceV2 {
  const value = exactObject(raw, [
    "configurationHash", "evidenceCommitmentHash", "expectedResultHash",
    "factoryIdentity", "kind", "launchWallet", "nonce", "poolId",
    "profileId", "profileKey", "profileVersion", "revenuePolicyHash",
    "routeId", "routePayloadHash", "routeVersion", "routerIdentity",
    "stampRequestHash",
  ], "manual Router V2 primary evidence");
  if (
    value.kind !== binding.route.primaryEvidenceKind
    || value.routeId !== binding.route.routeId
    || value.routeVersion !== binding.route.routeVersion
    || value.profileId !== binding.route.profileId
    || value.profileVersion !== binding.route.profileVersion
    || value.profileKey !== binding.route.profileKey
    || address(value.launchWallet) !== launchWallet
    || value.routerIdentity !== binding.exactPlan.routerIdentity
    || value.factoryIdentity !== binding.exactPlan.factoryIdentity
    || value.routePayloadHash !== binding.exactPlan.routePayloadHash
    || value.expectedResultHash !== binding.exactPlan.expectedResultHash
    || value.revenuePolicyHash !== binding.exactPlan.revenuePolicyHash
    || value.poolId !== binding.exactPlan.poolId
    || value.configurationHash !== binding.exactPlan.configurationHash
  ) throw invalid("manual Router V2 primary evidence is not exact Shards");
  return deepFreeze({
    kind: value.kind,
    routerIdentity: sha256(value.routerIdentity),
    factoryIdentity: sha256(value.factoryIdentity),
    routeId: value.routeId,
    routeVersion: value.routeVersion,
    profileId: value.profileId,
    profileVersion: value.profileVersion,
    profileKey: bytes32(value.profileKey),
    routePayloadHash: bytes32(value.routePayloadHash),
    expectedResultHash: bytes32(value.expectedResultHash),
    revenuePolicyHash: bytes32(value.revenuePolicyHash),
    poolId: bytes32(value.poolId),
    configurationHash: bytes32(value.configurationHash),
    stampRequestHash: bytes32(value.stampRequestHash),
    launchWallet,
    nonce: bytes32(value.nonce),
    evidenceCommitmentHash: sha256(value.evidenceCommitmentHash),
  });
}

function exactObject(
  raw: unknown,
  fields: readonly string[],
  label: string,
): Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw invalid(`${label} is invalid`);
  }
  const keys = Reflect.ownKeys(raw);
  const strings = keys.filter((key): key is string => typeof key === "string")
    .sort();
  const expected = [...fields].sort();
  if (
    keys.length !== strings.length
    || strings.length !== expected.length
    || strings.some((key, index) => key !== expected[index])
  ) throw invalid(`${label} contains unexpected fields`);
  return raw as Record<string, unknown>;
}

function portableWebsiteAuthorityFactoryV2(
  namespace: object,
): PortableManualRouterWebsiteAuthorityFactoryV2 {
  const factory = (namespace as Record<string, unknown>)[
    PORTABLE_MANUAL_ROUTER_WEBSITE_AUTHORITY_FACTORY_V2
  ];
  if (typeof factory !== "function") {
    throw new TypeError(
      "portable manual Router V2 Website Authority facade is not installed",
    );
  }
  return factory as PortableManualRouterWebsiteAuthorityFactoryV2;
}

function assertManualRouterWebsiteAuthorityV2(
  raw: unknown,
): ManualRouterWebsiteAuthorityV2 {
  if (
    raw === null
    || typeof raw !== "object"
    || Array.isArray(raw)
    || !Object.isFrozen(raw)
  ) {
    throw invalid("portable manual Router V2 Website Authority is invalid");
  }
  const authority = raw as Record<string, unknown>;
  for (const method of [
    "assertCompleteSignedArtifact", "assertV2AcceptanceCurrent",
    "assertV2ReadyCurrentness", "observeExactTransaction", "readChainClock",
    "resolveReissueState", "verifySignedPublish",
  ] as const) {
    if (typeof authority[method] !== "function") {
      throw invalid("portable manual Router V2 Website Authority is incomplete");
    }
  }
  return raw as ManualRouterWebsiteAuthorityV2;
}

function publishArtifactVersionV2(raw: unknown): ManualRouterArtifactVersionV2 {
  const request = recordV2(raw, "manual Router signed publish request");
  return artifactVersionV2(
    request.signedArtifact,
    "manual Router signed publish artifact",
  );
}

function reissueArtifactVersionV2(raw: unknown): ManualRouterArtifactVersionV2 {
  const request = recordV2(raw, "manual Router reissue request");
  return artifactVersionV2(
    request.previousSignedArtifact,
    "manual Router previous signed artifact",
  );
}

type ManualRouterArtifactVersionV2 =
  | "programmable.manual-router-complete-signed-artifact.v1"
  | "programmable.manual-router-complete-signed-artifact.v2";

function artifactVersionV2(
  raw: unknown,
  label: string,
): ManualRouterArtifactVersionV2 {
  const artifact = recordV2(raw, label);
  if (
    artifact.schemaVersion
      !== "programmable.manual-router-complete-signed-artifact.v1"
    && artifact.schemaVersion
      !== "programmable.manual-router-complete-signed-artifact.v2"
  ) throw invalid(`${label} schema is unsupported`);
  return artifact.schemaVersion;
}

function recordV2(raw: unknown, label: string): Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw invalid(`${label} is invalid`);
  }
  return raw as Record<string, unknown>;
}

function address(value: unknown): `0x${string}` {
  if (
    typeof value !== "string"
    || !isAddress(value, { strict: true })
    || BigInt(value) === 0n
  ) throw invalid("manual Router V2 address is invalid");
  return getAddress(value);
}

function bytes32(value: unknown): `0x${string}` {
  if (
    typeof value !== "string"
    || !/^0x[0-9a-f]{64}$/u.test(value)
    || BigInt(value) === 0n
  ) throw invalid("manual Router V2 bytes32 is invalid");
  return value as `0x${string}`;
}

function sha256(value: unknown): `sha256:${string}` {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw invalid("manual Router V2 SHA-256 is invalid");
  }
  return value as `sha256:${string}`;
}

function nullableSha256(value: unknown): `sha256:${string}` | null {
  return value === null ? null : sha256(value);
}

function numericId(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,63}$/u.test(value)) {
    throw invalid("manual Router V2 numeric id is invalid");
  }
  return value;
}

function gitSha(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/u.test(value)) {
    throw invalid("manual Router V2 Git SHA is invalid");
  }
  return value;
}

function uint(value: unknown): string {
  if (!isUint(value)) throw invalid("manual Router V2 uint is invalid");
  return value;
}

function isUint(value: unknown): value is string {
  return typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value);
}

function hex(value: unknown): `0x${string}` {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})+$/u.test(value)) {
    throw invalid("manual Router V2 hex value is invalid");
  }
  return value as `0x${string}`;
}

function invalid(message: string): TypeError {
  return new TypeError(message);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}
