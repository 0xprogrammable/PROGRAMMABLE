import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";

import {
  assertProductionV4Capabilities,
  createPackConfigFromCapabilities,
} from "../examples/robinhood-v4-no-broadcast/project/config-from-capabilities.mjs";
import { validV4Capabilities } from "./fixtures/v4.mjs";

const schema = JSON.parse(await readFile(
  new URL("../schemas/programmable-launch-pack-config-v4.json", import.meta.url),
  "utf8",
));
const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  strictRequired: false,
  validateFormats: false,
});
for (const keyword of [
  "x-programmable-status",
  "x-programmable-contract",
  "x-programmable-order",
  "x-programmable-aggregateCalldataAndHookDataMaximumBytes",
  "x-programmable-maximumBytes",
]) ajv.addKeyword(keyword);
ajv.addKeyword({
  keyword: "x-programmable-minUtf8Bytes",
  type: "string",
  schemaType: "number",
  validate: (minimum, value) => Buffer.byteLength(value, "utf8") >= minimum,
});
ajv.addKeyword({
  keyword: "x-programmable-minUnicodeLettersOrNumbers",
  type: "string",
  schemaType: "number",
  validate: (minimum, value) => [...value.matchAll(/[\p{L}\p{N}]/gu)].length >= minimum,
});
const validate = ajv.compile(schema);

test("Robinhood V4 example materializes a schema-valid funding-none config from capabilities", () => {
  const capabilities = validV4Capabilities();
  const config = createPackConfigFromCapabilities({
    capabilities,
    launchWallet: "0x1111111111111111111111111111111111111111",
    nonce: `0x${"22".repeat(32)}`,
    permitWindow: { validAfter: "1", deadline: "2" },
    sourceRevision: "33".repeat(20),
    sourceOrigin: "https://github.com/programmablehq/PROGRAMMABLE",
    tokenSupply: "1000000000000000000000000",
    projectMetadata: {
      schemaVersion: "programmable.project-metadata-input.v1",
      token: { name: "Robinhood Clean Room", symbol: "RHCR" },
      presentation: {
        description: "Capability-bound Robinhood V4 clean-room schema verification fixture",
        image: {
          sourcePath: "assets/project-logo.png",
          uri: "https://example.com/project-logo.png",
        },
        links: [
          { kind: "website", uri: "https://example.com/" },
          { kind: "x", uri: "https://x.com/example_project" },
        ],
      },
    },
    checkedAt: "2026-08-29T12:00:00.000Z",
  });

  assert.equal(validate(config), true, JSON.stringify(validate.errors));
  assert.equal(config.funding.mode, "none");
  assert.equal(config.funding.valueWei, "0");
  assert.equal(config.targets.length, 3);
  assert.equal(config.profile.profileRevision, 1);
  assert.equal(config.chainDeployment,
    capabilities.chainDeployment,
    "the example must copy the authenticated machine-contract object, not invent roots");
  assertProductionV4Capabilities(capabilities);
});

test("Robinhood V4 example fails closed on an unavailable trust root or profile revision", () => {
  const missingRoot = structuredClone(validV4Capabilities());
  delete missingRoot.chainDeployment.contracts.programmableLaunchStampRouter;
  assert.throws(() => assertProductionV4Capabilities(missingRoot), /trust-root set/u);

  const profileDrift = structuredClone(validV4Capabilities());
  profileDrift.profile.profileRevision = 2;
  assert.throws(() => assertProductionV4Capabilities(profileDrift), /production V4 contract/u);
});

test("public V4 example source contains no fabricated nonzero deployment address", async () => {
  const files = [
    "../examples/robinhood-v4-no-broadcast/project/build-and-configure.mjs",
    "../examples/robinhood-v4-no-broadcast/project/config-from-capabilities.mjs",
  ];
  const source = (await Promise.all(files.map((file) => readFile(
    new URL(file, import.meta.url),
    "utf8",
  )))).join("\n");
  assert.doesNotMatch(source, /0x(?!0{40}(?:[^0-9a-fA-F]|$))[0-9a-fA-F]{40}/u);
  assert.match(source, /refuses PROGRAMMABLE_API_KEY/u);
  assert.match(source, /walletSignatureProduced/u);
  assert.match(source, /transactionBroadcast/u);
  const readme = await readFile(
    new URL("../examples/robinhood-v4-no-broadcast/README.md", import.meta.url),
    "utf8",
  );
  assert.match(readme, /never embeds planned Programmable deployment\s+addresses/u);
});
