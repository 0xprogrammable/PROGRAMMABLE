import type { Address, Hex } from "viem";

import {
  isLaunchStampProvenanceV1,
  type LaunchStampProvenanceV1,
} from "../tokens";

export const FADE_ROUTER_CUSTOM_CREATOR_CLAIM_ADAPTER_ID =
  "router-custom-fade-decay-fee-v1" as const;

export type RouterCustomCreatorClaimCapabilityV1 = Readonly<{
  adapterId: typeof FADE_ROUTER_CUSTOM_CREATOR_CLAIM_ADAPTER_ID;
  chainId: 1;
  launchId: Hex;
  tokenAddress: Address;
  tokenRuntimeCodeHash: Hex;
  hookAddress: Address;
  hookRuntimeCodeHash: Hex;
  poolId: Hex;
  creatorAddress: Address;
  registrarAddress: Address;
  registrarRuntimeCodeHash: Hex;
  routeLauncherAddress: Address;
  routeLauncherRuntimeCodeHash: Hex;
  launchTimestamp: bigint;
  claimSelector: "0xaf8d60b5";
}>;

/**
 * A code-owned capability for one reviewed Custom hook runtime. Router stamps
 * remain discovery-only unless every field below and the live state reader
 * agree. Adding another Custom claim model requires a separate adapter.
 */
export const FADE_ROUTER_CUSTOM_CREATOR_CLAIM_CAPABILITY = Object.freeze({
  adapterId: FADE_ROUTER_CUSTOM_CREATOR_CLAIM_ADAPTER_ID,
  chainId: 1,
  launchId:
    "0x6d6ed0e1e69a7cd6afa177e3454c9e32eed61cbd3f855ee56aff1915a6776fc2",
  tokenAddress: "0x69d278968abf120f878f2e1e016ab615d3686c19",
  tokenRuntimeCodeHash:
    "0xe48c3827d558866b3d761d78b7d29416f24d277120ef1a7ce6a360962b917596",
  hookAddress: "0xd7451a039373f54e493deE42A751fEcBfAFBa0cc",
  hookRuntimeCodeHash:
    "0xff70a4d3d889b730a064b270fc187f0cba40582f1fa6f5875893066b17a1257b",
  poolId:
    "0x6b6f0f8348bb08c7cbaa45cd48b4531e3a206ac7eabcc5355d9ffdd21c4b579a",
  creatorAddress: "0x2Bb333d48DFAF1596D9036671d2E43168994249E",
  registrarAddress: "0x5c5B5342696b197A21564ecDDB97915933eF6C9B",
  registrarRuntimeCodeHash:
    "0x9a924353c9d1c0302a190a1e930b02cfddf3e9ccbc9cc441eb5f7f62c39df78e",
  routeLauncherAddress: "0xB012e4A8F2c5FC4E8E4faCA9D5Ad6FfF13FBA887",
  routeLauncherRuntimeCodeHash:
    "0xd23692fae59331592048e71a96d4963e170ee56e449683dc9f7fa3f9470018b8",
  launchTimestamp: 1_787_599_787n,
  claimSelector: "0xaf8d60b5",
} as const satisfies RouterCustomCreatorClaimCapabilityV1);

const CAPABILITIES = Object.freeze([
  FADE_ROUTER_CUSTOM_CREATOR_CLAIM_CAPABILITY,
] as const);

type RouterCustomClaimTokenIdentityV1 = Readonly<{
  tokenAddress: Address;
  hookAddress: Address;
  poolId: Hex;
  creatorAddress?: Address;
  totalSwapFeeBps?: number | null;
  launchModel?: string;
  launchModelVersion?: string;
  launchStampProvenance?: LaunchStampProvenanceV1;
}>;

function sameHex(left: unknown, right: unknown) {
  return typeof left === "string" &&
    typeof right === "string" &&
    left.toLowerCase() === right.toLowerCase();
}

function capabilityKey(chainId: number, launchId: string) {
  return `${chainId}:${launchId.toLowerCase()}`;
}

const CAPABILITY_BY_LAUNCH = new Map(
  CAPABILITIES.map((capability) => [
    capabilityKey(capability.chainId, capability.launchId),
    capability,
  ]),
);

