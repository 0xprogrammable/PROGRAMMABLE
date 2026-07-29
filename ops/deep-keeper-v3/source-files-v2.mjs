export const DEEP_V3_OPS_V2_SOURCE_PATHS = Object.freeze([
  "app/api/ops/deep-v3-keeper-v2/handler.ts",
  "app/api/ops/deep-v3-keeper-v2/health/handler.ts",
  "app/api/ops/deep-v3-keeper-v2/health/route.ts",
  "app/api/ops/deep-v3-keeper-v2/route.ts",
  "app/api/ops/deep-v3-keeper-v2/storage.ts",
  "next.config.ts",
  "ops/deep-keeper-v3/config-v2.mjs",
  "ops/deep-keeper-v3/control-v2.mjs",
  "ops/deep-keeper-v3/core-v2.mjs",
  "ops/deep-keeper-v3/privy-wallet-v2.mjs",
  "ops/deep-keeper-v3/release-gate-v2.mjs",
  "ops/deep-keeper-v3/source-commitment-v2.mjs",
  "ops/deep-keeper-v3/source-files-v2.mjs",
  "ops/deep-keeper-v3/verify-ops-v2-source-binding.mjs",
]);

export const DEEP_V3_OPS_V2_PROJECTION_INPUT_PATHS = Object.freeze([
  "package-lock.json",
  "package.json",
  "vercel.json",
]);

export const DEEP_V3_OPS_V2_RUNTIME_DEPENDENCIES = Object.freeze([
  "@privy-io/node",
  "@vercel/blob",
  "next",
  "server-only",
  "viem",
]);

export const DEEP_V3_OPS_V2_SCRIPT_POLICY = Object.freeze({
  build: "next build",
  "contracts:deep-v3:keeper-binding:promote":
    "node contracts/scripts/promote-deep-v3-ops-v2-binding.mjs",
  "contracts:deep-v3:keeper-binding:promote:write":
    "node contracts/scripts/promote-deep-v3-ops-v2-binding.mjs --write",
  "contracts:deep-v3:keeper:test":
    "vitest run tests/deep-v3-keeper-*.test.ts",
  "contracts:deep-v3:verify:offline":
    "npm run contracts:deep-v3:core:test && npm run contracts:deep-v3:deployer:test && npm run contracts:deep-v3:release:test && npm run contracts:deep-v3:manifest:offline && npm run contracts:deep-v3:operator:test && npm run contracts:deep-v3:keeper:test",
  prebuild:
    "node ops/deep-keeper-v3/verify-ops-v2-source-binding.mjs",
});

export const DEEP_V3_OPS_V2_CRON_POLICY = Object.freeze({
  path: "/api/ops/deep-v3-keeper-v2",
  schedule: "*/5 * * * *",
});

export const DEEP_V3_OPS_V2_FORBIDDEN_CRON_PATHS = Object.freeze([
  "/api/ops/deep-keeper",
  "/api/ops/deep-v2-keeper",
  "/api/ops/deep-v3-keeper",
]);
