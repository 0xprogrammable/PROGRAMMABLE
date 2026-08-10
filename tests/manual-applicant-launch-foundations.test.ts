import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { LaunchModelPicker } from "../components/launch-entry";
import {
  MANUAL_ROUTER_PRODUCTION_BINDING_V1,
  assertManualRouterProductionBindingV1,
} from "../lib/custom-launch/manual-router-bindings-v1";
import {
  MANUAL_ROUTER_NESTED_FACTORY_BINDING_V2,
  MANUAL_ROUTER_NESTED_FACTORY_PROFILE_TYPE_V2,
  MANUAL_ROUTER_SHARDS_ROUTE_IDENTITY_V2,
  deriveManualRouterNestedFactoryProfileKeyV2,
  getActiveManualRouterProductionBindingV2,
  isManualRouterProductionBindingV2Active,
} from "../lib/custom-launch/manual-router-bindings-v2";
import {
  parseManualRouterApplicantListResponseV1,
  parseManualRouterResolveResponseV1,
  type ManualRouterApplicantListResponseV1,
  type ManualRouterPersistedAttemptV1,
  type ManualRouterResolveResponseV1,
} from "../lib/custom-launch/manual-router-contract-v1";
import {
  parseManualRouterApplicantListResponseV2,
  parseManualRouterApplicantFinalityResponseV2,
  parseManualRouterApplicantTransactionResponseV2,
  parseManualRouterBrowserWalletActionV2,
  parseManualRouterRouteBindingV2,
  parseManualRouterRouteAcceptanceStateResponseV1,
  type ManualRouterApplicantListResponseV2,
  type ManualRouterResolveResponseV2,
} from "../lib/custom-launch/manual-router-contract-v2";
import {
  manualRouterBlocksNewSendV1,
  manualRouterCanClearUncertainNoSendV1,
  manualRouterDirectoryForApplicantV2,
  manualRouterFreshReadyMatchesCachedV1,
  manualRouterFreshReadyMatchesCachedV2,
  manualRouterRouteFactsV2,
  manualRouterTransactionContextV1,
  parseManualRouterPersistedAttemptStorageV1,
  reconcileManualRouterBrowserAttemptV1,
} from "../lib/custom-launch/manual-router-browser-state-v1";
import { listManualRouterApplicantSubmissionsVersionedV2 } from
  "../lib/custom-launch/manual-router-client-v1";
import {
  createManualRouterApplicantAuthenticatorFromBoundaryV1,
} from "../lib/server/custom-launch/manual-router-auth-v1";
import { discoverManualRouterPendingFinalityV1 } from
  "../lib/server/custom-launch/manual-router-discovery-v1";
import { isManualRouterFinalityCronAuthorizedV1 } from
  "../lib/server/custom-launch/manual-router-cron-auth-v1";
import { runConfiguredManualRouterFinalityWorkerV1 } from
  "../lib/server/custom-launch/manual-router-finality-worker-v1";
import {
  assertManualRouterProductionConfigurationV1,
  isManualRouterApplicantLaunchEnabledV1,
  resolveManualRouterStrictRpcConfigurationV1,
} from "../lib/server/custom-launch/manual-router-config-v1";
import {
  handleManualRouterWebsiteRouteV1,
  handleProductionManualRouterWebsiteRouteV1,
} from
  "../lib/server/custom-launch/manual-router-routes-v1";
import {
  assertManualRouterUsableSendWindowV1,
  ManualRouterRpcQuorumErrorV1,
  ManualRouterRpcQuorumV1,
} from "../lib/server/custom-launch/manual-router-rpc-v1";
import {
  ManualRouterBlobCasConflictV1,
  ManualRouterPrivateBlobStoreV1,
  manualRouterApplicantIndexPathV1,
  manualRouterContentPathV1,
} from "../lib/server/custom-launch/manual-router-store-v1";
import {
  advanceManualRouterPointerDispositionV1,
  createManualRouterApplicantIndexV1,
  createManualRouterSignedPointerV1,
} from "../lib/server/custom-launch/manual-router-state-v1";
import { canonicalSha256 } from
  "../lib/server/projection-target/hashing";
import { GitHubPrincipalAuthenticationErrorV1 } from
  "../lib/server/projection-target/github-entitlement";
import { rpcProviderCommitment } from
  "../lib/data-pipeline/rpc-provider-commitments";

const WALLET = "0x1111111111111111111111111111111111111111" as const;
const OTHER_WALLET = "0x2222222222222222222222222222222222222222" as const;
const SUBJECT = `sha256:${"11".repeat(32)}` as const;
const POINTER = `sha256:${"22".repeat(32)}` as const;
const APPROVAL = `sha256:${"33".repeat(32)}` as const;
const DESCRIPTOR = `sha256:${"44".repeat(32)}` as const;
const ENVELOPE = `sha256:${"55".repeat(32)}` as const;
const PREPARATION = `sha256:${"66".repeat(32)}` as const;
const ACCEPTANCE_SUBJECT =
  "sha256:948a920b86aa915bc2dfcdcf56b271f41a2843fc1360b734e9221c0533d960b8" as const;
const CURRENT_ACCEPTANCE = `sha256:${"67".repeat(32)}` as const;
const ACCEPTANCE_CLAIM = `sha256:${"68".repeat(32)}` as const;
const ACCEPTANCE_RECORD = `sha256:${"69".repeat(32)}` as const;
const ROUTE_NONCE = `0x${"77".repeat(32)}` as const;
const LAUNCH_ID = `0x${"88".repeat(32)}` as const;
const POOL_ID = `0x${"99".repeat(32)}` as const;
const NESTED_PROFILE_KEY = deriveManualRouterNestedFactoryProfileKeyV2(
  "exact-shards-nested-factory",
  "1.0.0",
);

