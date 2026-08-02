import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { keccak256, type Hex } from "viem";

import fixtureJson from "../../config/data-pipeline-canonical-fingerprint.v1.json";
import databaseFixtureJson from "../../supabase/tests/codec/canonical-fingerprint-v1.json";
import {
  canonicalFingerprintBytesToHex,
  canonicalFingerprintPreimageV1,
  canonicalFingerprintV1,
  canonicalizeFingerprintJson,
  decodeCanonicalFingerprintHex,
  type AllocationFingerprintInput,
  type EvidenceFingerprintInput,
  type OccurrenceFingerprintInput,
} from "../../lib/data-pipeline/canonical-fingerprint";

type FixtureVector = {
  name: string;
  domain: "occurrence" | "allocation" | "evidence";
  input: unknown;
  expected_preimage_hex: Hex;
  expected_keccak256: Hex;
};

const fixture = fixtureJson as unknown as {
  sentinel_vectors: Array<{
    name: string;
    expected_preimage_hex: Hex;
    expected_keccak256: Hex;
  }>;
  vectors: FixtureVector[];
};

function encodeVector(vector: FixtureVector) {
  if (vector.domain === "occurrence") {
    const input = vector.input as OccurrenceFingerprintInput;
    return {
      preimage: canonicalFingerprintPreimageV1("occurrence", input),
      fingerprint: canonicalFingerprintV1("occurrence", input),
    };
  }
  if (vector.domain === "allocation") {
    const input = vector.input as AllocationFingerprintInput;
    return {
      preimage: canonicalFingerprintPreimageV1("allocation", input),
      fingerprint: canonicalFingerprintV1("allocation", input),
    };
  }
  const input = vector.input as EvidenceFingerprintInput;
  return {
    preimage: canonicalFingerprintPreimageV1("evidence", input),
    fingerprint: canonicalFingerprintV1("evidence", input),
  };
}

describe("production canonical fingerprint v1", () => {
  it("keeps the application and database codec fixtures identical", () => {
    expect(fixtureJson).toEqual(databaseFixtureJson);
  });

  it("matches every independent canonical fixture preimage and digest", () => {
    expect(fixture.vectors).toHaveLength(7);

    for (const vector of fixture.vectors) {
      const encoded = encodeVector(vector);
      expect(
        canonicalFingerprintBytesToHex(encoded.preimage),
        `${vector.name} preimage`,
      ).toBe(vector.expected_preimage_hex);
      expect(encoded.fingerprint, `${vector.name} fingerprint`).toBe(
        vector.expected_keccak256,
      );
    }
  });

  it("retains the sentinel distinctions for nulls, ordering and indexed-only data", () => {
    for (const sentinel of fixture.sentinel_vectors) {
      expect(
        keccak256(sentinel.expected_preimage_hex),
        sentinel.name,
      ).toBe(sentinel.expected_keccak256);
    }

    const orderAb = fixture.vectors.find(
      ({ name }) => name === "allocation_order_ab_v1",
    );
    const orderBa = fixture.vectors.find(
      ({ name }) => name === "allocation_order_ba_v1",
    );
    const nullOptional = fixture.vectors.find(
      ({ name }) => name === "evidence_null_optional_v1",
    );
    const presentEmpty = fixture.vectors.find(
      ({ name }) => name === "evidence_present_empty_v1",
    );

    expect(orderAb?.expected_keccak256).not.toBe(orderBa?.expected_keccak256);
    expect(nullOptional?.expected_keccak256).not.toBe(
      presentEmpty?.expected_keccak256,
    );
  });

  it("rejects ambiguous encodings before a fingerprint is produced", () => {
    expect(() => decodeCanonicalFingerprintHex("00", 1)).toThrow();
    expect(() => decodeCanonicalFingerprintHex("0x0")).toThrow();
    expect(() => decodeCanonicalFingerprintHex("0x0g")).toThrow();
    expect(() =>
      decodeCanonicalFingerprintHex(`0x${"11".repeat(19)}`, 20),
    ).toThrow();
    expect(() => canonicalizeFingerprintJson(Number.NaN)).toThrow();
    expect(() => canonicalizeFingerprintJson(1.5)).toThrow();
    expect(() => canonicalizeFingerprintJson("\ud800")).toThrow();
  });

  it("normalizes mixed-case hex without sorting caller-defined arrays", () => {
    const occurrence = fixture.vectors.find(
      ({ name }) => name === "occurrence_all_fields_v1",
    );
    expect(occurrence).toBeDefined();
    const input = structuredClone(
      occurrence!.input,
    ) as OccurrenceFingerprintInput;
    input.source_address = input.source_address.toUpperCase().replace("0X", "0x");
    const normalized = canonicalFingerprintBytesToHex(
      canonicalFingerprintPreimageV1("occurrence", input),
    );
    expect(normalized).toBe(occurrence!.expected_preimage_hex);

    input.ordered_topics.reverse();
    expect(
      canonicalFingerprintBytesToHex(
        canonicalFingerprintPreimageV1("occurrence", input),
      ),
    ).not.toBe(occurrence!.expected_preimage_hex);
  });
});
