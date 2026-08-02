import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import fixture from "../../supabase/tests/codec/provider-evidence-v2.json";
import { providerEvidenceV2 } from "../../lib/data-pipeline/provider-evidence";

describe("provider evidence v2 production codec", () => {
  for (const vector of fixture.vectors) {
    it(`matches the frozen ${vector.name} vector`, () => {
      const evidence = providerEvidenceV2(
        vector.subtype as Parameters<typeof providerEvidenceV2>[0],
        vector.input,
      );

      expect(`0x${Buffer.from(evidence.canonicalPreimage).toString("hex")}`).toBe(
        vector.expected_preimage_hex,
      );
      expect(evidence.contentFingerprint).toBe(vector.expected_keccak256);
    });
  }

  it("rejects extra fields, mixed-case bytes and malformed UUIDs", () => {
    const vector = fixture.vectors[0]!;
    expect(() =>
      providerEvidenceV2("safe_head", { ...vector.input, extra: "field" }),
    ).toThrow();
    expect(() =>
      providerEvidenceV2("safe_head", {
        ...vector.input,
        safe_block_hash_a: `0x${"AA".repeat(32)}`,
      }),
    ).toThrow();
    expect(() =>
      providerEvidenceV2("safe_head", {
        ...vector.input,
        epoch_id: "not-a-uuid",
      }),
    ).toThrow();
  });
});
