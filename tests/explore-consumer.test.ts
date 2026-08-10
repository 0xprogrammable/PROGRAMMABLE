import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createExploreConsumerSource } from "../lib/explore-consumer.server";

describe("Explore provider-neutral consumer source", () => {
  it("uses a healthy primary source", async () => {
    const read = createExploreConsumerSource<string>({});
    await expect(read({ primary: async () => "current" })).resolves.toEqual({
      value: "current",
      status: "current",
      ageMs: 0,
      origin: "primary",
    });
  });

  it("uses an integrity-checked bounded fallback without returning empty", async () => {
    const read = createExploreConsumerSource<string>({ maxAgeMs: 10_000 });
    await expect(read({
      primary: async () => { throw new Error("primary unavailable"); },
      fallback: async () => ({ value: "durable", ageMs: 5_000 }),
    })).resolves.toEqual({
      value: "durable",
      status: "last-known-good",
      ageMs: 5_000,
      origin: "fallback",
    });
  });

  it("retains bounded memory through a temporary dual-source failure", async () => {
    let now = 1_000;
    const read = createExploreConsumerSource<string>({
      maxAgeMs: 10_000,
      now: () => now,
    });
    await read({ primary: async () => "known" });
    now = 3_500;

    await expect(read({
      primary: async () => { throw new Error("primary unavailable"); },
      fallback: async () => { throw new Error("fallback unavailable"); },
    })).resolves.toEqual({
      value: "known",
      status: "last-known-good",
      ageMs: 2_500,
      origin: "memory",
    });
  });

  it("fails closed when every source is unavailable or too old", async () => {
    const read = createExploreConsumerSource<string>({ maxAgeMs: 100 });
    await expect(read({
      primary: async () => { throw new Error("primary unavailable"); },
      fallback: async () => ({ value: "too old", ageMs: 101 }),
    })).rejects.toThrow("primary unavailable");
  });
});
