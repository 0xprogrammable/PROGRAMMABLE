import "server-only";

import { createHash, createHmac } from "node:crypto";

import { getAddress, isAddress } from "viem";

const ASSERTION_DOMAIN =
  "programmable.custom-launch-api.wallet-bff-assertion.v2";
const ASSERTION_NONCE = /^[A-Za-z0-9_-]{22}$/u;

export function requireWalletAdminBffAssertionKeyV2(
  value: string,
  websiteToken: string,
) {
  if (
    typeof value !== "string"
    || value.length < 43
    || value.length > 512
    || /\s|\u0000/u.test(value)
    || value === websiteToken
  ) throw new TypeError("Custom launch BFF assertion key is invalid");
  return value;
}

export function createWalletAdminBffAssertionV2(input: Readonly<{
  method: "GET" | "POST" | "DELETE";
  requestTarget: string;
  privyUserId: string;
  walletAddress: `0x${string}`;
  issuedAt: string;
  nonce: string;
  bodyBytes: Buffer;
  assertionKey: string;
}>) {
  let canonicalIssuedAt: string;
  try {
    canonicalIssuedAt = new Date(input.issuedAt).toISOString();
  } catch {
    throw new TypeError("Wallet admin BFF assertion input is invalid");
  }
  if (
    input.issuedAt !== canonicalIssuedAt
    || !ASSERTION_NONCE.test(input.nonce)
    || !input.requestTarget.startsWith("/")
    || input.requestTarget.includes("#")
    || !isAddress(input.walletAddress)
    || !Buffer.isBuffer(input.bodyBytes)
  ) throw new TypeError("Wallet admin BFF assertion input is invalid");
  const walletAddress = getAddress(input.walletAddress).toLowerCase();
  const bodySha256 = `sha256:${createHash("sha256")
    .update(input.bodyBytes)
    .digest("hex")}`;
  const fields = [
    input.method,
    input.requestTarget,
    input.privyUserId,
    walletAddress,
    input.issuedAt,
    input.nonce,
    bodySha256,
  ];
  if (fields.some((field) => !field || field.includes("\u0000"))) {
    throw new TypeError("Wallet admin BFF assertion input is invalid");
  }
  const assertionBytes = Buffer.concat([
    Buffer.from(ASSERTION_DOMAIN, "utf8"),
    Buffer.from([0]),
    Buffer.from(fields.join("\u0000"), "utf8"),
  ]);
  const assertionKey = requireWalletAdminBffAssertionKeyV2(
    input.assertionKey,
    "",
  );
  const signature = createHmac("sha256", assertionKey)
    .update(assertionBytes)
    .digest("hex");
  return Object.freeze({
    "X-Programmable-Bff-Assertion-Version": "2",
    "X-Programmable-Bff-Assertion-Issued-At": input.issuedAt,
    "X-Programmable-Bff-Assertion-Nonce": input.nonce,
    "X-Programmable-Bff-Assertion-Body-Sha256": bodySha256,
    "X-Programmable-Bff-Assertion-Signature": `hmac-sha256:${signature}`,
  });
}
