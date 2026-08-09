import "server-only";

export type ManualRouterFinalityPolicyV1 =
  | Readonly<{ status: "disabled" }>
  | Readonly<{
      status: "enabled";
      maximumCandidates: 40;
      concurrency: 4;
    }>;

export function resolveManualRouterFinalityPolicyV1(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ManualRouterFinalityPolicyV1 {
  if (
    env.PROGRAMMABLE_MANUAL_APPLICANT_LAUNCH_ENABLED === undefined
    || env.PROGRAMMABLE_MANUAL_APPLICANT_LAUNCH_ENABLED === "false"
  ) return Object.freeze({ status: "disabled" });
  if (env.PROGRAMMABLE_MANUAL_APPLICANT_LAUNCH_ENABLED !== "true") {
    throw invalidRuntimeConfig(
      "PROGRAMMABLE_MANUAL_APPLICANT_LAUNCH_ENABLED must be true or false",
    );
  }
  return Object.freeze({
    status: "enabled",
    maximumCandidates: 40,
    concurrency: 4,
  });
}

function invalidRuntimeConfig(message: string): TypeError {
  return new TypeError(`manual Router finality invalidRuntimeConfig: ${message}`);
}
