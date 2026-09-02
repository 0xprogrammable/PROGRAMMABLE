import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";

import {
  assertProductionV4Capabilities,
  createPackConfigFromCapabilities,
} from "../examples/robinhood-v4-no-broadcast/project/config-from-capabilities.mjs";
import { assertExactProjectImageV4 } from
  "../examples/robinhood-v4-no-broadcast/project/image-precheck.mjs";
import { decodeExactProjectImageV4 } from "../src/image-validation-v4.mjs";
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

test("Robinhood V4 example image precheck has exact decoder parity including GIF87a", async () => {
  const validatorUrl = new URL("../src/image-validation-v4.mjs", import.meta.url).href;
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  const gif87a = Buffer.from(
    "47494638376101000100800000000000ffffff2c00000000010001000002024401003b",
    "hex",
  );
  const gif89a = Buffer.from(gif87a);
  gif89a.write("GIF89a", 0, "ascii");
  for (const bytes of [png, gif87a, gif89a]) {
    assert.deepEqual(
      await assertExactProjectImageV4(bytes, validatorUrl),
      decodeExactProjectImageV4(bytes),
    );
  }

  const secondFrame = Buffer.from("2c0000000001000100000202440100", "hex");
  const gifDataLengthOffset = gif87a.indexOf(Buffer.from("02440100", "hex"));
  const gifWithBytesAfterEndCode = Buffer.concat([
    gif87a.subarray(0, gifDataLengthOffset),
    Buffer.from("0644014142434400", "hex"),
    gif87a.subarray(gifDataLengthOffset + 4),
  ]);
  const pngWithBytesAfterZlib = appendBytesToPngIdat(png, Buffer.from("HIDE", "ascii"));
  const adversarial = [
    Buffer.from("ffd8ffe000104a46494600010100000100010000ffd9", "hex"),
    Buffer.from("524946461600000057454250565038580a0000000000000000000000000000", "hex"),
    Buffer.from("GIF87a", "ascii"),
    Buffer.concat([gif87a, Buffer.from([0])]),
    Buffer.concat([gif87a.subarray(0, -1), secondFrame, Buffer.from([0x3b])]),
    gifWithBytesAfterEndCode,
    pngWithBytesAfterZlib,
  ];
  for (const bytes of adversarial) {
    assert.throws(() => decodeExactProjectImageV4(bytes), /image|GIF|V4|PNG/u);
    await assert.rejects(
      assertExactProjectImageV4(bytes, validatorUrl),
      /image|GIF|V4|PNG/u,
    );
  }
});

function appendBytesToPngIdat(png, suffix) {
  const type = Buffer.from("IDAT", "ascii");
  const typeOffset = png.indexOf(type);
  assert.ok(typeOffset >= 4);
  const lengthOffset = typeOffset - 4;
  const length = png.readUInt32BE(lengthOffset);
  const dataStart = typeOffset + 4;
  const dataEnd = dataStart + length;
  const data = Buffer.concat([png.subarray(dataStart, dataEnd), suffix]);
  const chunk = Buffer.alloc(12 + data.byteLength);
  chunk.writeUInt32BE(data.byteLength, 0);
  type.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.byteLength)), 8 + data.byteLength);
  return Buffer.concat([
    png.subarray(0, lengthOffset),
    chunk,
    png.subarray(dataEnd + 4),
  ]);
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 0 ? value >>> 1 : 0xedb88320 ^ (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

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
  assert.match(source, /assertExactProjectImageV4/u);
  assert.doesNotMatch(source, /PNG, JPEG, WebP, or GIF/u);
  const readme = await readFile(
    new URL("../examples/robinhood-v4-no-broadcast/README.md", import.meta.url),
    "utf8",
  );
  assert.match(readme, /never embeds planned Programmable deployment\s+addresses/u);
  assert.match(readme, /Package version `4\.0\.0` is an\s+unreleased source candidate/u);
  assert.match(readme, /not a published or publicly installable release/u);
  assert.match(readme, /release binding remains\s+`releaseReady: false`/u);
  assert.match(readme, /ROBINHOOD_V4_CANONICAL_FEE_PROFILE_UNAVAILABLE/u);
  assert.match(readme, /does not produce\s+`launch\.json`/u);
  assert.match(
    readme,
    /no environment variable, API response, pack config or client-supplied\s+graph can open the gate/iu,
  );
  assert.doesNotMatch(readme, /verified `@programmable\/launch` 4\.0\.0 release artifact/u);
  assert.doesNotMatch(
    readme,
    /releases\/download\/programmable-launch-v4\.0\.0/u,
  );
});
