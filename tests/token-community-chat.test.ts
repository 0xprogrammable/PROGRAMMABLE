import { describe, expect, it } from "vitest";

import {
  getTokenCommunityStorageKey,
  parseStoredCommunityMessages,
} from "../components/token-community-chat";

describe("token community room storage", () => {
  it("keeps every token in a separate versioned room", () => {
    expect(getTokenCommunityStorageKey("0xABC")).toBe(
      "programmable-community:v1:0xabc",
    );
    expect(getTokenCommunityStorageKey("0xABC")).not.toBe(
      getTokenCommunityStorageKey("0xDEF"),
    );
  });

  it("accepts only bounded messages with valid timestamps", () => {
    expect(
      parseStoredCommunityMessages([
        { id: "1", body: "  Hello room  ", createdAt: 1_000 },
        { id: "2", body: "", createdAt: 2_000 },
        { id: "3", body: "Bad time", createdAt: "now" },
      ]),
    ).toEqual([{ id: "1", body: "Hello room", createdAt: 1_000 }]);
  });
});
