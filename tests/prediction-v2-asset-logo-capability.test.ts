import { createHmac } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  publicRelease: { status: "disabled" } as unknown,
  publicReleaseError: false,
}));

vi.mock("../lib/prediction-v2/public-release-v2.server", () => ({
  getPredictionV2PublicReleaseV2: () => {
    if (mocks.publicReleaseError) throw new Error("invalid public release");
    return mocks.publicRelease;
  },
}));

import {
  PREDICTION_ASSET_LOGO_CAPABILITY_CLOCK_SKEW_SECONDS_V2,
  PREDICTION_ASSET_LOGO_CAPABILITY_KEY_ENV_V2,
  PREDICTION_ASSET_LOGO_CAPABILITY_KEY_EPOCH_ENV_V2,
  PREDICTION_ASSET_LOGO_CAPABILITY_MAXIMUM_LENGTH_V2,
  createConfiguredPredictionAssetLogoCapabilityV2,
  createPredictionAssetLogoCapabilityV2,
  verifyConfiguredPredictionAssetLogoCapabilityV2,
  verifyPredictionAssetLogoCapabilityV2,
} from
  "../lib/market-data/prediction-asset-logo-capability-v2.server";

const ASSET = "ab".repeat(32);
const OTHER_ASSET = "cd".repeat(32);
const KEY = "test-only-logo-capability-key-material-2026";
const KEY_EPOCH = "2026-08-a";
const NOW = 1_800_000_000;
const EXPIRES_AT = NOW + 600;
const RELEASE_REVISION = `sha256:${"11".repeat(32)}` as const;
const OTHER_RELEASE_REVISION = `sha256:${"22".repeat(32)}` as const;

function enabledRelease(revision = RELEASE_REVISION) {
  return {
    status: "enabled",
    release: { releaseId: "protocol-v2" },
    attestation: { payloadSha256: revision },
  };
}

function issueInput(nowUnixSeconds = NOW) {
  return {
    assetId: ASSET,
    key: KEY,
    keyEpoch: KEY_EPOCH,
    nowUnixSeconds,
    publicReleasePayloadSha256: RELEASE_REVISION,
  } as const;
}

function verificationInput(capability: string, nowUnixSeconds = NOW) {
  return { ...issueInput(nowUnixSeconds), capability };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  mocks.publicRelease = { status: "disabled" };
  mocks.publicReleaseError = false;
});