describe("manual Applicant browser durability", () => {
  const attempt = Object.freeze({
    schemaVersion: "programmable.manual-router-browser-attempt.v1" as const,
    subjectHash: SUBJECT,
    descriptorHash: DESCRIPTOR,
    preparationHash: PREPARATION,
    launchWallet: WALLET,
    createdAt: "2026-08-09T20:00:00.000Z",
    transactionHash: `0x${"ab".repeat(32)}` as const,
    phase: "submitted" as const,
  }) satisfies ManualRouterPersistedAttemptV1;

  function resolved(
    status: "permit-not-yet-valid" | "ready" | "submitted-awaiting-finality"
      | "failed-awaiting-expiry" | "reissue-required" | "finalized",
  ): ManualRouterResolveResponseV1 {
    const common = {
      schemaVersion: "programmable.manual-router-applicant-resolve-response.v1" as const,
      subjectHash: SUBJECT,
      pointerHash: POINTER,
      approvalBindingHash: APPROVAL,
      routeNonce: ROUTE_NONCE,
    };
    if (status === "ready" || status === "permit-not-yet-valid") return {
      ...common,
      status,
      validAfter: "1000",
      deadline: "2000",
      descriptorHash: DESCRIPTOR,
      envelopeHash: ENVELOPE,
      preparationHash: PREPARATION,
      expectedLaunchId: LAUNCH_ID,
      expectedPoolId: POOL_ID,
      browserAction: {
        schemaVersion: "programmable.browser-wallet-router-action.v1",
        walletExecutionKind: "eoa-direct",
        method: "eth_sendTransaction",
        chainId: "0x1",
        pendingNonceAtPreparation: null,
        params: [{
          from: WALLET,
          to: MANUAL_ROUTER_PRODUCTION_BINDING_V1.router.address,
          data: `0xe5f6b8cd${"00".repeat(32)}`,
          value: "0x0",
        }],
      },
    };
    if (status === "submitted-awaiting-finality") return {
      ...common,
      status,
      descriptorHash: DESCRIPTOR,
      transactionHash: attempt.transactionHash!,
      preparationHash: PREPARATION,
    };
    if (status === "failed-awaiting-expiry") return {
      ...common,
      status,
      descriptorHash: DESCRIPTOR,
      transactionHash: attempt.transactionHash!,
      failedTransactionEvidenceHash: `sha256:${"bc".repeat(32)}`,
      deadline: "2000",
    };
    if (status === "reissue-required") return {
      ...common,
      status,
      expiredRequestHash: `sha256:${"cd".repeat(32)}`,
      expiredAtChainTimestamp: "2001",
      reason: "expired-submission",
      transactionHash: attempt.transactionHash,
      failedTransactionEvidenceHash: null,
    };
    return {
      ...common,
      status,
      transactionHash: attempt.transactionHash!,
      proofHash: `sha256:${"de".repeat(32)}`,
    };
  }

  it("lets authoritative ready/submitted state retain only its exact active attempt", () => {
    const ready = resolved("ready");
    expect(reconcileManualRouterBrowserAttemptV1({
      attempt,
      resolved: ready,
      launchWallet: WALLET,
      nowIso: "2026-08-09T20:01:00.000Z",
    }).active).toBe(attempt);
    expect(manualRouterTransactionContextV1({ resolved: ready, attempt }))
      .toMatchObject({ transactionHash: attempt.transactionHash });

    const submitted = resolved("submitted-awaiting-finality");
    const reconstructed = reconcileManualRouterBrowserAttemptV1({
      attempt: null,
      resolved: submitted,
      launchWallet: WALLET,
      nowIso: "2026-08-09T20:01:00.000Z",
    }).active;
    expect(reconstructed).toMatchObject({ phase: "reported" });
    expect(manualRouterTransactionContextV1({
      resolved: submitted,
      attempt: reconstructed,
    })).toMatchObject({ transactionHash: attempt.transactionHash });
  });

  it("archives stale attempts and never polls failed, reissue or finalized state", () => {
    for (const status of [
      "failed-awaiting-expiry", "reissue-required", "finalized",
    ] as const) {
      const server = resolved(status);
      const result = reconcileManualRouterBrowserAttemptV1({
        attempt,
        resolved: server,
        launchWallet: WALLET,
        nowIso: "2026-08-09T20:01:00.000Z",
      });
      expect(result.active).toBeNull();
      expect(result.archive).toBe(attempt);
      expect(manualRouterTransactionContextV1({ resolved: server, attempt }))
        .toBeNull();
    }
    const newerReady = {
      ...resolved("ready"),
      descriptorHash: `sha256:${"ef".repeat(32)}` as const,
    } as ManualRouterResolveResponseV1;
    expect(reconcileManualRouterBrowserAttemptV1({
      attempt,
      resolved: newerReady,
      launchWallet: WALLET,
      nowIso: "2026-08-09T20:01:00.000Z",
    })).toMatchObject({ active: null, archive: attempt });
  });

  it("classifies same-descriptor preparation or wallet mutation as recoverable and blocking", () => {
    const ready = resolved("ready") as Extract<ManualRouterResolveResponseV1, {
      status: "ready";
    }>;
    for (const mutated of [
      { ...attempt, preparationHash: `sha256:${"fa".repeat(32)}` as const },
      { ...attempt, launchWallet: OTHER_WALLET },
    ]) {
      expect(reconcileManualRouterBrowserAttemptV1({
        attempt: mutated,
        resolved: ready,
        launchWallet: WALLET,
        nowIso: "2026-08-09T20:01:00.000Z",
      })).toMatchObject({
        active: null,
        archive: mutated,
        archiveReason: "server-ready-local-binding-mismatch",
        recoveryRequired: true,
      });
    }
    expect(manualRouterBlocksNewSendV1({
      attempt: null,
      ready,
      storageRecoveryRequired: true,
    })).toBe(true);
  });

  it("never treats a not-yet-valid permit as an active browser send", () => {
    const notYetValid = resolved("permit-not-yet-valid");
    expect(reconcileManualRouterBrowserAttemptV1({
      attempt: null,
      resolved: notYetValid,
      launchWallet: WALLET,
      nowIso: "2026-08-09T20:01:00.000Z",
    })).toEqual({
      active: null,
      archive: null,
      archiveReason: null,
      recoveryRequired: false,
    });
    expect(reconcileManualRouterBrowserAttemptV1({
      attempt,
      resolved: notYetValid,
      launchWallet: WALLET,
      nowIso: "2026-08-09T20:01:00.000Z",
    })).toEqual({
      active: null,
      archive: attempt,
      archiveReason: "server-not-yet-valid-local-attempt",
      recoveryRequired: true,
    });
    expect(manualRouterTransactionContextV1({
      resolved: notYetValid,
      attempt,
    })).toBeNull();
  });

  it("turns corrupt storage into a recoverable fail-closed state", () => {
    expect(parseManualRouterPersistedAttemptStorageV1("{", SUBJECT))
      .toEqual({ kind: "corrupt", raw: "{" });
    expect(parseManualRouterPersistedAttemptStorageV1(
      JSON.stringify({ ...attempt, subjectHash: `sha256:${"ff".repeat(32)}` }),
      SUBJECT,
    )).toMatchObject({ kind: "corrupt" });
    expect(parseManualRouterPersistedAttemptStorageV1(
      JSON.stringify(attempt),
      SUBJECT,
    )).toMatchObject({ kind: "valid", attempt });
    const ready = resolved("ready") as Extract<ManualRouterResolveResponseV1, {
      status: "ready";
    }>;
    expect(manualRouterBlocksNewSendV1({
      attempt: null,
      ready,
      storageRecoveryRequired: true,
    })).toBe(true);
  });

  it("requires explicit no-send confirmation for a reloaded uncertain wallet prompt", () => {
    const ready = resolved("ready") as Extract<ManualRouterResolveResponseV1, {
      status: "ready";
    }>;
    const uncertain = Object.freeze({
      ...attempt,
      transactionHash: null,
      phase: "wallet-prompt-opened" as const,
    });
    const reloaded = parseManualRouterPersistedAttemptStorageV1(
      JSON.stringify(uncertain),
      SUBJECT,
    );
    expect(reloaded).toMatchObject({ kind: "valid", attempt: uncertain });
    expect(manualRouterCanClearUncertainNoSendV1({
      attempt: reloaded.kind === "valid" ? reloaded.attempt : null,
      ready,
      storageRecoveryRequired: false,
    })).toBe(true);
    expect(manualRouterBlocksNewSendV1({
      attempt: uncertain,
      ready,
      storageRecoveryRequired: false,
    })).toBe(true);
    expect(manualRouterCanClearUncertainNoSendV1({
      attempt,
      ready,
      storageRecoveryRequired: false,
    })).toBe(false);
    expect(manualRouterCanClearUncertainNoSendV1({
      attempt: { ...uncertain, preparationHash: `sha256:${"fa".repeat(32)}` },
      ready,
      storageRecoveryRequired: false,
    })).toBe(false);
  });

  it("rejects a delayed cached ready state unless the fresh exact action is still ready", () => {
    const cached = resolved("ready") as Extract<ManualRouterResolveResponseV1, {
      status: "ready";
    }>;
    expect(manualRouterFreshReadyMatchesCachedV1({
      cached,
      fresh: cached,
      linkedLaunchWallet: WALLET,
    })).toBe(true);
    expect(manualRouterFreshReadyMatchesCachedV1({
      cached,
      fresh: {
        ...cached,
        browserAction: {
          ...cached.browserAction,
          pendingNonceAtPreparation: "999",
        },
      },
      linkedLaunchWallet: WALLET,
    })).toBe(true);
    expect(manualRouterFreshReadyMatchesCachedV1({
      cached,
      fresh: resolved("permit-not-yet-valid"),
      linkedLaunchWallet: WALLET,
    })).toBe(false);
    expect(manualRouterFreshReadyMatchesCachedV1({
      cached,
      fresh: {
        ...cached,
        browserAction: {
          ...cached.browserAction,
          params: [{
            ...cached.browserAction.params[0],
            data: `0x${"ab".repeat(32)}`,
          }],
        },
      },
      linkedLaunchWallet: WALLET,
    })).toBe(false);
    expect(manualRouterFreshReadyMatchesCachedV1({
      cached,
      fresh: cached,
      linkedLaunchWallet: OTHER_WALLET,
    })).toBe(false);
  });
});

