import {
  encodeAbiParameters,
  keccak256,
  parseAbiParameters,
  stringToHex,
  type Hex,
} from "viem";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { serializeIndexerToken } from "../lib/onchain/indexer-feed";
import { OperationalRpcUnavailableError } from
  "../lib/onchain/operational-rpc-failover.server";
import {
  enrichRouterCustomSnapshotWithFeePolicyV2,
  materializePlatformFeeRuntimeV2,
  parsePlatformFeeProfileBuildsV2,
  PRODUCTION_PLATFORM_FEE_PROFILE_BUILDS_V2,
  type PlatformFeeRuntimeImmutableSourceV2,
} from "../lib/server/custom-launch/platform-fee-policy-readback-v2";
import {
  CANONICAL_PLATFORM_FEE_POLICY_V2,
  isPlatformFeePolicyReadbackV2,
} from "../lib/tokens";
import {
  customGraphExploreEntry,
  customGraphToken,
  launchStampProvenance,
  STAMP_HOOK,
  STAMP_POOL_ID,
  STAMP_TOKEN,
} from "./launch-stamp-surface-fixture";
import { confirmedPlatformFeePolicyV2 } from "./platform-fee-policy-fixture";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 = `0x${"00".repeat(32)}` as const;
const PROFILE_ID = keccak256(
  stringToHex("programmable.fee-hook-profile.v2.zero-custom"),
);
const BASIS_ID = keccak256(stringToHex(
  "programmable.fee-basis.v2.gross-unspecified-pool-currency-amount",
));
const ASSET_MODE_ID = keccak256(stringToHex(
  "programmable.fee-asset-mode.v2.unspecified-pool-currency-per-swap",
));
const POLICY_ID = keccak256(encodeAbiParameters(parseAbiParameters(
  "bytes32,uint16,uint256,bytes32,bytes32,bytes32,uint24,uint24,address,uint160",
), [
  keccak256(stringToHex("programmable.custom-fee-policy.v2")),
  2,
  1n,
  PROFILE_ID,
  BASIS_ID,
  ASSET_MODE_ID,
  CANONICAL_PLATFORM_FEE_POLICY_V2.ratePpm,
  CANONICAL_PLATFORM_FEE_POLICY_V2.denominatorPpm,
  CANONICAL_PLATFORM_FEE_POLICY_V2.recipient,
  BigInt(CANONICAL_PLATFORM_FEE_POLICY_V2.requiredHookFlags),
]));
const COMPILER_SETTINGS_HASH =
  "0xd8985cd6554daab2848a8df4d90f9d5e0d81f15d062ee04bcd8414f292ccaf43" as Hex;

function runtimeTemplate(
  sources: readonly PlatformFeeRuntimeImmutableSourceV2[],
) {
  const normalizedRuntimeBytecode =
    `0x60${"00".repeat(sources.length * 32)}01` as Hex;
  return {
    normalizedRuntimeBytecode,
    normalizedRuntimeCodeHash: keccak256(normalizedRuntimeBytecode),
    immutableBindings: sources.map((source, index) => ({
      source,
      references: [{ start: 1 + index * 32, length: 32 }],
    })),
  };
}

function candidateBuild() {
  return {
    schemaVersion: "programmable.platform-fee-profile-build.v2",
    status: "active",
    profileBuildId: `sha256:${"10".repeat(32)}`,
    sourceBundleDigest: `sha256:${"20".repeat(32)}`,
    compilerArtifactDigest: `sha256:${"30".repeat(32)}`,
    compilerSettingsHash: COMPILER_SETTINGS_HASH,
    profile: "zero-custom",
    routeLauncher: {
      address: CANONICAL_PLATFORM_FEE_POLICY_V2.graphFactoryAddress,
      runtimeCodeHash:
        CANONICAL_PLATFORM_FEE_POLICY_V2.graphFactoryRuntimeCodeHash,
    },
    policy: {
      version: 2,
      chainId: 1,
      id: POLICY_ID,
      profileId: PROFILE_ID,
      basisId: BASIS_ID,
      assetModeId: ASSET_MODE_ID,
      ratePpm: CANONICAL_PLATFORM_FEE_POLICY_V2.ratePpm,
      denominatorPpm: CANONICAL_PLATFORM_FEE_POLICY_V2.denominatorPpm,
      recipient: CANONICAL_PLATFORM_FEE_POLICY_V2.recipient,
      requiredHookFlags: CANONICAL_PLATFORM_FEE_POLICY_V2.requiredHookFlags,
    },
    runtimeTemplates: {
      token: runtimeTemplate([]),
      vault: runtimeTemplate(["pool-manager", "graph-deployer"]),
      hook: runtimeTemplate([
        "pool-manager",
        "vault",
        "custom-module",
        "custom-module-runtime-code-hash",
        "custom-delta-account",
        "maximum-custom-delta-absolute",
      ]),
      initializer: runtimeTemplate([
        "graph-deployer",
        "pool-manager",
        "vault",
        "hook",
        "token",
        "pool-fee",
        "tick-spacing",
        "initial-sqrt-price-x96",
        "expected-policy-id",
      ]),
    },
  };
}

