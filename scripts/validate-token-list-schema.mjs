#!/usr/bin/env node

import Ajv from "ajv";
import addFormats from "ajv-formats";

const UNISWAP_TOKEN_LIST_SCHEMA_COMMIT =
  "01705f94a307270b6c0fe5f55c7e66f7b92373cc";
const schemaUrl =
  `https://raw.githubusercontent.com/Uniswap/token-lists/${UNISWAP_TOKEN_LIST_SCHEMA_COMMIT}/src/tokenlist.schema.json`;

const response = await fetch(schemaUrl, {
  signal: AbortSignal.timeout(15_000),
});
if (!response.ok) {
  throw new Error(`Official Uniswap token-list schema returned HTTP ${response.status}`);
}
const schema = await response.json();
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

// Mirrors the complete extension shape produced by buildUniswapTokenList.
// Unit tests separately bind these fields to serializeIndexerToken output.
const representativeList = {
  name: "Programmable",
  timestamp: "2026-07-27T12:00:00.000Z",
  version: { major: 1, minor: 1, patch: 0 },
  keywords: ["programmable", "uniswap v4"],
  tokens: [
    {
      chainId: 1,
      address: "0x1111111111111111111111111111111111111111",
      name: "Test2",
      symbol: "TEST2",
      decimals: 18,
      logoURI:
        "https://programmable.family/brand/programmable-token-fallback-01-dawn.webp",
      extensions: {
        programmable: {
          hook: "0x2222222222222222222222222222222222222222",
          model: "v4-custom-accounting",
          positionRecipient:
            "0x7777777777777777777777777777777777777777",
          positionTokenId: "42",
          buyFeeBps: 100,
          sellFeeBps: 100,
          creatorFeeBps: 90,
          launcherFeeBps: 10,
          transferTaxBps: 0,
          feeIncluded: true,
        },
      },
    },
  ],
};

if (!validate(representativeList)) {
  throw new Error(
    `Programmable token-list shape is incompatible with the pinned official schema:\n${JSON.stringify(validate.errors, null, 2)}`,
  );
}

process.stdout.write(
  `${JSON.stringify({
    status: "valid",
    schemaCommit: UNISWAP_TOKEN_LIST_SCHEMA_COMMIT,
    schemaUrl,
  })}\n`,
);