describe("inactive Shards nested-factory Router V2 browser contract", () => {
  const route = Object.freeze({
    routeId: "nested-factory" as const,
    routeVersion: "1.0.0" as const,
    profileId: "exact-shards-nested-factory" as const,
    profileVersion: "1.0.0" as const,
    profileKey: NESTED_PROFILE_KEY,
  });
  const token = "0x3333333333333333333333333333333333333333" as const;
  const hook = "0x4444444444444444444444444444444444444444" as const;
  const nft = "0x5555555555555555555555555555555555555555" as const;
  const router = "0x6666666666666666666666666666666666666666" as const;

  function browserAction() {
    return {
      schemaVersion: "programmable.browser-wallet-action.v2" as const,
      walletExecutionKind: "eoa-direct" as const,
      method: "eth_sendTransaction" as const,
      chainId: "0x1" as const,
      pendingNonceAtPreparation: "7",
      params: [{
        from: WALLET,
        to: router,
        data: "0x1234" as const,
        value: "0x0" as const,
      }] as const,
    };
  }

  function launchPreflight() {
    const action = browserAction().params[0];
    return {
      schemaVersion: "programmable.nested-factory-launch-preflight.v1" as const,
      chainId: "1" as const,
      issuedAtEpochSeconds: "1001",
      expiresAtEpochSeconds: "1120",
      grantHash: APPROVAL,
      releaseAttestationHash: `sha256:${"6a".repeat(32)}` as const,
      acceptanceSubjectHash: ACCEPTANCE_SUBJECT,
      currentAcceptanceHash: CURRENT_ACCEPTANCE,
      capabilityHash: `sha256:${"6b".repeat(32)}` as const,
      launchId: LAUNCH_ID,
      permitNonce: ROUTE_NONCE,
      executionMode: "EXACT_FACTORY_LAUNCH_EXECUTED" as const,
      executionModePolicy: [
        "EXACT_EXISTING_LAUNCH_ADOPTED",
        "EXACT_FACTORY_LAUNCH_EXECUTED",
      ] as const,
      browserAction: {
        ...action,
        actionHash: `sha256:${"6c".repeat(32)}` as const,
      },
      currentnessEvidenceHash: `sha256:${"6d".repeat(32)}` as const,
      gasEvidenceHash: `sha256:${"6e".repeat(32)}` as const,
      maximumLiveGasEstimate: "1000000",
      bufferedGasLimit: "1250000",
      mainnetTransactionGasLimit: "16777216" as const,
      preflightHash: `sha256:${"6f".repeat(32)}` as const,
    };
  }

  function readyV2(): Extract<ManualRouterResolveResponseV2, {
    status: "ready";
  }> {
    return {
      schemaVersion: "programmable.manual-router-applicant-resolve-response.v2",
      subjectHash: SUBJECT,
      pointerHash: POINTER,
      grantBindingHash: APPROVAL,
      routeBindingHash: `sha256:${"34".repeat(32)}`,
      launchArtifactCommitmentHash: `sha256:${"35".repeat(32)}`,
      acceptanceSubjectHash: ACCEPTANCE_SUBJECT,
      currentAcceptanceHash: CURRENT_ACCEPTANCE,
      applicantAcceptanceClaimSha256: ACCEPTANCE_CLAIM,
      applicantAcceptanceRecordHash: ACCEPTANCE_RECORD,
      route,
      routeNonce: ROUTE_NONCE,
      status: "ready",
      validAfter: "1000",
      deadline: "2000",
      descriptorHash: DESCRIPTOR,
      envelopeHash: ENVELOPE,
      preparationHash: PREPARATION,
      expectedLaunchId: LAUNCH_ID,
      expectedPoolId: POOL_ID,
      expectedToken: token,
      expectedComponents: [{
        account: token,
        kind: "token",
        runtimeCodeHash: `0x${"41".repeat(32)}`,
      }, {
        account: hook,
        kind: "hook",
        runtimeCodeHash: `0x${"42".repeat(32)}`,
      }, {
        account: nft,
        kind: "nft",
        runtimeCodeHash: `0x${"43".repeat(32)}`,
      }],
      primaryEvidence: {
        kind: "shards-nested-factory",
        routerIdentity: `sha256:${"51".repeat(32)}`,
        factoryIdentity: `sha256:${"52".repeat(32)}`,
        routeId: route.routeId,
        routeVersion: route.routeVersion,
        profileId: route.profileId,
        profileVersion: route.profileVersion,
        profileKey: route.profileKey,
        routePayloadHash: `0x${"53".repeat(32)}`,
        expectedResultHash: `0x${"54".repeat(32)}`,
        poolId: POOL_ID,
        configurationHash: `0x${"57".repeat(32)}`,
        revenuePolicyHash: `0x${"58".repeat(32)}`,
        stampRequestHash: `0x${"55".repeat(32)}`,
        launchWallet: WALLET,
        nonce: ROUTE_NONCE,
        evidenceCommitmentHash: `sha256:${"56".repeat(32)}`,
      },
      browserAction: browserAction(),
      launchPreflight: launchPreflight(),
    };
  }

  it("freezes only the exact route/profile names and keeps every release commitment inactive", () => {
    expect(MANUAL_ROUTER_NESTED_FACTORY_PROFILE_TYPE_V2).toBe(
      "ProgrammableNestedFactoryProfileV1(bytes32 profileIdHash,bytes32 profileVersionHash)",
    );
    expect(MANUAL_ROUTER_SHARDS_ROUTE_IDENTITY_V2).toEqual({
      routeId: "nested-factory",
      routeVersion: "1.0.0",
      profileId: "exact-shards-nested-factory",
      profileVersion: "1.0.0",
      primaryEvidenceKind: "shards-nested-factory",
    });
    expect(MANUAL_ROUTER_NESTED_FACTORY_BINDING_V2.active).toBe(false);
    expect(MANUAL_ROUTER_NESTED_FACTORY_BINDING_V2.activationAllowed)
      .toBe(false);
    expect(MANUAL_ROUTER_NESTED_FACTORY_BINDING_V2.canonicalArtifact)
      .toEqual({
        path: "outputs/shards-nested-factory-route-v1.canonical.json",
        byteLength: 1287041,
        sha256:
          "sha256:066475058bfd47b85b4216f95b434756d67d7e289ffb36535c121ef5d7c11bab",
        keccak256:
          "0x8c5521d6796e3e63c3e2cf82e1122c952e6465c345d8a10b3773a70aa2419fb3",
        integritySha256:
          "sha256:74028d65363189804912f2907400da11098d90579c9261e1d087b2d5a709ae6f",
        status:
          "frozen-contract-and-exact-shards-artifact-undeployed-acceptance-pending-no-permit-no-signature",
      });
    expect(MANUAL_ROUTER_NESTED_FACTORY_BINDING_V2.router).toEqual({
      address: null,
      runtimeCodeHash: null,
      directLaunchSelector: null,
    });
    expect(MANUAL_ROUTER_NESTED_FACTORY_BINDING_V2.module).toEqual({
      address: null,
      runtimeCodeHash: null,
    });
    expect(Object.values(
      MANUAL_ROUTER_NESTED_FACTORY_BINDING_V2.schemaHashes,
    ).every((value) => value === null)).toBe(true);
    expect(Object.values(
      MANUAL_ROUTER_NESTED_FACTORY_BINDING_V2.eventTopics,
    ).every((value) => value === null)).toBe(true);
    expect(MANUAL_ROUTER_NESTED_FACTORY_BINDING_V2.authorityVendor)
      .toEqual({
        adapterCommit: "b180aca739e0745d16618542052e44b89e177bae",
        adapterTree: "b7a90a8f7d0e48c581bf212595a1ad5d5906153f",
        bundleSha256:
          "sha256:2857f80616cd9dd3da6128a298f935c2cdc7acc8909bfd7fad58ed82776241de",
        manifestSha256:
          "sha256:ba46a2aff95c30fe4f75e60c70da654c90787e58c1f3fdb15c408704c2d81343",
        goldenSha256:
          "sha256:befb581ce142001a5cd5b68a256c55a86dc435630139832d5438f257b77f55db",
      });
    expect(MANUAL_ROUTER_NESTED_FACTORY_BINDING_V2.exactPlan).toMatchObject({
      routePayloadHash:
        "0x75403c2f52dbdf623cfcd077fab52308b3e1e0623016ec73539fac5234f21356",
      expectedResultHash:
        "0x29de1a5462fe7b07a0d58894f7ec5e2eb4e870c83153e2109647c7f4094c828b",
      launchId:
        "0xd225b22ea82ef2425660da409849a55c1c44751eedd9cd1b581a48358a0905eb",
      stampRequestHash:
        "0x276a295580bcb65ed286a2a02efba575eaee87c090f54c94e5ad8a2b78552bce",
    });
    expect(isManualRouterProductionBindingV2Active()).toBe(false);
    expect(() => getActiveManualRouterProductionBindingV2())
      .toThrow("production binding is inactive");
  });

  it("vendors the exact disabled Authority V2 bundle and canonical Golden", () => {
    const root = join(process.cwd(), "lib/vendor/manual-router-authority-v2");
    const manifestBytes = readFileSync(join(root, "manifest.json"));
    const manifest = JSON.parse(manifestBytes.toString("utf8"));
    const digest = (bytes: Buffer) => createHash("sha256")
      .update(bytes).digest("hex");
    expect(digest(manifestBytes)).toBe(
      "ba46a2aff95c30fe4f75e60c70da654c90787e58c1f3fdb15c408704c2d81343",
    );
    expect(manifest.adapter).toMatchObject({
      publicExport: "./manual-router-v2",
      commit: "b180aca739e0745d16618542052e44b89e177bae",
      tree: "b7a90a8f7d0e48c581bf212595a1ad5d5906153f",
      provisionalDirtySource: false,
    });
    expect(digest(readFileSync(join(
      root,
      "manual-router-portable.v2.mjs",
    )))).toBe(
      "2857f80616cd9dd3da6128a298f935c2cdc7acc8909bfd7fad58ed82776241de",
    );
    const golden = JSON.parse(readFileSync(join(
      root,
      "artifacts/manual-router-v2-disabled-golden.v1.json",
    ), "utf8"));
    expect(golden).toMatchObject({
      activationAllowed: false,
      release: {
        routePayloadHash:
          MANUAL_ROUTER_NESTED_FACTORY_BINDING_V2.exactPlan.routePayloadHash,
        expectedResultHash:
          MANUAL_ROUTER_NESTED_FACTORY_BINDING_V2.exactPlan.expectedResultHash,
        launchId: MANUAL_ROUTER_NESTED_FACTORY_BINDING_V2.exactPlan.launchId,
        stampRequestHash:
          MANUAL_ROUTER_NESTED_FACTORY_BINDING_V2.exactPlan.stampRequestHash,
        finalRouteLedgerBinding: {
          activationAllowed: false,
          revenueAttestationSha256: null,
          revenueVerifierArtifactSha256: null,
        },
      },
    });
  });

  it("derives and parses only the typed exact Shards profile identity", () => {
    expect(NESTED_PROFILE_KEY).toMatch(/^0x[0-9a-f]{64}$/u);
    expect(parseManualRouterRouteBindingV2(route)).toEqual(route);
    expect(() => manualRouterRouteFactsV2(route))
      .toThrow("production binding is inactive");
    expect(() => parseManualRouterRouteBindingV2({
      ...route,
      profileId: "shards-compatible-v1",
    })).toThrow("literal is invalid");
    expect(() => parseManualRouterRouteBindingV2({
      ...route,
      profileKey: `0x${"ff".repeat(32)}`,
    })).toThrow("profile key is invalid");
    expect(() => parseManualRouterRouteBindingV2({
      ...route,
      routeId: "custom-graph",
    })).toThrow("literal is invalid");
  });

  it("rejects every V2 response and wallet action until the audited binding is frozen", () => {
    const nestedSummary = {
      artifactSchemaVersion:
        "programmable.manual-router-complete-signed-artifact.v2",
      subjectHash: SUBJECT,
      pointerHash: POINTER,
      pullRequestNumber: 6,
      headSha: "a".repeat(40),
      treeSha: "b".repeat(40),
      grantBindingHash: APPROVAL,
      routeBindingHash: `sha256:${"34".repeat(32)}`,
      launchArtifactCommitmentHash: `sha256:${"35".repeat(32)}`,
      acceptanceSubjectHash: ACCEPTANCE_SUBJECT,
      currentAcceptanceHash: CURRENT_ACCEPTANCE,
      applicantAcceptanceClaimSha256: ACCEPTANCE_CLAIM,
      applicantAcceptanceRecordHash: ACCEPTANCE_RECORD,
      route,
      routeNonce: ROUTE_NONCE,
      status: "ready",
      deadline: "2000",
      submittedTransactionHash: null,
      failedTransactionEvidenceHash: null,
      executionMode: null,
    };
    const list = {
      schemaVersion: "programmable.manual-router-applicant-list-response.v2",
      authenticatedGitHubUserId: "123456789",
      linkedLaunchWallet: WALLET,
      submissions: [nestedSummary],
      applicantIndexHash: POINTER,
    };
    expect(() => parseManualRouterApplicantListResponseV2(list))
      .toThrow("production binding is inactive");
    expect(() => parseManualRouterApplicantListResponseV2({
      ...list,
      submissions: [{ ...nestedSummary, approvalBindingHash: APPROVAL }],
    })).toThrow("unexpected fields");
    expect(() => parseManualRouterBrowserWalletActionV2(
      browserAction(),
      WALLET,
    )).toThrow("production binding is inactive");
    expect(() => parseManualRouterBrowserWalletActionV2({
      ...browserAction(),
      schemaVersion: "programmable.browser-wallet-router-action.v1",
    }, WALLET)).toThrow("browser wallet action V2 is invalid");
    expect(() => parseManualRouterBrowserWalletActionV2({
      ...browserAction(),
      params: [{ ...browserAction().params[0], value: "0x1" }],
    }, WALLET)).toThrow("browser wallet transaction V2 is invalid");
  });

  it("keeps a pure V1 applicant directory valid after the V2 switch is installed", async () => {
    const legacy = {
      schemaVersion: "programmable.manual-router-applicant-list-response.v1",
      authenticatedGitHubUserId: "123456789",
      linkedLaunchWallet: WALLET,
      submissions: [{
        subjectHash: SUBJECT,
        pointerHash: POINTER,
        pullRequestNumber: 7,
        headSha: "a".repeat(40),
        treeSha: "b".repeat(40),
        approvalBindingHash: APPROVAL,
        routeNonce: ROUTE_NONCE,
        status: "ready",
        deadline: "2000",
        submittedTransactionHash: null,
        failedTransactionEvidenceHash: null,
      }],
      applicantIndexHash: POINTER,
    } as const;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify(legacy),
      { status: 200, headers: { "content-type": "application/json" } },
    )));
    try {
      await expect(listManualRouterApplicantSubmissionsVersionedV2({
        session: { accessToken: "access", identityToken: "identity" },
        launchWallet: WALLET,
      })).resolves.toEqual(legacy);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("never substitutes a legacy pointer into the accepted Jesse route", () => {
    const legacy = {
      schemaVersion: "programmable.manual-router-applicant-list-response.v1",
      authenticatedGitHubUserId: "123456789",
      linkedLaunchWallet: WALLET,
      submissions: [{
        subjectHash: SUBJECT,
        pointerHash: POINTER,
        pullRequestNumber: 7,
        headSha: "a".repeat(40),
        treeSha: "b".repeat(40),
        approvalBindingHash: APPROVAL,
        routeNonce: ROUTE_NONCE,
        status: "ready" as const,
        deadline: "2000",
        submittedTransactionHash: null,
        failedTransactionEvidenceHash: null,
      }],
      applicantIndexHash: POINTER,
    } satisfies ManualRouterApplicantListResponseV1;
    expect(manualRouterDirectoryForApplicantV2({
      directory: legacy,
      requireExactShardsRoute: false,
    })).toBe(legacy);
    expect(() => manualRouterDirectoryForApplicantV2({
      directory: legacy,
      requireExactShardsRoute: true,
    })).toThrow("exact Shards Router V2 submission is unavailable");

    const mixed = {
      schemaVersion: "programmable.manual-router-applicant-list-response.v2",
      authenticatedGitHubUserId: "123456789",
      linkedLaunchWallet: WALLET,
      submissions: [{
        ...legacy.submissions[0],
        artifactSchemaVersion:
          "programmable.manual-router-complete-signed-artifact.v1" as const,
      }, {
        artifactSchemaVersion:
          "programmable.manual-router-complete-signed-artifact.v2" as const,
        subjectHash: `sha256:${"19".repeat(32)}` as const,
        pointerHash: `sha256:${"29".repeat(32)}` as const,
        pullRequestNumber: 6,
        headSha: "c".repeat(40),
        treeSha: "d".repeat(40),
        grantBindingHash: APPROVAL,
        routeBindingHash: `sha256:${"39".repeat(32)}` as const,
        launchArtifactCommitmentHash: `sha256:${"49".repeat(32)}` as const,
        acceptanceSubjectHash: ACCEPTANCE_SUBJECT,
        currentAcceptanceHash: CURRENT_ACCEPTANCE,
        applicantAcceptanceClaimSha256: ACCEPTANCE_CLAIM,
        applicantAcceptanceRecordHash: ACCEPTANCE_RECORD,
        route,
        routeNonce: ROUTE_NONCE,
        status: "ready" as const,
        deadline: "2000",
        submittedTransactionHash: null,
        failedTransactionEvidenceHash: null,
        executionMode: null,
      }],
      applicantIndexHash: POINTER,
    } satisfies ManualRouterApplicantListResponseV2;
    const exact = manualRouterDirectoryForApplicantV2({
      directory: mixed,
      requireExactShardsRoute: true,
    });
    expect(exact.submissions).toHaveLength(1);
    expect("artifactSchemaVersion" in exact.submissions[0]!
      && exact.submissions[0]!.artifactSchemaVersion)
      .toBe("programmable.manual-router-complete-signed-artifact.v2");
  });

  it("parses V2 report and finality acknowledgements with exact route selectors", () => {
    const routeBindingHash = `sha256:${"71".repeat(32)}` as const;
    const transactionHash = `0x${"72".repeat(32)}` as const;
    const expected = {
      subjectHash: SUBJECT,
      descriptorHash: DESCRIPTOR,
      routeBindingHash,
      transactionHash,
    } as const;
    const report = {
      schemaVersion:
        "programmable.manual-router-applicant-transaction-response.v2",
      ...expected,
      pointerHash: POINTER,
      idempotent: false,
    } as const;
    expect(parseManualRouterApplicantTransactionResponseV2(report, expected))
      .toEqual(report);
    expect(() => parseManualRouterApplicantTransactionResponseV2({
      ...report,
      routeBindingHash: `sha256:${"73".repeat(32)}`,
    }, expected)).toThrow("changed its selector");
    expect(() => parseManualRouterApplicantTransactionResponseV2({
      ...report,
      approvalBindingHash: APPROVAL,
    }, expected)).toThrow("unexpected fields");

    const finalized = {
      schemaVersion:
        "programmable.manual-router-applicant-finality-response.v2",
      disposition: "finalized",
      ...expected,
      proofHash: `sha256:${"74".repeat(32)}`,
      executionMode: "EXACT_EXISTING_LAUNCH_ADOPTED",
      pointerHash: POINTER,
      idempotent: true,
    } as const;
    expect(parseManualRouterApplicantFinalityResponseV2(finalized, expected))
      .toEqual(finalized);
    expect(() => parseManualRouterApplicantFinalityResponseV2({
      ...finalized,
      failedTransactionEvidenceHash: `sha256:${"75".repeat(32)}`,
    }, expected)).toThrow("unexpected fields");
    expect(() => parseManualRouterApplicantFinalityResponseV2({
      ...finalized,
      executionMode: "EXACT_EXISTING_LAUNCH_ADOPTED_AND_PRISTINE",
    }, expected)).toThrow("execution mode is invalid");
  });

  it("keeps exact GitHub route acceptance review-only and unreachable before activation", () => {
    const plan = {
      schemaVersion: "programmable.manual-router-route-acceptance-plan.v1",
      requestHeadSha: "1aa5017154d227e639cfe6256f39bf3916352124",
      requestTreeSha: "b".repeat(40),
      sourceCommit: "91b38f3de64d96cac7e29f127c004f128fc1da59",
      sourceTree: "92d6def8609e829487adea66c13901734e43c8c7",
      fromRouteId: "custom-graph",
      fromRouteVersion: "1.0.0",
      toRouteId: route.routeId,
      toRouteVersion: route.routeVersion,
      profileId: route.profileId,
      profileVersion: route.profileVersion,
      profileKey: route.profileKey,
      routerAddress: router,
      routerRuntimeCodeHash: `0x${"61".repeat(32)}`,
      moduleAddress: "0x7777777777777777777777777777777777777777",
      moduleRuntimeCodeHash: `0x${"62".repeat(32)}`,
      routePayloadHash: `0x${"63".repeat(32)}`,
      expectedResultHash: `0x${"64".repeat(32)}`,
      revenuePolicyHash: `0x${"67".repeat(32)}`,
      poolId: POOL_ID,
      configurationHash: `0x${"68".repeat(32)}`,
      reviewedPlanSha256: `sha256:${"65".repeat(32)}`,
      launchWallet: WALLET,
      reviewedFactory: {
        address: "0x8888888888888888888888888888888888888888",
        runtimeCodeHash: `0x${"81".repeat(32)}`,
      },
      reviewedComponents: [
        ["renderer", "0x9999999999999999999999999999999999999999", "82"],
        ["token", "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "83"],
        ["hook", "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "84"],
        ["nft", "0xcccccccccccccccccccccccccccccccccccccccc", "85"],
      ].map(([kind, address, hash]) => ({
        kind,
        address,
        deployer: "0x8888888888888888888888888888888888888888",
        runtimeCodeHash: `0x${hash.repeat(32)}`,
      })),
      atomicLaunch: {
        transactionCount: 1,
        transactionSender: WALLET,
        executionEntry: "acceptance-bound-router",
        predeployment: {
          status: "completed-and-verified",
          applicantAction: false,
          productionExecutionPhase:
            "platform-release-before-applicant-acceptance",
          factoryAddress: "0x8888888888888888888888888888888888888888",
          factoryRuntimeCodeHash: `0x${"81".repeat(32)}`,
          rendererAddress: "0x9999999999999999999999999999999999999999",
          rendererRuntimeCodeHash: `0x${"82".repeat(32)}`,
          predeploymentEvidenceSha256: `sha256:${"87".repeat(32)}`,
          gasCapReceiptSha256: `sha256:${"88".repeat(32)}`,
        },
        launchExecution: {
          productionExecutionCaller: "programmable-launch-stamp-router-v2",
          applicantAction: "launch-and-stamp",
        },
        initialStatePolicy: {
          mode: "exact-predeployed-only",
          state: {
            id: "exact-predeployed-pair",
            factoryRuntimeCodeHash: `0x${"81".repeat(32)}`,
            rendererRuntimeCodeHash: `0x${"82".repeat(32)}`,
            action: "launch-and-stamp",
          },
          commonPreconditions: {
            tokenCode: "empty",
            hookCode: "empty",
            nftCode: "empty",
            poolSlot0: "zero",
          },
        },
      },
      economics: {
        totalFeeBps: 100,
        legOrder: [
          "builder-provider",
          "programmable-launcher",
          "shards-nft-holders",
        ],
        legs: [{
          roleLabel: "ProgrammableRevenueRoleV1:builder-provider",
          feeBps: 10,
          recipient: "0xdddddddddddddddddddddddddddddddddddddddd",
          recipientModeLabel:
            "ProgrammableRevenueRecipientModeV1:current-builder-may-rotate-to-successor",
        }, {
          roleLabel: "ProgrammableRevenueRoleV1:programmable-launcher",
          feeBps: 10,
          recipient: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
          recipientModeLabel:
            "ProgrammableRevenueRecipientModeV1:immutable-launcher-recipient",
        }, {
          roleLabel: "ProgrammableRevenueRoleV1:shards-nft-holders",
          feeBps: 80,
          recipient: "0xffffffffffffffffffffffffffffffffffffffff",
          recipientModeLabel:
            "ProgrammableRevenueRecipientModeV1:exact-shards-hook-running-holder-accumulator",
        }],
        revenuePolicyHash: `0x${"67".repeat(32)}`,
      },
    };
    const claimCanonicalJson = "{}";
    const response = {
      schemaVersion:
        "programmable.manual-router-route-acceptance-state-response.v1",
      state: "pending",
      stateVersion: "0",
      claimSha256: `sha256:${createHash("sha256")
        .update(claimCanonicalJson, "utf8").digest("hex")}`,
      acceptanceSubjectHash:
        "sha256:948a920b86aa915bc2dfcdcf56b271f41a2843fc1360b734e9221c0533d960b8",
      currentAcceptanceHash: null,
      claimCanonicalJson,
      acceptedAtEpochSeconds: null,
      acceptanceRecordHash: null,
      plan,
    };
    expect(MANUAL_ROUTER_NESTED_FACTORY_BINDING_V2.acceptanceClaimSha256)
      .toBe(
        "sha256:02e0fba56c294bcef1d6d40dace601b96cf647f60f1b24fc16e1303f19b1aa39",
      );
    expect(() => parseManualRouterRouteAcceptanceStateResponseV1({
      ...response,
      stateVersion: "1",
    })).toThrow("disposition is invalid");
    expect(() => parseManualRouterRouteAcceptanceStateResponseV1({
      ...response,
      claimCanonicalJson: "{\"changed\":true}",
    })).toThrow("claim hash is invalid");
    expect(() => parseManualRouterRouteAcceptanceStateResponseV1(response))
      .toThrow("production binding is inactive");
    expect(() => parseManualRouterRouteAcceptanceStateResponseV1({
      ...response,
      plan: { ...plan, launchAuthorization: false },
    })).toThrow("unexpected fields");
    expect(() => parseManualRouterRouteAcceptanceStateResponseV1({
      ...response,
      plan: { ...plan, toRouteId: "custom-graph" },
    })).toThrow("literal is invalid");
    expect(() => parseManualRouterRouteAcceptanceStateResponseV1({
      ...response,
      plan: {
        ...plan,
        reviewedComponents: [
          plan.reviewedComponents[1],
          plan.reviewedComponents[0],
          ...plan.reviewedComponents.slice(2),
        ],
      },
    })).toThrow("component order is invalid");
    expect(() => parseManualRouterRouteAcceptanceStateResponseV1({
      ...response,
      plan: {
        ...plan,
        economics: {
          ...plan.economics,
          legs: plan.economics.legs.map((leg, index) =>
            index === 2 ? { ...leg, feeBps: 79 } : leg),
        },
      },
    })).toThrow("revenue leg is invalid");

    const client = readFileSync(
      join(process.cwd(), "lib/custom-launch/manual-router-client-v1.ts"),
      "utf8",
    );
    expect(client).toContain("/api/custom-launch/manual/route-acceptance");
    expect(client).toContain(
      "programmable.manual-router-route-acceptance-state-request.v1",
    );
    expect(client).toContain(
      "programmable.applicant-route-acceptance-command.v1",
    );
    expect(client).toContain('action: "accept-reviewed-route"');
    expect(client).toContain('expectedState: "pending"');
    expect(client).toContain("claimSha256");

    const component = readFileSync(
      join(process.cwd(), "components/manual-applicant-launch.tsx"),
      "utf8",
    );
    expect(component).toContain("NESTED_FACTORY_ACTIVATION !== null");
    expect(component).toContain("Accept exact reviewed route");
    expect(component).toContain("It does not\n            authorize a launch");
    expect(component).toContain("manualRouterFreshReadyMatchesCachedV2");
    expect(component).toContain("nestedFactoryRoute={isManualRouterResolveV2");
    expect(component).toContain('const SHARDS_GITHUB_LOGIN = "jesse-stahl"');
    expect(component).toContain(
      "const shardsRouteCapabilityUnavailable = exactShardsApplicant",
    );
    expect(component).toContain(
      "requireExactShardsRoute: exactShardsApplicant",
    );
    expect(component).toContain(
      "disabled={!githubConnected || !routeAccepted}",
    );
    expect(component).toContain("The exact Shards route is not available yet");
    expect(component).toContain("isNestedFactorySubmissionV2(chosenSubmission)");
    expect(component).toContain("Reviewed deployment order");
    expect(component).toContain("Reviewed economics");
    expect(component).toContain(
      "Completed and verified platform predeployment",
    );
    expect(component).toContain("Required launch state");
  });

  it("rechecks every exact V2 route, artifact, component and action binding before send", () => {
    const cached = readyV2();
    expect(manualRouterFreshReadyMatchesCachedV2({
      cached,
      fresh: cached,
      linkedLaunchWallet: WALLET,
    })).toBe(true);
    expect(manualRouterFreshReadyMatchesCachedV2({
      cached,
      fresh: {
        ...cached,
        browserAction: {
          ...cached.browserAction,
          pendingNonceAtPreparation: "999",
        },
      },
      linkedLaunchWallet: WALLET,
    })).toBe(true);
    for (const fresh of [
      {
        ...cached,
        routeBindingHash: `sha256:${"fe".repeat(32)}` as const,
      },
      {
        ...cached,
        expectedComponents: cached.expectedComponents.map((component, index) =>
          index === 1
            ? { ...component, runtimeCodeHash: `0x${"fe".repeat(32)}` as const }
            : component),
      },
      {
        ...cached,
        primaryEvidence: {
          ...cached.primaryEvidence,
          routePayloadHash: `0x${"fe".repeat(32)}` as const,
        },
      },
      {
        ...cached,
        browserAction: {
          ...cached.browserAction,
          params: [{
            ...cached.browserAction.params[0],
            data: "0x5678" as const,
          }] as const,
        },
      },
    ] as const) {
      expect(manualRouterFreshReadyMatchesCachedV2({
        cached,
        fresh,
        linkedLaunchWallet: WALLET,
      })).toBe(false);
    }
    expect(manualRouterFreshReadyMatchesCachedV2({
      cached,
      fresh: cached,
      linkedLaunchWallet: OTHER_WALLET,
    })).toBe(false);
  });
});

describe("manual Applicant production configuration", () => {
  const alchemyUrl = "https://eth-mainnet.g.alchemy.com/v2/test-key";
  const quickNodeUrl = "https://example.quiknode.pro/test-key";
  const valid = {
    PROGRAMMABLE_MANUAL_APPLICANT_LAUNCH_ENABLED: "true",
    PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL: alchemyUrl,
    PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL: quickNodeUrl,
    PROGRAMMABLE_ALCHEMY_MAINNET_RPC_ENDPOINT_COMMITMENT:
      rpcProviderCommitment("endpoint", alchemyUrl),
    PROGRAMMABLE_QUICKNODE_MAINNET_RPC_ENDPOINT_COMMITMENT:
      rpcProviderCommitment("endpoint", quickNodeUrl),
    NEXT_PUBLIC_PRIVY_APP_ID: "privy-app",
    PRIVY_APP_SECRET: "privy-secret",
    OPS_BLOB_READ_WRITE_TOKEN: "blob-token",
    CRON_SECRET: "c".repeat(32),
  };

  it("returns the typed default-off response before constructing production clients", async () => {
    vi.stubEnv("PROGRAMMABLE_MANUAL_APPLICANT_LAUNCH_ENABLED", "false");
    vi.stubEnv("PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL", "");
    vi.stubEnv("PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL", "");
    vi.stubEnv("OPS_BLOB_READ_WRITE_TOKEN", "");
    vi.stubEnv("PRIVY_APP_SECRET", "");
    vi.stubEnv("CRON_SECRET", "");
    try {
      const response = await handleProductionManualRouterWebsiteRouteV1(
        new Request("https://programmable.com/api/custom-launch/manual/submissions", {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
          },
          body: "{}",
        }),
        "submissions",
      );
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        schemaVersion: "programmable.manual-router-website-error.v1",
        code: "manual_launch_not_enabled",
        retryable: false,
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("is default-off and accepts only the strict named provider pair", () => {
    expect(isManualRouterApplicantLaunchEnabledV1({})).toBe(false);
    expect(isManualRouterApplicantLaunchEnabledV1(valid)).toBe(true);
    expect(resolveManualRouterStrictRpcConfigurationV1(valid)).toEqual({
      alchemyUrl: valid.PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL,
      quickNodeUrl: valid.PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL,
    });
    expect(() => assertManualRouterProductionConfigurationV1(valid)).not.toThrow();
  });

  it("rejects every provider URL shape rejected by the portable authority", () => {
    expect(() => resolveManualRouterStrictRpcConfigurationV1({
      ...valid,
      PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL: undefined,
    })).toThrow("PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL");
    expect(() => resolveManualRouterStrictRpcConfigurationV1({
      ...valid,
      PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL:
        "https://eth-mainnet.g.alchemy.com/v2/test-key",
    })).toThrow("strict provider");
    expect(() => resolveManualRouterStrictRpcConfigurationV1({
      ...valid,
      PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL:
        "https://example.quiknode.pro/test-key",
      PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL:
        "https://eth-mainnet.g.alchemy.com/v2/test-key",
    })).toThrow("strict provider");
    expect(() => resolveManualRouterStrictRpcConfigurationV1({
      ETHEREUM_RPC_URL: valid.PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL,
      ETHEREUM_RPC_URL_B: valid.PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL,
    })).toThrow("PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL");
    expect(() => resolveManualRouterStrictRpcConfigurationV1({
      ...valid,
      PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL:
        `${valid.PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL}?override=true`,
    })).toThrow("strict provider");
    for (const alchemyUrl of [
      "http://eth-mainnet.g.alchemy.com/v2/key",
      "https://foo.alchemy.com/v2/key",
      "https://eth-mainnet.g.alchemy.com/",
      "https://eth-mainnet.g.alchemy.com:8443/v2/key",
      "https://user@eth-mainnet.g.alchemy.com/v2/key",
      "https://eth-mainnet.g.alchemy.com/v2/key#fragment",
      ` ${valid.PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL}`,
      `https://eth-mainnet.g.alchemy.com/${"x".repeat(2_049)}`,
    ]) {
      expect(() => resolveManualRouterStrictRpcConfigurationV1({
        ...valid,
        PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL: alchemyUrl,
      })).toThrow();
    }
    for (const quickNodeUrl of [
      "https://quiknode.pro/key",
      "https://example.quicknode.com/key",
      "https://example.quiknode.pro/",
      "https://example.quiknode.pro:8443/key",
      "https://user:pass@example.quiknode.pro/key",
      "https://example.quiknode.pro/key?override=true",
      `${valid.PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL} `,
    ]) {
      expect(() => resolveManualRouterStrictRpcConfigurationV1({
        ...valid,
        PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL: quickNodeUrl,
      })).toThrow();
    }
  });

  it("binds runtime RPCs to protected commitments and validates cron bytes", () => {
    expect(() => resolveManualRouterStrictRpcConfigurationV1({
      ...valid,
      PROGRAMMABLE_ALCHEMY_MAINNET_RPC_ENDPOINT_COMMITMENT:
        `0x${"1".repeat(64)}`,
    })).toThrow("Alchemy endpoint commitment mismatch");
    expect(() => resolveManualRouterStrictRpcConfigurationV1({
      ...valid,
      PROGRAMMABLE_QUICKNODE_MAINNET_RPC_ENDPOINT_COMMITMENT:
        valid.PROGRAMMABLE_ALCHEMY_MAINNET_RPC_ENDPOINT_COMMITMENT,
    })).toThrow("commitments are not independent");
    expect(() => assertManualRouterProductionConfigurationV1({
      ...valid,
      CRON_SECRET: "c".repeat(31),
    })).toThrow("CRON_SECRET");
    expect(() => assertManualRouterProductionConfigurationV1({
      ...valid,
      CRON_SECRET: "c".repeat(1_025),
    })).toThrow("CRON_SECRET");
    expect(() => assertManualRouterProductionConfigurationV1({
      ...valid,
      CRON_SECRET: "é".repeat(16),
    })).not.toThrow();
    expect(() => assertManualRouterProductionConfigurationV1({
      ...valid,
      CRON_SECRET: "é".repeat(513),
    })).toThrow("CRON_SECRET");
  });
});

describe("manual Applicant Privy identity", () => {
  const principal = Object.freeze({
    privyUserId: "did:privy:user",
    githubUserId: "123456789",
    githubUsername: "applicant",
    githubPrincipalHash: `sha256:${"aa".repeat(32)}` as const,
  });

  it("rereads the current numeric GitHub subject and exact linked Ethereum wallet", async () => {
    const accounts: Array<{
      type: string;
      subject?: string;
      chainType?: string;
      address?: string;
    }> = [
      { type: "github_oauth", subject: principal.githubUserId },
      { type: "wallet", chainType: "ethereum", address: WALLET },
      { type: "wallet", chainType: "solana", address: OTHER_WALLET },
    ];
    const authenticator = createManualRouterApplicantAuthenticatorFromBoundaryV1({
      githubAuthenticator: { async authenticate() { return principal; } },
      currentUserBoundary: {
        async getCurrentUser() {
          return { id: principal.privyUserId, linkedAccounts: accounts };
        },
      },
    });
    await expect(authenticator.authenticate(
      new Request("https://programmable.market/api"),
      WALLET,
    )).resolves.toMatchObject({
      githubUserId: principal.githubUserId,
      linkedLaunchWallet: WALLET,
    });
    await expect(authenticator.authenticate(
      new Request("https://programmable.market/api"),
      OTHER_WALLET,
    )).rejects.toThrow("launch_wallet_not_linked");
    accounts[0] = { type: "github_oauth", subject: "987654321" };
    await expect(authenticator.authenticate(
      new Request("https://programmable.market/api"),
      WALLET,
    )).rejects.toThrow("github_subject_mismatch");
  });

  it("returns an Applicant authentication error instead of a storage failure", async () => {
    vi.stubEnv("PROGRAMMABLE_MANUAL_APPLICANT_LAUNCH_ENABLED", "true");
    const authenticator = createManualRouterApplicantAuthenticatorFromBoundaryV1({
      githubAuthenticator: {
        async authenticate() {
          throw new GitHubPrincipalAuthenticationErrorV1(401, "session_required");
        },
      },
      currentUserBoundary: {
        async getCurrentUser() {
          throw new TypeError("current user must not be read");
        },
      },
    });
    try {
      const response = await handleManualRouterWebsiteRouteV1(
        new Request(
          "https://programmable.market/api/custom-launch/manual/submissions",
          {
            method: "POST",
            headers: {
              accept: "application/json",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              schemaVersion:
                "programmable.manual-router-applicant-list-request.v1",
              launchWallet: WALLET,
            }),
          },
        ),
        "submissions",
        {
          authenticator,
          service: {} as never,
          finalityService: {} as never,
          routeAcceptanceService: {} as never,
        },
      );

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({
        schemaVersion: "programmable.manual-router-website-error.v1",
        code: "applicant_authentication_required",
        retryable: false,
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("manual Applicant private Blob CAS", () => {
  function memoryBoundary() {
    const values = new Map<string, { body: string; etag: string }>();
    let version = 0;
    return {
      values,
      boundary: {
        async get(path: string) {
          const value = values.get(path);
          return value
            ? { statusCode: 200, etag: value.etag, body: value.body }
            : { statusCode: 404, etag: null, body: null };
        },
        async put(
          path: string,
          body: string,
          options: { allowOverwrite: boolean; ifMatch?: string },
        ) {
          const current = values.get(path);
          if (
            (!options.allowOverwrite && current)
            || (options.ifMatch !== undefined && current?.etag !== options.ifMatch)
          ) {
            const error = new Error("conflict");
            error.name = "BlobPreconditionFailedError";
            throw error;
          }
          version += 1;
          const etag = `etag-${version}`;
          values.set(path, { body, etag });
          return { etag };
        },
        async list({ prefix }: { prefix: string }) {
          return {
            paths: [...values.keys()].filter((path) => path.startsWith(prefix)),
            cursor: null,
            hasMore: false,
          };
        },
        isPreconditionFailure(error: unknown) {
          return error instanceof Error
            && error.name === "BlobPreconditionFailedError";
        },
      },
    };
  }

  it("uses immutable content and rejects stale writer A after A to B", async () => {
    const memory = memoryBoundary();
    const store = new ManualRouterPrivateBlobStoreV1(memory.boundary);
    const immutable = manualRouterContentPathV1("signed-artifacts", SUBJECT);
    await expect(store.putImmutable(immutable, { a: 1 })).resolves.toMatchObject({
      idempotent: false,
    });
    await expect(store.putImmutable(immutable, { a: 1 })).resolves.toMatchObject({
      idempotent: true,
    });
    await expect(store.putImmutable(immutable, { a: 2 })).rejects.toBeInstanceOf(
      ManualRouterBlobCasConflictV1,
    );

    const head = manualRouterApplicantIndexPathV1({
      approvedGitHubUserId: "123456789",
      approvedLaunchWallet: WALLET,
    });
    const initial = await store.compareAndSwap(head, null, { generation: "A" });
    const writerAEtag = (await store.read(head))!.etag;
    expect(writerAEtag).toBe(initial.etag);
    await store.compareAndSwap(head, writerAEtag, { generation: "B" });
    await expect(store.compareAndSwap(
      head,
      writerAEtag,
      { generation: "stale-A" },
    )).rejects.toBeInstanceOf(ManualRouterBlobCasConflictV1);
    expect((await store.read(head))!.value).toEqual({ generation: "B" });
  });
});

describe("manual Applicant private finality discovery", () => {
  it("keeps the scheduled worker disabled unless activation is exact true", async () => {
    await expect(runConfiguredManualRouterFinalityWorkerV1({})).resolves
      .toMatchObject({ status: "disabled", processed: 0 });
    await expect(runConfiguredManualRouterFinalityWorkerV1({
      PROGRAMMABLE_MANUAL_APPLICANT_LAUNCH_ENABLED: "false",
    })).resolves.toMatchObject({ status: "disabled", processed: 0 });
    await expect(runConfiguredManualRouterFinalityWorkerV1({
      PROGRAMMABLE_MANUAL_APPLICANT_LAUNCH_ENABLED: "TRUE",
    })).rejects.toThrow("invalidRuntimeConfig");
  });

  it("requires an exact separate CRON bearer and GET without query input", () => {
    const secret = "c".repeat(32);
    const request = (url: string, authorization: string, method = "GET") =>
      new Request(url, { method, headers: { authorization } });
    expect(isManualRouterFinalityCronAuthorizedV1(
      request(
        "https://programmable.market/api/ops/manual-router-finality",
        `Bearer ${secret}`,
      ),
      { CRON_SECRET: secret },
    )).toBe(true);
    expect(isManualRouterFinalityCronAuthorizedV1(
      request(
        "https://programmable.market/api/ops/manual-router-finality?cursor=attacker",
        `Bearer ${secret}`,
      ),
      { CRON_SECRET: secret },
    )).toBe(false);
    expect(isManualRouterFinalityCronAuthorizedV1(
      request(
        "https://programmable.market/api/ops/manual-router-finality",
        `Bearer ${"d".repeat(32)}`,
      ),
      { CRON_SECRET: secret },
    )).toBe(false);
    expect(isManualRouterFinalityCronAuthorizedV1(
      request(
        "https://programmable.market/api/ops/manual-router-finality",
        `Bearer ${secret}`,
        "POST",
      ),
      { CRON_SECRET: secret },
    )).toBe(false);
  });

  it("resumes a submitted current head by private Blob enumeration only", async () => {
    const values = new Map<string, { body: string; etag: string }>();
    let version = 0;
    const store = new ManualRouterPrivateBlobStoreV1({
      async get(path) {
        const value = values.get(path);
        return value
          ? { statusCode: 200, etag: value.etag, body: value.body }
          : { statusCode: 404, etag: null, body: null };
      },
      async put(path, body, options) {
        const current = values.get(path);
        if (
          (!options.allowOverwrite && current)
          || (options.ifMatch !== undefined && current?.etag !== options.ifMatch)
        ) {
          const error = new Error("conflict");
          error.name = "BlobPreconditionFailedError";
          throw error;
        }
        version += 1;
        const etag = `etag-${version}`;
        values.set(path, { body, etag });
        return { etag };
      },
      async list({ prefix }) {
        return {
          paths: [...values.keys()].filter((path) => path.startsWith(prefix)),
          cursor: null,
          hasMore: false,
        };
      },
      isPreconditionFailure(error) {
        return error instanceof Error
          && error.name === "BlobPreconditionFailedError";
      },
    });
    const subjectCore = {
      schemaVersion: "programmable.manual-router-applicant-subject.v1" as const,
      repositoryId: "1320085947" as const,
      pullRequestNumber: 77,
      approvedGitHubUserId: "123456789",
      approvedLaunchWallet: WALLET,
    };
    const subject = Object.freeze({
      ...subjectCore,
      subjectHash: canonicalSha256(subjectCore.schemaVersion, subjectCore),
    });
    const signed = createManualRouterSignedPointerV1({
      artifact: {
        subject,
        approvalBindingHash: APPROVAL,
        headSha: "1".repeat(40),
        treeSha: "2".repeat(40),
        routeNonce: ROUTE_NONCE,
        preparationArtifactHash: PREPARATION,
        signatureRequestHash: `sha256:${"71".repeat(32)}`,
        descriptorHash: DESCRIPTOR,
        signedArtifactHash: `sha256:${"72".repeat(32)}`,
        validAfter: "900",
        deadline: "2000",
        reissueOf: null,
      },
      previousPointerHash: null,
      updatedAtEpochSeconds: "1000",
    });
    const submitted = advanceManualRouterPointerDispositionV1({
      previous: signed,
      updatedAtEpochSeconds: "1001",
      transactionHash: `0x${"73".repeat(32)}`,
    });
    const initial = createManualRouterApplicantIndexV1({
      previousIndex: null,
      previousPointers: [],
      nextPointer: signed,
    }).index;
    const current = createManualRouterApplicantIndexV1({
      previousIndex: initial,
      previousPointers: [signed],
      nextPointer: submitted,
    }).index;
    await store.putImmutable(
      manualRouterContentPathV1("pointer-history", submitted.pointerHash),
      submitted,
    );
    await store.compareAndSwap(manualRouterApplicantIndexPathV1({
      approvedGitHubUserId: subject.approvedGitHubUserId,
      approvedLaunchWallet: subject.approvedLaunchWallet,
    }), null, current);

    const pending = await discoverManualRouterPendingFinalityV1({ store });
    expect(pending).toHaveLength(1);
    expect(pending[0]?.pointer).toMatchObject({
      state: "submitted-awaiting-finality",
      submittedTransactionHash: `0x${"73".repeat(32)}`,
    });
    expect([...values.keys()].some((path) => path.includes("/public/")))
      .toBe(false);
  });
});

describe("manual Applicant dual-RPC boundary", () => {
  function rpcFetch(input: Readonly<{
    spread?: bigint;
    failQuickNode?: boolean;
  }> = {}) {
    const safeCalls = new Map<string, number>();
    return vi.fn(async (url: string, init: RequestInit) => {
      if (input.failQuickNode && url.includes("quiknode")) {
        return new Response("unavailable", { status: 503 });
      }
      const request = JSON.parse(String(init.body)) as {
        id: number;
        method: string;
        params: unknown[];
      };
      let result: unknown;
      if (request.method === "eth_chainId") result = "0x1";
      else if (request.method === "eth_getBlockByNumber") {
        const tag = request.params[0];
        const isQuickNode = url.includes("quiknode");
        if (tag === "latest") {
          const timestamp = 1_000n
            + (isQuickNode ? (input.spread ?? 1n) : 0n);
          result = {
            number: isQuickNode ? "0x66" : "0x65",
            hash: `0x${(isQuickNode ? "ab" : "cd").repeat(32)}`,
            timestamp: `0x${timestamp.toString(16)}`,
          };
        } else if (tag === "finalized") {
          result = {
            number: isQuickNode ? "0x65" : "0x64",
            hash: `0x${(isQuickNode ? "ef" : "12").repeat(32)}`,
            timestamp: "0x384",
          };
        } else {
          result = {
            number: "0x64",
            hash: `0x${"34".repeat(32)}`,
            timestamp: "0x384",
          };
        }
      } else if (request.method === "eth_call") {
        const transaction = request.params[0] as { to?: string; data?: string };
        if (
          transaction.to?.toLowerCase()
            === MANUAL_ROUTER_PRODUCTION_BINDING_V1.permitAuthoritySafe.address
              .toLowerCase()
          && transaction.data?.startsWith("0x1626ba7e")
        ) {
          const calls = (safeCalls.get(url) ?? 0) + 1;
          safeCalls.set(url, calls);
          result = calls === 1
            ? MANUAL_ROUTER_PRODUCTION_BINDING_V1.permitAuthoritySafe
              .erc1271MagicWord
            : "0x";
        } else {
          result = LAUNCH_ID;
        }
      } else throw new Error(`unexpected RPC method ${request.method}`);
      return Response.json({ jsonrpc: "2.0", id: request.id, result });
    });
  }

  function quorum(fetcher = rpcFetch()) {
    return new ManualRouterRpcQuorumV1({
      configuration: {
        alchemyUrl: "https://eth-mainnet.g.alchemy.com/v2/test-key",
        quickNodeUrl: "https://example.quiknode.pro/test-key",
      },
      fetch: fetcher,
    });
  }

  it("derives one common finalized chain clock and enforces a 120-second send floor", async () => {
    const clock = await quorum().readChainClock();
    expect(clock).toEqual({
      minimumTimestamp: "1000",
      maximumTimestamp: "1001",
      commonFinalizedTimestamp: "900",
      commonFinalizedBlockNumber: "100",
      commonFinalizedBlockHash: `0x${"34".repeat(32)}`,
    });
    expect(() => assertManualRouterUsableSendWindowV1(clock, {
      validAfter: "999",
      deadline: "1121",
    })).not.toThrow();
    expect(() => assertManualRouterUsableSendWindowV1(clock, {
      validAfter: "999",
      deadline: "1120",
    })).toThrow("120-second send window");
  });

  it("fails closed on one-provider loss or a latest-clock spread over 120 seconds", async () => {
    await expect(quorum(rpcFetch({ failQuickNode: true })).readChainClock())
      .rejects.toMatchObject({ code: "rpc_provider_unavailable" });
    await expect(quorum(rpcFetch({ spread: 121n })).readChainClock())
      .rejects.toMatchObject({ code: "rpc_provider_ambiguous" });
  });

  it("requires valid Safe ERC-1271 on both providers, rejects its mutation, and matches simulation output", async () => {
    const rpc = quorum();
    await expect(rpc.assertSafeSignature({
      permitDigest: `0x${"aa".repeat(32)}`,
      rawSignature: `0x${"bb".repeat(65)}`,
    })).resolves.toBeUndefined();
    await expect(rpc.simulateExactLaunch({
      from: WALLET,
      to: MANUAL_ROUTER_PRODUCTION_BINDING_V1.router.address,
      data: `0xe5f6b8cd${"00".repeat(32)}`,
      value: "0x0",
      expectedStampHash: LAUNCH_ID,
    })).resolves.toBe(LAUNCH_ID);
    await expect(rpc.simulateExactLaunch({
      from: WALLET,
      to: MANUAL_ROUTER_PRODUCTION_BINDING_V1.router.address,
      data: `0xe5f6b8cd${"00".repeat(32)}`,
      value: "0x0",
      expectedStampHash: POOL_ID,
    })).rejects.toBeInstanceOf(ManualRouterRpcQuorumErrorV1);
  });
});

describe("manual Applicant browser contract", () => {
  function listResponse() {
    return {
      schemaVersion: "programmable.manual-router-applicant-list-response.v1",
      authenticatedGitHubUserId: "123456789",
      linkedLaunchWallet: WALLET,
      submissions: [{
        subjectHash: SUBJECT,
        pointerHash: POINTER,
        pullRequestNumber: 42,
        headSha: "a".repeat(40),
        treeSha: "b".repeat(40),
        approvalBindingHash: APPROVAL,
        routeNonce: ROUTE_NONCE,
        status: "ready",
        deadline: "2000",
        submittedTransactionHash: null,
        failedTransactionEvidenceHash: null,
      }],
      applicantIndexHash: POINTER,
    };
  }

  it("accepts exact auto-loaded responses and rejects a wallet-action target drift", () => {
    expect(parseManualRouterApplicantListResponseV1(listResponse()))
      .toMatchObject({ linkedLaunchWallet: WALLET });
    const ready = (
      to: string = MANUAL_ROUTER_PRODUCTION_BINDING_V1.router.address,
    ) => ({
      schemaVersion: "programmable.manual-router-applicant-resolve-response.v1",
      subjectHash: SUBJECT,
      pointerHash: POINTER,
      approvalBindingHash: APPROVAL,
      routeNonce: ROUTE_NONCE,
      status: "ready",
      validAfter: "1000",
      deadline: "2000",
      descriptorHash: DESCRIPTOR,
      envelopeHash: ENVELOPE,
      signedArtifact: {
        prepared: {
          preparationHash: PREPARATION,
          expectedLaunchId: LAUNCH_ID,
          expectedPoolId: POOL_ID,
          browserAction: {
            schemaVersion: "programmable.browser-wallet-router-action.v1",
            walletExecutionKind: "eoa-direct",
            method: "eth_sendTransaction",
            chainId: "0x1",
            pendingNonceAtPreparation: "7",
            params: [{
              from: WALLET,
              to,
              data: `0xe5f6b8cd${"00".repeat(32)}`,
              value: "0x0",
            }],
          },
        },
      },
    });
    expect(parseManualRouterResolveResponseV1(ready(), {
      subjectHash: SUBJECT,
      launchWallet: WALLET,
    })).toMatchObject({
      status: "ready",
      preparationHash: PREPARATION,
    });
    expect(() => parseManualRouterResolveResponseV1(ready(OTHER_WALLET), {
      subjectHash: SUBJECT,
      launchWallet: WALLET,
    })).toThrow("browser wallet transaction binding");

    expect(parseManualRouterResolveResponseV1({
      ...ready(),
      status: "permit-not-yet-valid",
    }, {
      subjectHash: SUBJECT,
      launchWallet: WALLET,
    })).toMatchObject({
      status: "permit-not-yet-valid",
      validAfter: "1000",
      preparationHash: PREPARATION,
    });
  });

  it("adds the Applicant entry only behind its separate flag and exposes no upload fallback", () => {
    const disabled = renderToStaticMarkup(createElement(LaunchModelPicker, {
      manualApplicantLaunchEnabled: false,
      onChoose: () => undefined,
    }));
    const enabled = renderToStaticMarkup(createElement(LaunchModelPicker, {
      manualApplicantLaunchEnabled: true,
      onChoose: () => undefined,
    }));
    expect(disabled).not.toContain('data-launch-model-option="manual-applicant"');
    expect(enabled).toContain('data-launch-model-option="manual-applicant"');
    expect(enabled).toContain(
      'id="launch-model-manual-applicant-title">Custom Hook</strong>',
    );
    expect(enabled).toContain("Open Custom Hook launch");
    expect(enabled).not.toContain('data-launch-model-option="custom"');

    const component = readFileSync(
      join(process.cwd(), "components/manual-applicant-launch.tsx"),
      "utf8",
    );
    expect(component).not.toMatch(/type=["']file["']/u);
    expect(component).not.toMatch(/FileReader|readJsonFile|importBundle|importPreparation/u);
    expect(component).not.toContain("<main");
    expect(component).toContain('aria-labelledby="applicant-workspace-title"');
    expect(component).toContain("complete: Boolean(githubConnected && selected)");
    expect(component).toContain(">Link GitHub</button>");
    expect(component).toContain(">Connect wallet</button>");
    expect(component).toContain("titleRef.current?.focus()");
    expect(component).toContain('ref={titleRef} tabIndex={-1}');
    expect(component).toContain(
      "https://github.com/0xprogrammable/hookbuilder/tree/279dd2fc2ea8c488943ca4e60ca889cb00bab40e/submissions/requests",
    );
    expect(component).toContain("listManualRouterApplicantSubmissionsV1");
    expect(component).toContain("manualRouterCanClearUncertainNoSendV1");
    expect(component).toContain("Clear the uncertain attempt");
    expect(component).toContain(
      "Never speed up or replace a submitted beta transaction",
    );
    const freshResolve = component.indexOf(
      "const freshResolved = isManualRouterResolveV2(resolved)",
    );
    expect(component.slice(freshResolve, freshResolve + 300))
      .toContain("resolveManualRouterApplicantSubmissionV1(resolveRequest)");
    expect(component.slice(freshResolve, freshResolve + 300))
      .toContain("resolveManualRouterApplicantSubmissionV2(resolveRequest)");
    const durableArm = component.indexOf("persistAttempt(pending)", freshResolve);
    const walletSend = component.indexOf("await sendBrowserWalletAction", freshResolve);
    expect(freshResolve).toBeGreaterThan(-1);
    expect(durableArm).toBeGreaterThan(freshResolve);
    expect(walletSend).toBeGreaterThan(durableArm);
    expect(component.slice(walletSend, component.indexOf(");", walletSend)))
      .not.toMatch(/\bnonce\s*:/u);
    expect(component.indexOf("persistAttempt(submitted)")).toBeLessThan(
      component.indexOf("await reportSubmittedTransaction(submitted)"),
    );

    const entry = readFileSync(
      join(process.cwd(), "components/launch-entry.tsx"),
      "utf8",
    );
    expect(entry).toContain("manualApplicantButtonRef.current?.focus()");
    expect(entry).toContain("ref={manualApplicantButtonRef}");
  });

  it("imports the canonical Router binding instead of creating a second profile producer", () => {
    expect(() => assertManualRouterProductionBindingV1()).not.toThrow();
    const bindings = readFileSync(
      join(process.cwd(), "lib/custom-launch/manual-router-bindings-v1.ts"),
      "utf8",
    );
    expect(bindings).toContain("CANONICAL_LAUNCH_STAMP_V1");
    const changedPaths = [
      "components/manual-applicant-launch.tsx",
      "lib/server/custom-launch/manual-router-store-v1.ts",
    ];
    expect(changedPaths.join("\n")).not.toMatch(
      /profile|explore|launch-registry/iu,
    );
  });

  it("pins the exact Shards-only authority profile at the Website boundary", () => {
    const authority = readFileSync(
      join(process.cwd(), "lib/server/custom-launch/manual-router-authority-v1.ts"),
      "utf8",
    );
    expect(authority).toContain(
      "sha256:1d7c191dc3e16ba9967be76622b76269b6ac1673637212fab41594ff1665394a",
    );
    expect(authority).toContain(
      "sha256:ffba60e856fb210e11e8b22e27a319378887f99a328b3448fe069962965e98cd",
    );
    expect(authority).toContain('!== "12000000"');
    expect(authority).toContain('!== "16000000"');
    expect(authority).toContain("canonicalSha256(");
  });
});
