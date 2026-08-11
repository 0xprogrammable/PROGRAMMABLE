import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  requireActiveRouterV2SharedLifecycleV3,
  ROUTER_V2_SHARED_LIFECYCLE_V3_SOURCE_ONLY_STATE,
  RouterV2SharedLifecycleV3UnavailableError,
} from "../lib/server/custom-launch/router-v2-shared-lifecycle-v3";

const PREDECESSOR_PATHS = [
  "lib/custom-launch/manual-router-bindings-v2.ts",
  "lib/server/custom-launch/manual-router-authority-v2.ts",
  "lib/server/custom-launch/manual-router-artifact-v2.ts",
  "lib/server/custom-launch/manual-router-state-v2.ts",
  "lib/custom-launch/contract-v2.ts",
  "lib/custom-launch/client-v2.ts",
  "lib/custom-launch/applicant-session-v2.ts",
  "lib/custom-launch/applicant-launch-readiness-v1.ts",
  "lib/server/custom-launch/launch-bridge-v2.ts",
  "components/custom-launch-experience.tsx",
  "lib/custom-launch/hookemon-adoption-verifier-v22.ts",
  "lib/custom-launch/hookemon-action-identifier-verifier-v1.ts",
  "components/manual-applicant-launch.tsx",
] as const;

describe("Router V2 shared lifecycle V3 Website boundary", () => {
  it("binds the exact immutable Authority and Contract source identities", () => {
    const state = ROUTER_V2_SHARED_LIFECYCLE_V3_SOURCE_ONLY_STATE;
    expect(state.authority).toEqual({
      commit: "a017d750fc3ad0805614487a7387c7e195b65bd0",
      tree: "e54f9835068973befd79203aad98aee82552996c",
      publicExport:
        "@programmable/autonomous-approval-v1/router-v2-shared-lifecycle-v3",
    });
    expect(state.contract).toEqual({
      commit: "ea0e4424b886a0c1ae928fc73d62bd8e907b44cd",
      tree: "8c5e0822d7ff256cad3d9e0350c980473d36aecc",
      artifactPath:
        "artifacts/hookemon-completed-graph-adoption-compat-v1.json",
      artifactSha256:
        "sha256:f9d110d2850c4934ba0c22493eaa9d0f090bee6f0e6a1339ee3002344da1065a",
    });
  });

  it("is source-only DENY with no activation inputs", () => {
    const state = ROUTER_V2_SHARED_LIFECYCLE_V3_SOURCE_ONLY_STATE;
    expect(state).toMatchObject({
      deploymentState: "UNDEPLOYED",
      activationState: "DENY",
      authorityIoState:
        "HARD_DENY_REQUIRES_VERSIONED_DEPLOYMENT_BOUND_SUCCESSOR",
      websiteBindingState: "UNBOUND_EXTERNAL_WRITER_DENY",
      activationAllowed: false,
      requiredServiceEnvironmentVariableNames: [],
      internalExecutionCurrentnessMaximumSeconds: 3600,
      launchGrantHasNoDefaultExpiry: true,
      hookemonState: "DENY",
      shardsState: "DENY",
    });
    expect(state.profiles).toHaveLength(6);
    expect(state.profiles.every((profile) =>
      profile.activationAllowed === false
      && profile.state.startsWith("DENY_"))).toBe(true);
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.profiles)).toBe(true);
  });

  it("cannot create an active runtime from the source-only package", () => {
    expect(() => requireActiveRouterV2SharedLifecycleV3())
      .toThrowError(RouterV2SharedLifecycleV3UnavailableError);
    try {
      requireActiveRouterV2SharedLifecycleV3();
    } catch (error) {
      expect(error).toMatchObject({
        code: "router_v2_shared_lifecycle_v3_unavailable",
        message: "This launch path is not available yet.",
      });
    }
  });

  it("does not reinterpret predecessor V2 or Applicant consumers", async () => {
    for (const path of PREDECESSOR_PATHS) {
      const source = await readFile(join(process.cwd(), path), "utf8");
      expect(source, path).not.toContain("router-v2-shared-lifecycle-v3");
      expect(source, path).not.toContain("3b56d205c1923d957a4baf5345745b7");
    }
  });
});
