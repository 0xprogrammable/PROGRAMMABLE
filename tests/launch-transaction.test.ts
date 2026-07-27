import { describe, expect, it } from "vitest";
import { decodeFunctionData, hexToString } from "viem";

import {
  encodeMemeLaunch,
  encodeMemeMetadataExtraData,
  MAX_METADATA_URL_BYTES,
  MAX_SOCIAL_URL_BYTES,
  MAX_TOKEN_DESCRIPTION_BYTES,
  MAX_TOKEN_NAME_BYTES,
  MAX_TOKEN_SYMBOL_BYTES,
  memeLaunchAbi,
  validateMemeLaunchDraft,
} from "../lib/launch-transaction";
import { createEmptyDraft } from "../lib/launch";
import { buildTokenLinks } from "../lib/onchain/metadata";

function classicDraft() {
  return {
    ...createEmptyDraft(),
    tokenName: "Programmable Flower",
    tokenSymbol: "FLOWER",
    tokenDescription: "A fixed supply token",
    tokenWebsite: "https://programmable.family/token/flower",
    tokenImage: "https://programmable.family/tokens/flower.png",
    tokenX: "https://x.com/0xProgrammable",
    tokenTelegram: "https://t.me/programmable",
    totalSwapFeePercent: "1",
    launchSalt:
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  };
}

