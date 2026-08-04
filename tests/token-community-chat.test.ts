import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  getTokenCommunityStorageKey,
  parseStoredCommunityMessages,
} from "../components/token-community-chat";

const root = process.cwd();
const source = readFileSync(
  join(root, "components/token-community-chat.tsx"),
  "utf8",
);
const styles = readFileSync(
  join(root, "components/token-community-chat.module.css"),
  "utf8",
);

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

  it("keeps bounded sender identity without persisting avatar data", () => {
    expect(
      parseStoredCommunityMessages([
        {
          id: " identity ",
          body: "Hello",
          createdAt: 1_000,
          authorAddress: "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD",
          authorLabel: `  ${"A".repeat(40)}  `,
          avatarDataUrl: "data:image/png;base64,AAAA",
        },
      ]),
    ).toEqual([
      {
        id: "identity",
        body: "Hello",
        createdAt: 1_000,
        authorAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        authorLabel: "A".repeat(32),
      },
    ]);
  });

  it("uses the real wallet profile avatar and concise composer labels", () => {
    expect(source).toContain("useWallet()");
    expect(source).toContain("currentAvatarDataUrl");
    expect(source).toContain('placeholder="Write message"');
    expect(source).toContain("<span>Send message</span>");
    expect(source).not.toMatch(/Local Room|Room Notice/i);
    expect(source).not.toMatch(/Messages sync across tabs/i);
    expect(source).not.toMatch(/Message Programmable/i);
  });

  it("keeps the desktop panel compact and sticky without pinning mobile", () => {
    expect(styles).toContain("max-width: 380px");
    expect(styles).toMatch(
      /@media \(min-width: 721px\)[\s\S]*position: sticky/,
    );
    expect(styles).toMatch(
      /@media \(max-width: 560px\)[\s\S]*max-width: none/,
    );
  });
});
