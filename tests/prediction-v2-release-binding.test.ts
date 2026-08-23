import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getPredictionV2ReleaseBinding,
  parsePredictionV2ReleaseBinding,
} from "../lib/prediction-v2/release-binding.server";

const disabledBinding = {
  schemaVersion: 1,
  releaseVersion: "prediction-v2",
  status: "disabled",
} as const;

describe("Prediction V2 release binding", () => {
  it("loads an immutable dormant binding with no deployment identity", () => {
    const binding = getPredictionV2ReleaseBinding();

    expect(binding).toEqual(disabledBinding);
    expect(Object.isFrozen(binding)).toBe(true);
    expect(binding).not.toHaveProperty("addresses");
    expect(binding).not.toHaveProperty("deployment");
    expect(binding).not.toHaveProperty("attestation");
  });

  it("accepts only the exact disabled V1 schema and copies the input", () => {
    const input: Record<string, unknown> = { ...disabledBinding };
    const parsed = parsePredictionV2ReleaseBinding(input);

    input.status = "enabled";
    expect(parsed).toEqual(disabledBinding);
    expect(Object.isFrozen(parsed)).toBe(true);
  });

  it.each([
    ["draft status", { ...disabledBinding, status: "draft" }],
    ["enabled status", { ...disabledBinding, status: "enabled" }],
    ["missing status", {
      schemaVersion: 1,
      releaseVersion: "prediction-v2",
    }],
    ["wrong schema", { ...disabledBinding, schemaVersion: 2 }],
    ["wrong release", { ...disabledBinding, releaseVersion: "prediction-v1" }],
    ["address injection", {
      ...disabledBinding,
      addresses: { factory: "0x1111111111111111111111111111111111111111" },
    }],
    ["environment indirection", {
      ...disabledBinding,
      factoryAddressEnv: "PREDICTION_V2_FACTORY_ADDRESS",
    }],
  ])("rejects %s", (_label, value) => {
    expect(() => parsePredictionV2ReleaseBinding(value)).toThrow(
      "Invalid Prediction V2 release binding",
    );
  });

  it("rejects activation-shaped data even when it claims an attestation", () => {
    const fakeActivatedBinding = {
      ...disabledBinding,
      status: "enabled",
      deployment: {
        chainId: 4_663,
        factory: "0x1111111111111111111111111111111111111111",
      },
      attestation: {
        signer: "self-declared",
        signature: `0x${"11".repeat(64)}`,
      },
    };

    expect(() => parsePredictionV2ReleaseBinding(fakeActivatedBinding)).toThrow(
      "Invalid Prediction V2 release binding",
    );
  });

  it("rejects arrays and records with a nonstandard prototype", () => {
    expect(() => parsePredictionV2ReleaseBinding([disabledBinding])).toThrow(
      "Invalid Prediction V2 release binding",
    );
    expect(() => parsePredictionV2ReleaseBinding(
      Object.assign(Object.create(null), disabledBinding),
    )).toThrow("Invalid Prediction V2 release binding");
  });

  it("rejects hidden or symbol-keyed additions", () => {
    const hidden = { ...disabledBinding };
    Object.defineProperty(hidden, "deployment", { value: null });
    const symbolKeyed = {
      ...disabledBinding,
      [Symbol("deployment")]: null,
    };

    expect(() => parsePredictionV2ReleaseBinding(hidden)).toThrow(
      "Invalid Prediction V2 release binding",
    );
    expect(() => parsePredictionV2ReleaseBinding(symbolKeyed)).toThrow(
      "Invalid Prediction V2 release binding",
    );
  });
});