describe("Classic launch calldata", () => {
  it("encodes current UERC20 metadata and the selected total fee", () => {
    const draft = classicDraft();
    const decoded = decodeFunctionData({
      abi: memeLaunchAbi,
      data: encodeMemeLaunch(
        draft,
        draft.launchSalt as `0x${string}`,
      ),
    });

    if (decoded.functionName !== "launch") {
      throw new Error("Expected MemeLaunchV1.launch calldata");
    }

    const parameters = decoded.args[0];
    expect(parameters.totalSwapFeeBps).toBe(100);
    expect(parameters.metadata.description).toBe(
      "A fixed supply token",
    );
    expect(parameters.metadata.website).toBe(
      "https://programmable.family/token/flower",
    );
    expect(parameters.metadata.image).toBe(
      "https://programmable.family/tokens/flower.png",
    );
    expect(JSON.parse(hexToString(parameters.metadata.extraData))).toEqual({
      v: 1,
      x: "https://x.com/0xProgrammable",
      telegram: "https://t.me/programmable",
    });
    expect(
      buildTokenLinks(
        parameters.metadata.website,
        parameters.metadata.extraData,
      ),
    ).toEqual([
      {
        kind: "website",
        url: "https://programmable.family/token/flower",
      },
      {
        kind: "x",
        url: "https://x.com/0xProgrammable",
      },
      {
        kind: "telegram",
        url: "https://t.me/programmable",
      },
    ]);
  });

  it("uses empty bytes when no social links were supplied", () => {
    const draft = {
      ...classicDraft(),
      tokenX: "",
      tokenTelegram: "",
    };

    expect(encodeMemeMetadataExtraData(draft)).toBe("0x");

    const decoded = decodeFunctionData({
      abi: memeLaunchAbi,
      data: encodeMemeLaunch(
        draft,
        draft.launchSalt as `0x${string}`,
      ),
    });
    if (decoded.functionName !== "launch") {
      throw new Error("Expected MemeLaunchV1.launch calldata");
    }
    expect(decoded.args[0].metadata.extraData).toBe("0x");
  });

  it("omits whichever optional social field is empty", () => {
    const extraData = encodeMemeMetadataExtraData({
      ...classicDraft(),
      tokenTelegram: "",
    });

    expect(hexToString(extraData)).toBe(
      '{"v":1,"x":"https://x.com/0xProgrammable"}',
    );
  });

  it("rejects non-HTTPS and oversized metadata URLs", () => {
    const draft = classicDraft();

    expect(() =>
      encodeMemeLaunch(
        { ...draft, tokenWebsite: "http://example.com" },
        draft.launchSalt as `0x${string}`,
      ),
    ).toThrow("complete HTTPS URL");
    expect(() =>
      encodeMemeLaunch(
        {
          ...draft,
          tokenImage: `https://example.com/${"a".repeat(MAX_METADATA_URL_BYTES)}`,
        },
        draft.launchSalt as `0x${string}`,
      ),
    ).toThrow(`${MAX_METADATA_URL_BYTES} bytes`);
  });

  it("rejects social links that Explore would discard", () => {
    const draft = classicDraft();

    expect(() =>
      encodeMemeLaunch(
        { ...draft, tokenX: "https://example.com/not-x" },
        draft.launchSalt as `0x${string}`,
      ),
    ).toThrow("x.com or twitter.com");
    expect(() =>
      encodeMemeLaunch(
        { ...draft, tokenTelegram: "https://example.com/not-telegram" },
        draft.launchSalt as `0x${string}`,
      ),
    ).toThrow("t.me or telegram.me");
    expect(() =>
      encodeMemeLaunch(
        { ...draft, tokenX: "https://x.com" },
        draft.launchSalt as `0x${string}`,
      ),
    ).toThrow("x.com or twitter.com");
    expect(() =>
      encodeMemeLaunch(
        { ...draft, tokenTelegram: "https://t.me" },
        draft.launchSalt as `0x${string}`,
      ),
    ).toThrow("t.me or telegram.me");
    expect(() =>
      encodeMemeLaunch(
        {
          ...draft,
          tokenX: `https://x.com/${"a".repeat(MAX_SOCIAL_URL_BYTES)}`,
        },
        draft.launchSalt as `0x${string}`,
      ),
    ).toThrow(`${MAX_SOCIAL_URL_BYTES} bytes`);
  });

  it("rejects obsolete supply settings and invalid fee choices", () => {
    const draft = classicDraft();

    expect(() =>
      encodeMemeLaunch(
        { ...draft, tokenSupply: "100" },
        draft.launchSalt as `0x${string}`,
      ),
    ).toThrow("fixed supply");
    expect(() =>
      encodeMemeLaunch(
        { ...draft, totalSwapFeePercent: "1.1" },
        draft.launchSalt as `0x${string}`,
      ),
    ).toThrow("1% to 10%");
  });

  it("requires a Dev Buy at or above the minimum", () => {
    const draft = classicDraft();

    expect(() =>
      validateMemeLaunchDraft({
        ...draft,
        initialBuyEth: "0.000599999999999999",
      }),
    ).toThrow("at least 0.0006 ETH");
    expect(() =>
      validateMemeLaunchDraft({
        ...draft,
        initialBuyEth: "1e-3",
      }),
    ).toThrow("at least 0.0006 ETH");
    expect(
      validateMemeLaunchDraft({
        ...draft,
        initialBuyEth: "0.002",
      }),
    ).toBe(100);
  });

  it("enforces the contract limits as UTF-8 bytes", () => {
    const draft = classicDraft();
    expect(
      validateMemeLaunchDraft({
        ...draft,
        tokenName: "n".repeat(MAX_TOKEN_NAME_BYTES),
        tokenSymbol: "S".repeat(MAX_TOKEN_SYMBOL_BYTES),
        tokenDescription: "d".repeat(MAX_TOKEN_DESCRIPTION_BYTES),
      }),
    ).toBe(100);

    expect(() =>
      validateMemeLaunchDraft({
        ...draft,
        tokenName: "é".repeat(MAX_TOKEN_NAME_BYTES / 2 + 1),
      }),
    ).toThrow(`${MAX_TOKEN_NAME_BYTES} UTF-8 bytes`);
    expect(() =>
      validateMemeLaunchDraft({
        ...draft,
        tokenSymbol: "🌷".repeat(MAX_TOKEN_SYMBOL_BYTES / 4 + 1),
      }),
    ).toThrow(`${MAX_TOKEN_SYMBOL_BYTES} UTF-8 bytes`);
    expect(() =>
      validateMemeLaunchDraft({
        ...draft,
        tokenDescription: "🌷".repeat(
          MAX_TOKEN_DESCRIPTION_BYTES / 4 + 1,
        ),
      }),
    ).toThrow(`${MAX_TOKEN_DESCRIPTION_BYTES} UTF-8 bytes`);
  });
});
