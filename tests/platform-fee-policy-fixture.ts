import type { PlatformFeePolicyReadbackV2 } from "../lib/tokens";

import {
  STAMP_HOOK,
  STAMP_POOL_ID,
  launchStampProvenance,
} from "./launch-stamp-surface-fixture";

export const confirmedPlatformFeePolicyV2 = {
  schemaVersion: "programmable.platform-fee-policy-readback.v2",
  status: "onchain-confirmed",
  chainId: "1",
  profileBuildId: `sha256:${"10".repeat(32)}`,
  sourceBundleDigest: `sha256:${"20".repeat(32)}`,
  compilerArtifactDigest: `sha256:${"30".repeat(32)}`,
  compilerSettingsHash: `0x${"31".repeat(32)}`,
  profile: "zero-custom",
  policyVersion: 2,
  policyId: `0x${"40".repeat(32)}`,
  profileId: `0x${"50".repeat(32)}`,
  basis: {
    id: `0x${"b1".repeat(32)}`,
    kind: "gross-unspecified-pool-currency-amount",
  },
  assetMode: {
    id: `0x${"b2".repeat(32)}`,
    kind: "unspecified-pool-currency-per-swap",
  },
  ratePpm: 1000,
  denominatorPpm: 1_000_000,
  recipient: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
  requiredHookFlags: 0x2044,
  poolId: STAMP_POOL_ID,
  initialSqrtPriceX96: "79228162514264337593543950336",
  initializer: "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB",
  deploymentProfileHash: `0x${"51".repeat(32)}`,
  compositionHash: `0x${"52".repeat(32)}`,
  customModule: null,
  customModuleRuntimeCodeHash: null,
  customDeltaAccount: null,
  maximumCustomDeltaAbsolute: "0",
  evidence: {
    source: "ethereum-mainnet-finalized-state",
    blockNumber: launchStampProvenance.finalizedAtBlockNumber,
    blockHash: launchStampProvenance.finalizedAtBlockHash,
    finalityConfirmations: 64,
    contracts: [
      {
        role: "router",
        address: launchStampProvenance.routerAddress,
        runtimeCodeHash: launchStampProvenance.routerRuntimeCodeHash,
      },
      {
        role: "route-launcher",
        address: launchStampProvenance.routeLauncherAddress,
        runtimeCodeHash: launchStampProvenance.routeLauncherRuntimeCodeHash,
      },
      {
        role: "pool-manager",
        address: launchStampProvenance.poolManagerAddress,
        runtimeCodeHash: `0x${"60".repeat(32)}`,
      },
      {
        role: "state-view",
        address: "0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227",
        runtimeCodeHash: `0x${"70".repeat(32)}`,
      },
      {
        role: "token",
        address: launchStampProvenance.tokenProof.tokenAddress,
        runtimeCodeHash: launchStampProvenance.components[0]!.runtimeCodeHash,
      },
      {
        role: "hook",
        address: STAMP_HOOK,
        runtimeCodeHash: `0x${"80".repeat(32)}`,
      },
      {
        role: "vault",
        address: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        runtimeCodeHash: `0x${"90".repeat(32)}`,
      },
      {
        role: "initializer",
        address: "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB",
        runtimeCodeHash: `0x${"a0".repeat(32)}`,
      },
    ],
  },
} as const satisfies PlatformFeePolicyReadbackV2;
