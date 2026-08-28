import {
  isPlatformFeePolicyReadbackV2,
  type LauncherToken,
} from "./tokens";

export type PlatformFeeCertificationV1 = Readonly<{
  schemaVersion: "programmable.platform-fee-certification.v1";
  status: "certified" | "not-certified";
  programmableFeeBps: 10 | null;
  label:
    | "Programmable fee: 10 bps certified for this launch"
    | "Programmable fee: not certified for this launch";
}>;

const CERTIFIED_PLATFORM_FEE = Object.freeze({
  schemaVersion: "programmable.platform-fee-certification.v1" as const,
  status: "certified" as const,
  programmableFeeBps: 10 as const,
  label: "Programmable fee: 10 bps certified for this launch" as const,
});

const UNCERTIFIED_PLATFORM_FEE = Object.freeze({
  schemaVersion: "programmable.platform-fee-certification.v1" as const,
  status: "not-certified" as const,
  programmableFeeBps: null,
  label: "Programmable fee: not certified for this launch" as const,
});

export function platformFeeCertificationForTokenV1(
  token: LauncherToken,
): PlatformFeeCertificationV1 | null {
  if (
    token.launchModel !== "custom-graph" ||
    token.launchStampProvenance?.kind !== "custom-graph"
  ) {
    return null;
  }

  return isPlatformFeePolicyReadbackV2(token.platformFeePolicy, {
    tokenAddress: token.tokenAddress,
    hookAddress: token.hookAddress,
    poolId: token.poolId,
  })
    ? CERTIFIED_PLATFORM_FEE
    : UNCERTIFIED_PLATFORM_FEE;
}

export function parsePlatformFeeCertificationV1(
  value: unknown,
): PlatformFeeCertificationV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== "programmable.platform-fee-certification.v1"
  ) {
    return null;
  }

  if (
    record.status === "certified" &&
    record.programmableFeeBps === 10 &&
    record.label === "Programmable fee: 10 bps certified for this launch"
  ) {
    return CERTIFIED_PLATFORM_FEE;
  }

  if (
    record.status === "not-certified" &&
    record.programmableFeeBps === null &&
    record.label === "Programmable fee: not certified for this launch"
  ) {
    return UNCERTIFIED_PLATFORM_FEE;
  }

  return null;
}
