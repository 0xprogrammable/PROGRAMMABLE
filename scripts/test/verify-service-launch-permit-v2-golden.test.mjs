import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  WEBSITE_LAUNCH_PERMIT_GOLDEN_PATH,
  WEBSITE_LAUNCH_PERMIT_GOLDEN_RECEIPT_PATH,
  verifyServiceLaunchPermitV2Golden,
} from "../verify-service-launch-permit-v2-golden.mjs";

test("the website mirror is receipt-bound before its parser tests run", async () => {
  const result = await verifyServiceLaunchPermitV2Golden();
  assert.match(result.fixtureSha256, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(result.canonicalBytesCompared, false);
});

test("cross-stack verification requires exact backend fixture and receipt bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "programmable-permit-golden-"));
  const canonicalFixturePath = join(directory, "canonical.golden.json");
  const canonicalReceiptPath = join(directory, "canonical.receipt.json");
  const [fixtureBytes, receiptBytes] = await Promise.all([
    readFile(WEBSITE_LAUNCH_PERMIT_GOLDEN_PATH),
    readFile(WEBSITE_LAUNCH_PERMIT_GOLDEN_RECEIPT_PATH),
  ]);
  await Promise.all([
    writeFile(canonicalFixturePath, fixtureBytes, { flag: "wx" }),
    writeFile(canonicalReceiptPath, receiptBytes, { flag: "wx" }),
  ]);
  const result = await verifyServiceLaunchPermitV2Golden({
    canonicalFixturePath,
    canonicalReceiptPath,
  });
  assert.equal(result.canonicalBytesCompared, true);

  await writeFile(canonicalFixturePath, Buffer.concat([fixtureBytes, Buffer.from(" ")]));
  await assert.rejects(
    verifyServiceLaunchPermitV2Golden({ canonicalFixturePath, canonicalReceiptPath }),
    /not byte-identical/u,
  );
});

test("a mirror mutation cannot reuse the backend receipt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "programmable-permit-mirror-"));
  const mirrorFixturePath = join(directory, "mirror.golden.json");
  const mirrorReceiptPath = join(directory, "mirror.receipt.json");
  const [fixtureBytes, receiptBytes] = await Promise.all([
    readFile(WEBSITE_LAUNCH_PERMIT_GOLDEN_PATH),
    readFile(WEBSITE_LAUNCH_PERMIT_GOLDEN_RECEIPT_PATH),
  ]);
  const mutatedFixtureBytes = Buffer.from(
    fixtureBytes.toString("utf8").replace(
      '"validUntil":"2026-08-05T10:10:00.000Z"',
      '"validUntil":"2099-01-01T00:00:00.000Z"',
    ),
  );
  assert.notDeepEqual(mutatedFixtureBytes, fixtureBytes);
  await Promise.all([
    writeFile(mirrorFixturePath, mutatedFixtureBytes, { flag: "wx" }),
    writeFile(mirrorReceiptPath, receiptBytes, { flag: "wx" }),
  ]);
  await assert.rejects(
    verifyServiceLaunchPermitV2Golden({ mirrorFixturePath, mirrorReceiptPath }),
    /digest differs/u,
  );
});