describe("platform fee policy V2 readback", () => {
  it("keeps production dark until an exact profile build is released", async () => {
    expect(PRODUCTION_PLATFORM_FEE_PROFILE_BUILDS_V2).toEqual([]);
    const snapshot = Object.freeze({
      asOfBlock: launchStampProvenance.finalizedAtBlockNumber,
      asOfBlockHash: launchStampProvenance.finalizedAtBlockHash,
      finalityConfirmations: 64,
      entries: Object.freeze([customGraphExploreEntry]),
    });

    await expect(enrichRouterCustomSnapshotWithFeePolicyV2(snapshot))
      .resolves.toBe(snapshot);
  });

  it("keeps finalized identity visible when fee-policy RPC fails", async () => {
    const entry = Object.freeze({
      ...customGraphExploreEntry,
      launchStampProvenance: Object.freeze({
        ...launchStampProvenance,
        routeLauncherAddress:
          CANONICAL_PLATFORM_FEE_POLICY_V2.graphFactoryAddress,
        routeLauncherRuntimeCodeHash:
          CANONICAL_PLATFORM_FEE_POLICY_V2.graphFactoryRuntimeCodeHash,
      }),
    });
    const snapshot = Object.freeze({
      asOfBlock: launchStampProvenance.finalizedAtBlockNumber,
      asOfBlockHash: launchStampProvenance.finalizedAtBlockHash,
      finalityConfirmations: 64,
      entries: Object.freeze([entry]),
    });
    const getChainId = vi.fn().mockRejectedValue(
      new OperationalRpcUnavailableError(),
    );
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(enrichRouterCustomSnapshotWithFeePolicyV2(snapshot, {
      profileBuilds: parsePlatformFeeProfileBuildsV2([candidateBuild()]),
      deployment: {
        chainId: 1,
        stateView: "0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227",
        stateViewRuntimeCodeHash: `0x${"70".repeat(32)}`,
      } as never,
      client: {
        getChainId,
      } as never,
    })).resolves.toBe(snapshot);
    expect(getChainId).toHaveBeenCalledOnce();
  });

  it("accepts only canonical policy constants and complete runtime templates", () => {
    expect(parsePlatformFeeProfileBuildsV2([candidateBuild()])).toHaveLength(1);

    const build = candidateBuild();
    const wrongFlags = {
      ...build,
      policy: {
        ...build.policy,
        requiredHookFlags: 0,
      },
    };
    expect(() => parsePlatformFeeProfileBuildsV2([wrongFlags])).toThrow(
      "Platform fee policy evidence",
    );

    const missingToken = candidateBuild();
    const { token: _token, ...withoutToken } = missingToken.runtimeTemplates;
    expect(() => parsePlatformFeeProfileBuildsV2([{
      ...missingToken,
      runtimeTemplates: withoutToken,
    }])).toThrow("Platform fee policy evidence");

    const corruptHook = candidateBuild();
    corruptHook.runtimeTemplates.hook.normalizedRuntimeCodeHash = ZERO_BYTES32;
    expect(() => parsePlatformFeeProfileBuildsV2([corruptHook])).toThrow(
      "Platform fee policy evidence",
    );
  });

  it("materializes every per-launch immutable into exact runtime bytes", () => {
    const [build] = parsePlatformFeeProfileBuildsV2([candidateBuild()]);
    const materialized = materializePlatformFeeRuntimeV2(
      build!.runtimeTemplates.initializer,
      {
        poolManager: launchStampProvenance.poolManagerAddress,
        graphDeployer: launchStampProvenance.routeLauncherAddress,
        vault: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        hook: STAMP_HOOK,
        token: STAMP_TOKEN,
        poolFee: 3_000n,
        tickSpacing: 60n,
        initialSqrtPriceX96: 1n << 96n,
        expectedPolicyId: build!.policy.id,
        customModule: ZERO_ADDRESS,
        customModuleRuntimeCodeHash: ZERO_BYTES32,
        customDeltaAccount: ZERO_ADDRESS,
        maximumCustomDeltaAbsolute: 0n,
      },
    );

    expect(materialized).not.toBe(
      build!.runtimeTemplates.initializer.normalizedRuntimeBytecode,
    );
    expect(keccak256(materialized)).not.toBe(
      build!.runtimeTemplates.initializer.normalizedRuntimeCodeHash,
    );
  });

  it("rejects drifted or incomplete public evidence", () => {
    expect(isPlatformFeePolicyReadbackV2(confirmedPlatformFeePolicyV2, {
      tokenAddress: STAMP_TOKEN,
      hookAddress: STAMP_HOOK,
      poolId: STAMP_POOL_ID,
    })).toBe(true);
    expect(isPlatformFeePolicyReadbackV2({
      ...confirmedPlatformFeePolicyV2,
      recipient: "0x1111111111111111111111111111111111111111",
    })).toBe(false);
    expect(isPlatformFeePolicyReadbackV2({
      ...confirmedPlatformFeePolicyV2,
      evidence: {
        ...confirmedPlatformFeePolicyV2.evidence,
        contracts: confirmedPlatformFeePolicyV2.evidence.contracts.slice(0, -1),
      },
    })).toBe(false);
  });

  it("keeps overall Custom fees unknown and grants no legacy trade capability", () => {
    const token = {
      ...customGraphToken,
      platformFeePolicy: confirmedPlatformFeePolicyV2,
    };
    const serialized = serializeIndexerToken(token, 1);

    expect(serialized.fees.status).toBe("unknown");
    expect(serialized.platformFeePolicy).toEqual(confirmedPlatformFeePolicyV2);
    expect(serialized.canonicalPool.hookAddress).toBe(STAMP_HOOK);
  });
});
