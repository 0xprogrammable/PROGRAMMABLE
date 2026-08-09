import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

import {
  assertManualApplicantServerEnvironment,
  readManualApplicantLaunchFlag,
  resolveManualApplicantLaunchPolicy,
} from "../resolve-manual-applicant-launch-policy.mjs";

const enabledEnvironment = [
  "PROGRAMMABLE_MANUAL_APPLICANT_LAUNCH_ENABLED=true",
  "PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/key",
  "PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL=https://example.quiknode.pro/key",
  "NEXT_PUBLIC_PRIVY_APP_ID=privy-app",
  "PRIVY_APP_SECRET=privy-secret",
  "OPS_BLOB_READ_WRITE_TOKEN=blob-token",
  `CRON_SECRET=${"c".repeat(32)}`,
  "",
].join("\n");

test("manual Applicant flag is default-off and exact", () => {
  assert.equal(readManualApplicantLaunchFlag(""), false);
  assert.equal(readManualApplicantLaunchFlag(
    "PROGRAMMABLE_MANUAL_APPLICANT_LAUNCH_ENABLED=true\n",
  ), true);
  assert.throws(() => readManualApplicantLaunchFlag(
    "PROGRAMMABLE_MANUAL_APPLICANT_LAUNCH_ENABLED=${ENABLE}\n",
  ));
  assert.throws(() => readManualApplicantLaunchFlag([
    "PROGRAMMABLE_MANUAL_APPLICANT_LAUNCH_ENABLED=true",
    "PROGRAMMABLE_MANUAL_APPLICANT_LAUNCH_ENABLED=true",
  ].join("\n")));
});

test("manual Applicant policy requires dispatch, Vercel and protected mode parity", () => {
  const source = enabledEnvironment;
  assert.deepEqual(resolveManualApplicantLaunchPolicy({
    requested: true,
    productionEnvSource: source,
    protectedMode: "enabled",
  }), { enabled: true });
  assert.throws(() => resolveManualApplicantLaunchPolicy({
    requested: false,
    productionEnvSource: source,
    protectedMode: "enabled",
  }), /dispatch request/u);
  assert.throws(() => resolveManualApplicantLaunchPolicy({
    requested: true,
    productionEnvSource: source,
    protectedMode: "disabled",
  }), /protected mode/u);
});

test("enabled policy binds only the strict server environment contract", () => {
  assert.deepEqual(
    Object.keys(assertManualApplicantServerEnvironment(enabledEnvironment)).sort(),
    [
      "CRON_SECRET",
      "NEXT_PUBLIC_PRIVY_APP_ID",
      "OPS_BLOB_READ_WRITE_TOKEN",
      "PRIVY_APP_SECRET",
      "PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL",
      "PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL",
    ].sort(),
  );
  assert.throws(() => assertManualApplicantServerEnvironment(
    enabledEnvironment.replace(/^PRIVY_APP_SECRET=.*\n/mu, ""),
  ), /PRIVY_APP_SECRET/u);
  assert.throws(() => assertManualApplicantServerEnvironment(
    enabledEnvironment.replace(
      "https://eth-mainnet.g.alchemy.com/v2/key",
      "https://example.quiknode.pro/key",
    ),
  ), /strict provider/u);
  assert.throws(() => assertManualApplicantServerEnvironment([
    "ETHEREUM_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/key",
    "ETHEREUM_RPC_URL_B=https://example.quiknode.pro/key",
    "NEXT_PUBLIC_PRIVY_APP_ID=privy-app",
    "PRIVY_APP_SECRET=privy-secret",
    "OPS_BLOB_READ_WRITE_TOKEN=blob-token",
    `CRON_SECRET=${"c".repeat(32)}`,
  ].join("\n")), /PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL/u);

  const invalidAlchemy = [
    "http://eth-mainnet.g.alchemy.com/v2/key",
    "https://foo.alchemy.com/v2/key",
    "https://eth-mainnet.g.alchemy.com/",
    "https://eth-mainnet.g.alchemy.com:8443/v2/key",
    "https://user@eth-mainnet.g.alchemy.com/v2/key",
    "https://eth-mainnet.g.alchemy.com/v2/key?query=true",
    " https://eth-mainnet.g.alchemy.com/v2/key",
    `https://eth-mainnet.g.alchemy.com/${"x".repeat(2_049)}`,
  ];
  for (const value of invalidAlchemy) {
    assert.throws(() => assertManualApplicantServerEnvironment(
      replaceEnvironmentValue(
        enabledEnvironment,
        "PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL",
        value,
      ),
    ));
  }

  const invalidQuickNode = [
    "https://quiknode.pro/key",
    "https://example.quicknode.com/key",
    "https://example.quiknode.pro/",
    "https://example.quiknode.pro:8443/key",
    "https://user:pass@example.quiknode.pro/key",
    "https://example.quiknode.pro/key#fragment",
    "https://example.quiknode.pro/key ",
  ];
  for (const value of invalidQuickNode) {
    assert.throws(() => assertManualApplicantServerEnvironment(
      replaceEnvironmentValue(
        enabledEnvironment,
        "PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL",
        value,
      ),
    ));
  }
});

test("production workflow keeps manual Applicant policy independent of legacy Custom", async () => {
  const workflow = await readFile(
    new URL("../../.github/workflows/deploy-production.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /manual_applicant_launch_enablement:/u);
  assert.match(workflow, /Resolve manual Applicant launch policy/u);
  assert.match(workflow, /PROGRAMMABLE_MANUAL_APPLICANT_LAUNCH_MODE/u);
  assert.match(workflow, /resolve-manual-applicant-launch-policy\.mjs/u);
});

function replaceEnvironmentValue(source, name, value) {
  return source.replace(
    new RegExp(`^${name}=.*$`, "mu"),
    `${name}=${value}`,
  );
}