describe("Prediction V2 asset logo capabilities", () => {
  it("creates the exact release-bound, expiring V2 HMAC capability", () => {
    const capability = createPredictionAssetLogoCapabilityV2(issueInput());
    const expectedSignature = createHmac("sha256", KEY).update([
      "programmable.prediction-asset-logo-capability.v2",
      `publicReleasePayloadSha256:${RELEASE_REVISION}`,
      `keyEpoch:${KEY_EPOCH}`,
      `assetId:${ASSET}`,
      `expiresAtUnixSeconds:${EXPIRES_AT}`,
    ].join("\n"), "utf8").digest("base64url");

    expect(capability).toBe(
      `v2.${KEY_EPOCH}.${EXPIRES_AT}.${expectedSignature}`,
    );
    expect(capability.length).toBeLessThanOrEqual(
      PREDICTION_ASSET_LOGO_CAPABILITY_MAXIMUM_LENGTH_V2,
    );
    expect(verifyPredictionAssetLogoCapabilityV2(
      verificationInput(capability),
    )).toBe(true);
  });

  it("uses one deterministic token per five-minute expiry bucket", () => {
    const first = createPredictionAssetLogoCapabilityV2(issueInput(NOW + 1));
    expect(createPredictionAssetLogoCapabilityV2(issueInput(NOW + 299)))
      .toBe(first);
    expect(createPredictionAssetLogoCapabilityV2(issueInput(NOW + 300)))
      .not.toBe(first);
  });

  it("cannot be replayed for another asset, release revision, epoch or key", () => {
    const capability = createPredictionAssetLogoCapabilityV2(issueInput());

    expect(verifyPredictionAssetLogoCapabilityV2({
      ...verificationInput(capability),
      assetId: OTHER_ASSET,
    })).toBe(false);
    expect(verifyPredictionAssetLogoCapabilityV2({
      ...verificationInput(capability),
      publicReleasePayloadSha256: OTHER_RELEASE_REVISION,
    })).toBe(false);
    expect(verifyPredictionAssetLogoCapabilityV2({
      ...verificationInput(capability),
      keyEpoch: "2026-08-b",
    })).toBe(false);
    expect(verifyPredictionAssetLogoCapabilityV2({
      ...verificationInput(capability),
      key: `${KEY}-different`,
    })).toBe(false);
  });

  it("accepts only the bounded clock-skew window", () => {
    const capability = createPredictionAssetLogoCapabilityV2(issueInput());
    const skew = PREDICTION_ASSET_LOGO_CAPABILITY_CLOCK_SKEW_SECONDS_V2;

    expect(verifyPredictionAssetLogoCapabilityV2(
      verificationInput(capability, EXPIRES_AT + skew),
    )).toBe(true);
    expect(verifyPredictionAssetLogoCapabilityV2(
      verificationInput(capability, EXPIRES_AT + skew + 1),
    )).toBe(false);
    expect(verifyPredictionAssetLogoCapabilityV2(
      verificationInput(capability, NOW - skew),
    )).toBe(true);
    expect(verifyPredictionAssetLogoCapabilityV2(
      verificationInput(capability, NOW - skew - 1),
    )).toBe(false);
  });

  it("rejects non-canonical assets, V1, unbucketed and unbounded tokens", () => {
    expect(() => createPredictionAssetLogoCapabilityV2({
      ...issueInput(),
      assetId: ASSET.toUpperCase(),
    })).toThrow(/canonical lowercase/u);
    expect(verifyPredictionAssetLogoCapabilityV2({
      ...verificationInput(`v1.${KEY_EPOCH}.${"a".repeat(43)}`),
    })).toBe(false);
    expect(verifyPredictionAssetLogoCapabilityV2({
      ...verificationInput(`v2.${KEY_EPOCH}.0${EXPIRES_AT}.${"a".repeat(43)}`),
    })).toBe(false);
    expect(verifyPredictionAssetLogoCapabilityV2({
      ...verificationInput(
        `v2.${KEY_EPOCH}.${EXPIRES_AT + 1}.${"a".repeat(43)}`,
      ),
    })).toBe(false);
    expect(verifyPredictionAssetLogoCapabilityV2({
      ...verificationInput("x".repeat(
        PREDICTION_ASSET_LOGO_CAPABILITY_MAXIMUM_LENGTH_V2 + 1,
      )),
    })).toBe(false);
  });

  it("stays fail-closed without an enabled verified public release", () => {
    vi.stubEnv(PREDICTION_ASSET_LOGO_CAPABILITY_KEY_ENV_V2, KEY);
    vi.stubEnv(PREDICTION_ASSET_LOGO_CAPABILITY_KEY_EPOCH_ENV_V2, KEY_EPOCH);

    expect(createConfiguredPredictionAssetLogoCapabilityV2(ASSET)).toBeNull();
    expect(verifyConfiguredPredictionAssetLogoCapabilityV2(
      ASSET,
      createPredictionAssetLogoCapabilityV2(issueInput()),
    )).toBe(false);

    mocks.publicReleaseError = true;
    expect(createConfiguredPredictionAssetLogoCapabilityV2(ASSET)).toBeNull();
  });

  it("issues and verifies only against the current signed release revision", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW * 1_000);
    vi.stubEnv(PREDICTION_ASSET_LOGO_CAPABILITY_KEY_ENV_V2, KEY);
    vi.stubEnv(PREDICTION_ASSET_LOGO_CAPABILITY_KEY_EPOCH_ENV_V2, KEY_EPOCH);
    mocks.publicRelease = enabledRelease();

    const capability = createConfiguredPredictionAssetLogoCapabilityV2(ASSET);
    expect(capability).not.toBeNull();
    expect(verifyConfiguredPredictionAssetLogoCapabilityV2(
      ASSET,
      capability as string,
    )).toBe(true);

    mocks.publicRelease = enabledRelease(OTHER_RELEASE_REVISION);
    expect(verifyConfiguredPredictionAssetLogoCapabilityV2(
      ASSET,
      capability as string,
    )).toBe(false);
  });
});