function exactExclusiveComponent(
  stamp: LaunchStampProvenanceV1,
  expected: Readonly<{
    address: Address;
    kind: "token" | "hook" | "other";
    runtimeCodeHash: Hex;
  }>,
) {
  return stamp.components.some((component) =>
    component.kind === expected.kind &&
    component.scope === "exclusive" &&
    sameHex(component.address, expected.address) &&
    sameHex(component.runtimeCodeHash, expected.runtimeCodeHash) &&
    component.exclusiveProof !== null &&
    sameHex(component.exclusiveProof.launchId, stamp.launchId) &&
    sameHex(component.exclusiveProof.stampHash, stamp.stampHash)
  );
}

export function routerCustomCreatorClaimCapabilityForPoolV1(
  chainId: number,
  poolId: string,
) {
  return CAPABILITIES.find((capability) =>
    capability.chainId === chainId && sameHex(capability.poolId, poolId)
  ) ?? null;
}

export function resolveRouterCustomCreatorClaimCapabilityV1(
  token: RouterCustomClaimTokenIdentityV1,
): RouterCustomCreatorClaimCapabilityV1 | null {
  const stamp = token.launchStampProvenance;
  if (!stamp) return null;
  const capability = CAPABILITY_BY_LAUNCH.get(
    capabilityKey(stamp.chainId, stamp.launchId),
  );
  if (!capability) return null;

  if (
    token.launchModel !== "custom-graph" ||
    token.launchModelVersion !== "programmable-launch-stamp-router-v1" ||
    token.totalSwapFeeBps !== null ||
    !token.creatorAddress ||
    stamp.kind !== "custom-graph" ||
    !isLaunchStampProvenanceV1(stamp, {
      chainId: capability.chainId,
      tokenAddress: capability.tokenAddress,
      hookAddress: capability.hookAddress,
      poolId: capability.poolId,
      launchWallet: capability.creatorAddress,
    }) ||
    !sameHex(token.tokenAddress, capability.tokenAddress) ||
    !sameHex(token.hookAddress, capability.hookAddress) ||
    !sameHex(token.poolId, capability.poolId) ||
    !sameHex(token.creatorAddress, capability.creatorAddress) ||
    !sameHex(stamp.launchId, capability.launchId) ||
    !sameHex(stamp.routeLauncherAddress, capability.routeLauncherAddress) ||
    !sameHex(
      stamp.routeLauncherRuntimeCodeHash,
      capability.routeLauncherRuntimeCodeHash,
    ) ||
    !sameHex(stamp.poolKey.currency0, "0x0000000000000000000000000000000000000000") ||
    !sameHex(stamp.poolKey.currency1, capability.tokenAddress) ||
    !exactExclusiveComponent(stamp, {
      address: capability.tokenAddress,
      kind: "token",
      runtimeCodeHash: capability.tokenRuntimeCodeHash,
    }) ||
    !exactExclusiveComponent(stamp, {
      address: capability.hookAddress,
      kind: "hook",
      runtimeCodeHash: capability.hookRuntimeCodeHash,
    }) ||
    !exactExclusiveComponent(stamp, {
      address: capability.registrarAddress,
      kind: "other",
      runtimeCodeHash: capability.registrarRuntimeCodeHash,
    })
  ) {
    return null;
  }

  return capability;
}

export type RouterCustomCreatorClaimProfileCapabilityV1 = Readonly<{
  adapterId: typeof FADE_ROUTER_CUSTOM_CREATOR_CLAIM_ADAPTER_ID;
  chainId: 1;
  launchId: Hex;
  tokenAddress: Address;
  hookAddress: Address;
  poolId: Hex;
}>;

export function routerCustomCreatorClaimProfileCapabilityV1(
  capability: RouterCustomCreatorClaimCapabilityV1,
): RouterCustomCreatorClaimProfileCapabilityV1 {
  return Object.freeze({
    adapterId: capability.adapterId,
    chainId: capability.chainId,
    launchId: capability.launchId,
    tokenAddress: capability.tokenAddress,
    hookAddress: capability.hookAddress,
    poolId: capability.poolId,
  });
}
