import test from "node:test";
import assert from "node:assert/strict";
import {
  CLAIMS,
  SELECTORS,
  TREASURY,
  decodeAddress,
  decodeUint256,
  claimData,
  encodeAddressArgument,
  formatEth,
  formatUnits,
  isTreasury,
  shortAddress,
  readAccruedData,
  toQuantityHex,
} from "./logic.mjs";

test("binds native ETH and stock-asset fee claims", () => {
  assert.equal(CLAIMS.filter(({ kind }) => kind === "native").length, 4);
  assert.equal(CLAIMS.filter(({ kind }) => kind === "asset").length, 18);
  assert.ok(CLAIMS.every(({ address }) => /^0x[0-9a-fA-F]{40}$/.test(address)));
});

test("uses the audited claim and read selectors", () => {
  assert.deepEqual(SELECTORS, {
    launcherFeesAccrued: "0x1497233e",
    launcherAssetFeesAccrued: "0x31b8ca96",
    launcherFeeRecipient: "0x4c50e2c4",
    claimLauncherFees: "0x64d46b85",
    claimLauncherAssetFees: "0xaee8cd6f",
  });
});

test("checks the immutable treasury without checksum assumptions", () => {
  assert.equal(isTreasury(TREASURY.toLowerCase()), true);
  assert.equal(isTreasury("0x0000000000000000000000000000000000000000"), false);
});

test("decodes ABI words", () => {
  const addressWord = `0x${"0".repeat(24)}${TREASURY.slice(2).toLowerCase()}`;
  assert.equal(decodeAddress(addressWord).toLowerCase(), TREASURY.toLowerCase());
  assert.equal(decodeUint256("0x0de0b6b3a7640000"), 1_000_000_000_000_000_000n);
});

test("formats ETH and RPC quantities", () => {
  assert.equal(formatEth(1_408_228_182_792_482_473n), "1.408228");
  assert.equal(formatEth(1_000_000_000_000_000_000n), "1");
  assert.equal(formatUnits(199_592_153_522_990_767n, 18), "0.199592");
  assert.equal(toQuantityHex(21_000n), "0x5208");
  assert.equal(shortAddress(TREASURY), "0x4957…376c");
});

test("encodes stock-asset reads and claims", () => {
  const stockClaim = CLAIMS.find(({ kind }) => kind === "asset");
  assert.ok(stockClaim);
  const argument = encodeAddressArgument(stockClaim.asset);
  assert.equal(argument.length, 64);
  assert.equal(readAccruedData(stockClaim), `${SELECTORS.launcherAssetFeesAccrued}${argument}`);
  assert.equal(claimData(stockClaim), `${SELECTORS.claimLauncherAssetFees}${argument}`);
});
