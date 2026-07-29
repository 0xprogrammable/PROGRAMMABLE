import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import opsV2SourceBinding from "../ops/deep-keeper-v3/ops-v2-source-binding.json";
import { computeDeepV3OpsV2SourceCommitment } from "../ops/deep-keeper-v3/source-commitment-v2.mjs";

const root = resolve(import.meta.dirname, "..");

function readJson(path: string) {
  return JSON.parse(readFileSync(resolve(root, path), "utf8")) as Record<
    string,
    unknown
  >;
}

function environment() {
  return Object.fromEntries(
    readFileSync(resolve(root, ".env.example"), "utf8")
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

describe("Deep V3 operational wiring", () => {
  it("exposes only read-only or explicitly named release commands", () => {
    const packageJson = readJson("package.json");
    const scripts = packageJson.scripts as Record<string, string>;

    expect(scripts["contracts:deep-v3:mainnet:simulate"]).toBe(
      "node contracts/scripts/simulate-deep-full-range-v3-mainnet.mjs",
    );
    expect(scripts["contracts:deep-v3:manifest:offline"]).toBe(
      "node contracts/scripts/verify-deep-full-range-release-v3-manifest.mjs --offline",
    );
    expect(scripts["contracts:deep-v3:manifest:live"]).toBe(
      "node contracts/scripts/verify-deep-full-range-release-v3-manifest.mjs --require-live",
    );
    expect(scripts["contracts:deep-v3:manifest:capture"]).not.toContain(
      "--write",
    );
    expect(
      scripts["contracts:deep-v3:manifest:capture:write"],
    ).toContain("--write");
    expect(scripts["contracts:deep-v3:keeper:test"]).toBe(
      "vitest run tests/deep-v3-keeper-*.test.ts",
    );
    expect(
      scripts["contracts:deep-v3:keeper-binding:promote"],
    ).not.toContain("--write");
    expect(
      scripts["contracts:deep-v3:keeper-binding:promote:write"],
    ).toContain("--write");
    expect(scripts["contracts:deep-v3:core:test"]).toContain(
      "FOUNDRY_PROFILE=ci forge test --match-contract",
    );
    expect(scripts["contracts:deep-v3:core:test"]).toContain(
      "LiquidityGrowthFullRangeV3StatefulInvariantTest",
    );
    expect(scripts["contracts:deep-v3:core:test"]).toContain(
      "LiquidityGrowthFullRangeV3MainnetForkTest",
    );
    expect(scripts["contracts:deep-v3:verify:offline"]).toMatch(
      /^npm run contracts:deep-v3:core:test && /,
    );
    expect(scripts["contracts:deep-v3:verify:offline"]).toContain(
      "npm run contracts:deep-v3:operator:test",
    );
  });

  it("keeps both writers disabled and documents every ops v2 binding", () => {
    const env = environment();

    expect(env.DEEP_V3_KEEPER_ENABLED).toBe("false");
    expect(env.DEEP_V3_KEEPER_SEND_TRANSACTIONS).toBe("false");
    expect(env.DEEP_V3_KEEPER_V2_ENABLED).toBe("false");
    expect(env.DEEP_V3_KEEPER_V2_SEND_TRANSACTIONS).toBe("false");
    expect(env.DEEP_V3_KEEPER_V2_CHAIN_ID).toBe("1");
    expect(env.DEEP_V3_KEEPER_V2_RELEASE_MANIFEST).toBe(
      "contracts/deployments/mainnet-deep-full-range-v3.json",
    );
    for (const key of [
      "DEEP_V3_KEEPER_V2_DEPLOYMENT_COMMIT",
      "DEEP_V3_KEEPER_V2_RPC_URLS",
      "DEEP_V3_KEEPER_V2_AUTOMATION_ADDRESS",
      "DEEP_V3_KEEPER_V2_AUTOMATION_RUNTIME_HASH",
      "DEEP_V3_KEEPER_V2_LAUNCHER_ADDRESS",
      "DEEP_V3_KEEPER_V2_LAUNCHER_RUNTIME_HASH",
      "DEEP_V3_KEEPER_V2_VAULT_FACTORY_ADDRESS",
      "DEEP_V3_KEEPER_V2_VAULT_FACTORY_RUNTIME_HASH",
      "DEEP_V3_KEEPER_V2_EXECUTOR_ADDRESS",
      "DEEP_V3_KEEPER_V2_EXECUTOR_RUNTIME_HASH",
      "DEEP_V3_KEEPER_V2_SOURCE_COMMITMENT",
      "DEEP_V3_KEEPER_V2_OPS_SOURCE_COMMITMENT",
      "DEEP_V3_KEEPER_V2_PRIVY_WALLET_ID",
      "DEEP_V3_KEEPER_V2_SIGNER_ADDRESS",
      "DEEP_V3_KEEPER_V2_MIN_GROWTH_TO_MAX_GAS_RATIO_BPS",
      "DEEP_V3_KEEPER_V2_MAX_FEE_PER_GAS_WEI",
      "DEEP_V3_KEEPER_V2_MAX_TOTAL_DEBIT_WEI_PER_TICK",
      "DEEP_V3_KEEPER_V2_MAX_TOTAL_DEBIT_WEI_PER_DAY",
      "DEEP_V3_KEEPER_V2_SIGNER_BALANCE_FLOOR_WEI",
      "OPS_BLOB_READ_WRITE_TOKEN",
    ]) {
      expect(env[key], key).toBe("");
    }
  });

  it("documents every deployment and receipt-capture input without secrets", () => {
    const env = environment();
    const requiredEmptyValues = [
      "DEEP_V3_MAINNET_DEPLOYER",
      "DEEP_V3_MAINNET_TREASURY",
      "DEEP_V3_MAINNET_START_NONCE",
      "DEEP_V3_HOOK_SALT",
      "DEEP_V3_ZAP_PLANNER_TRANSACTION",
      "DEEP_V3_GROWTH_FACTORY_TRANSACTION",
      "DEEP_V3_HOOK_FACTORY_TRANSACTION",
      "DEEP_V3_FEE_HOOK_TRANSACTION",
      "DEEP_V3_LAUNCHER_TRANSACTION",
      "DEEP_V3_KEEPER_EXECUTOR_TRANSACTION",
    ];
    for (const key of requiredEmptyValues) {
      expect(env[key], key).toBe("");
    }
    expect(
      Object.keys(env).filter(
        (key) =>
          key.startsWith("DEEP_V3_") &&
          /(PRIVATE_KEY|MNEMONIC)/.test(key),
      ),
    ).toEqual([]);
  });

  it("bundles the exact manifest and binding for the V3 ops v2 route", () => {
    const route = readFileSync(
      resolve(root, "app/api/ops/deep-v3-keeper-v2/route.ts"),
      "utf8",
    );
    expect(route).toContain(
      'import deepV3ReleaseManifest from "../../../../contracts/deployments/mainnet-deep-full-range-v3.json";',
    );
    expect(route).toContain(
      'import reviewedOpsV2Binding from "../../../../ops/deep-keeper-v3/reviewed-ops-v2-binding.json";',
    );
    expect(route).toContain(
      'import opsV2SourceBinding from "../../../../ops/deep-keeper-v3/ops-v2-source-binding.json";',
    );
    expect(route).not.toContain('from "node:fs');
    expect(route).not.toContain("process.cwd()");
    expect(opsV2SourceBinding.opsSourceCommitment).toBe(
      computeDeepV3OpsV2SourceCommitment(root),
    );
  });

  it("schedules only ops v2 every five minutes", () => {
    const config = readJson("vercel.json");
    const crons = config.crons as {
      path: string;
      schedule: string;
    }[];
    expect(
      crons.filter(
        (entry) => entry.path === "/api/ops/deep-v3-keeper-v2",
      ),
    ).toEqual([
      {
        path: "/api/ops/deep-v3-keeper-v2",
        schedule: "*/5 * * * *",
      },
    ]);
    expect(
      crons.filter((entry) =>
        [
          "/api/ops/deep-keeper",
          "/api/ops/deep-v2-keeper",
          "/api/ops/deep-v3-keeper",
        ].includes(entry.path),
      ),
    ).toEqual([]);
  });
});
