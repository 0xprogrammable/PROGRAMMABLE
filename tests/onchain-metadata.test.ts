import { describe, expect, it } from "vitest";
import { stringToHex } from "viem";

import {
  buildTokenLinks,
  decodeSocialMetadata,
  sanitizeImageUrl,
  sanitizeWebsiteUrl,
} from "../lib/onchain/metadata";
import {
  MAX_METADATA_URL_BYTES,
  MAX_SOCIAL_URL_BYTES,
} from "../lib/metadata-policy";

describe("UERC20 metadata extraData", () => {
  it("decodes only the versioned social schema", () => {
    const extraData = stringToHex(
      JSON.stringify({
        v: 1,
        x: "https://x.com/programmable",
        telegram: "https://t.me/programmable",
      }),
    );

    expect(decodeSocialMetadata(extraData)).toEqual({
      v: 1,
      x: "https://x.com/programmable",
      telegram: "https://t.me/programmable",
    });
  });

  it("ignores malformed, unsupported, or oversized bytes", () => {
    expect(decodeSocialMetadata(stringToHex('{"v":2}'))).toBeNull();
    expect(decodeSocialMetadata("0xff")).toBeNull();
    expect(
      decodeSocialMetadata(stringToHex("x".repeat(1_201))),
    ).toBeNull();
  });

  it("only emits correctly labelled HTTPS project links", () => {
    const links = buildTokenLinks(
      "https://programmable.family",
      stringToHex(
        JSON.stringify({
          v: 1,
          x: "https://example.com/not-x",
          telegram: "https://t.me/programmable",
        }),
      ),
    );

    expect(links).toEqual([
      { kind: "website", url: "https://programmable.family/" },
      { kind: "telegram", url: "https://t.me/programmable" },
    ]);
  });

  it("applies the same UTF-8 byte limits as launch acceptance", () => {
    const oversizedWebsite =
      "https://example.com/" +
      "🌷".repeat(Math.ceil(MAX_METADATA_URL_BYTES / 4));
    expect(sanitizeWebsiteUrl(oversizedWebsite)).toBeNull();
    expect(sanitizeImageUrl(oversizedWebsite)).toBeNull();

    const oversizedX =
      "https://x.com/" + "é".repeat(MAX_SOCIAL_URL_BYTES / 2);
    expect(
      buildTokenLinks(
        "",
        stringToHex(JSON.stringify({ v: 1, x: oversizedX })),
      ),
    ).toEqual([]);
  });
});
