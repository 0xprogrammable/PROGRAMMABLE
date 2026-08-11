import "server-only";

import sourceManifest from
  "@/lib/vendor/router-v2-shared-lifecycle-v3/artifact-manifest.v3.json";
import websiteManifest from
  "@/lib/vendor/router-v2-shared-lifecycle-v3/manifest.json";
import * as portableRouterV2SharedLifecycleV3 from
  // @ts-expect-error -- generated, hash-bound ESM has no handwritten types.
  "@/lib/vendor/router-v2-shared-lifecycle-v3/artifacts/router-v2-shared-lifecycle-v3/router-v2-shared-lifecycle-portable.v3.mjs";

type FrozenProfile = Readonly<{
  slotId: string;
  architecture: string;
  state: string;
  activationAllowed: false;
}>;

type PortableLifecycleV3 = Readonly<{
  ROUTER_V2_SHARED_LIFECYCLE_VERSION_V3: "3.0.0";
  ROUTER_V2_INTERNAL_CURRENTNESS_MAXIMUM_SECONDS_V3: 3600;
  ROUTER_V2_LAUNCH_GRANT_NO_DEFAULT_EXPIRY_V3: true;
  PROGRAMMABLE_COMPLETED_GRAPH_ADOPTION_CONTRACT_CANDIDATE_V1: Readonly<{
    commit: string;
    tree: string;
    artifactSha256: string;
    artifactStatus: string;
  }>;
  ROUTER_V2_SHARED_TARGET_PROFILE_CATALOG_V3: Readonly<{
    descriptors: readonly FrozenProfile[];
  }>;
}>;

const portable = portableRouterV2SharedLifecycleV3 as unknown as
  PortableLifecycleV3;

export type RouterV2SharedLifecycleV3SourceOnlyState = Readonly<{
  schemaVersion: "programmable.website-router-v2-shared-lifecycle-source-only.v3";
  lifecycleVersion: "3.0.0";
  authority: Readonly<{
    commit: string;
    tree: string;
    publicExport: string;
  }>;
  contract: Readonly<{
    commit: string;
    tree: string;
    artifactPath: string;
    artifactSha256: string;
  }>;
  deploymentState: "UNDEPLOYED";
  activationState: "DENY";
  authorityIoState:
    "HARD_DENY_REQUIRES_VERSIONED_DEPLOYMENT_BOUND_SUCCESSOR";
  websiteBindingState: "UNBOUND_EXTERNAL_WRITER_DENY";
  activationAllowed: false;
  requiredServiceEnvironmentVariableNames: readonly [];
  internalExecutionCurrentnessMaximumSeconds: 3600;
  launchGrantHasNoDefaultExpiry: true;
  profiles: readonly FrozenProfile[];
  hookemonState: "DENY";
  shardsState: "DENY";
}>;

/**
 * Exact source-only V3 package identity. Nothing in this boundary can sign,
 * issue, preflight or execute until a new deployment-bound version replaces
 * the upstream hard-DENY schemas and null bindings.
 */
export const ROUTER_V2_SHARED_LIFECYCLE_V3_SOURCE_ONLY_STATE =
  createSourceOnlyState();

export class RouterV2SharedLifecycleV3UnavailableError extends Error {
  readonly code = "router_v2_shared_lifecycle_v3_unavailable";

  constructor() {
    super("This launch path is not available yet.");
    this.name = "RouterV2SharedLifecycleV3UnavailableError";
  }
}

/** Fail closed if predecessor code accidentally tries to activate V3. */
export function requireActiveRouterV2SharedLifecycleV3(): never {
  throw new RouterV2SharedLifecycleV3UnavailableError();
}

function createSourceOnlyState(): RouterV2SharedLifecycleV3SourceOnlyState {
  const contract = portable
    .PROGRAMMABLE_COMPLETED_GRAPH_ADOPTION_CONTRACT_CANDIDATE_V1;
  const profiles = portable.ROUTER_V2_SHARED_TARGET_PROFILE_CATALOG_V3
    .descriptors.map((profile) => Object.freeze({
      slotId: profile.slotId,
      architecture: profile.architecture,
      state: profile.state,
      activationAllowed: false as const,
    }));
  if (
    websiteManifest.schemaVersion
      !== "programmable.website-router-v2-shared-lifecycle-vendor.v3"
    || websiteManifest.authority.commit
      !== "a017d750fc3ad0805614487a7387c7e195b65bd0"
    || websiteManifest.authority.tree
      !== "e54f9835068973befd79203aad98aee82552996c"
    || portable.ROUTER_V2_SHARED_LIFECYCLE_VERSION_V3 !== "3.0.0"
    || portable.ROUTER_V2_INTERNAL_CURRENTNESS_MAXIMUM_SECONDS_V3 !== 3600
    || portable.ROUTER_V2_LAUNCH_GRANT_NO_DEFAULT_EXPIRY_V3 !== true
    || sourceManifest.deploymentState !== "UNDEPLOYED"
    || sourceManifest.activationState !== "DENY"
    || sourceManifest.authorityIoState
      !== "HARD_DENY_REQUIRES_VERSIONED_DEPLOYMENT_BOUND_SUCCESSOR"
    || sourceManifest.websiteBindingState !== "UNBOUND_EXTERNAL_WRITER_DENY"
    || sourceManifest.contractDeploymentBinding !== null
    || sourceManifest.profileCapabilityBinding !== null
    || sourceManifest.hookemonState !== "DENY"
    || sourceManifest.shardsState !== "DENY"
    || sourceManifest.externalActionOccurred !== false
    || sourceManifest.requiredServiceEnvironmentVariableNames.length !== 0
    || profiles.length !== 6
    || profiles.some((profile) =>
      profile.activationAllowed !== false
      || !profile.state.startsWith("DENY_"))
    || contract.commit !== sourceManifest.contract.commit
    || contract.tree !== sourceManifest.contract.tree
    || contract.artifactSha256 !== sourceManifest.contract.artifactSha256
    || contract.artifactStatus !== "INDEPENDENT_PASS_UNDEPLOYED_DENY"
  ) throw new Error("Router V2 shared lifecycle V3 DENY binding drifted");

  return Object.freeze({
    schemaVersion:
      "programmable.website-router-v2-shared-lifecycle-source-only.v3",
    lifecycleVersion: "3.0.0",
    authority: Object.freeze({
      commit: websiteManifest.authority.commit,
      tree: websiteManifest.authority.tree,
      publicExport: websiteManifest.authority.publicExport,
    }),
    contract: Object.freeze({
      commit: sourceManifest.contract.commit,
      tree: sourceManifest.contract.tree,
      artifactPath: sourceManifest.contract.artifactPath,
      artifactSha256: sourceManifest.contract.artifactSha256,
    }),
    deploymentState: "UNDEPLOYED",
    activationState: "DENY",
    authorityIoState:
      "HARD_DENY_REQUIRES_VERSIONED_DEPLOYMENT_BOUND_SUCCESSOR",
    websiteBindingState: "UNBOUND_EXTERNAL_WRITER_DENY",
    activationAllowed: false,
    requiredServiceEnvironmentVariableNames: Object.freeze([]) as readonly [],
    internalExecutionCurrentnessMaximumSeconds: 3600,
    launchGrantHasNoDefaultExpiry: true,
    profiles: Object.freeze(profiles),
    hookemonState: "DENY",
    shardsState: "DENY",
  });
}
