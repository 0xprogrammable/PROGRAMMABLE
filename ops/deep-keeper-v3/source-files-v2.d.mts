export const DEEP_V3_OPS_V2_SOURCE_PATHS: readonly string[];
export const DEEP_V3_OPS_V2_PROJECTION_INPUT_PATHS: readonly string[];
export const DEEP_V3_OPS_V2_RUNTIME_DEPENDENCIES: readonly string[];
export const DEEP_V3_OPS_V2_SCRIPT_POLICY: Readonly<
  Record<string, string>
>;
export const DEEP_V3_OPS_V2_CRON_POLICY: Readonly<{
  path: string;
  schedule: string;
}>;
export const DEEP_V3_OPS_V2_FORBIDDEN_CRON_PATHS: readonly string[];
