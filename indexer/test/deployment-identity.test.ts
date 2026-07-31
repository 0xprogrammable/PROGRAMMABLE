import { describe, expect, it } from "vitest";

import {
  DEFAULT_DEPLOYMENT_IDENTITY,
  DEFAULT_DEPLOYMENT_LABEL,
  deploymentIdentityFromEnvironment,
  deploymentLabelFromEnvironment,
} from "../src/lib/deployment-identity.js";

const reviewedEnvironment = {
  ENVIO_DEPLOYMENT_LABEL: "production-reviewed-2026-07-31",
  ENVIO_SOURCE_COMMIT: "1".repeat(40),
  ENVIO_CONFIG_SHA256: `0x${"22".repeat(32)}`,
  ENVIO_SCHEMA_SHA256: `0x${"33".repeat(32)}`,
  ENVIO_HANDLER_SHA256: `0x${"44".repeat(32)}`,
  ENVIO_SOURCE_REGISTRY_SHA256: `0x${"55".repeat(32)}`,
  ENVIO_EVENT_SET_SHA256: `0x${"66".repeat(32)}`,
  ENVIO_EVENT_COUNT: "51",
} as const;

describe("deployment identity", () => {
  it("defaults to an explicitly unverified development identity", () => {
    expect(deploymentLabelFromEnvironment({})).toBe(
      DEFAULT_DEPLOYMENT_LABEL,
    );
  });

  it("accepts an explicit reviewed deployment label without a code change", () => {
    expect(
      deploymentLabelFromEnvironment({
        ENVIO_DEPLOYMENT_LABEL: "production-reviewed-2026-07-31",
      }),
    ).toBe("production-reviewed-2026-07-31");
  });

  it("accepts only a complete reviewed artifact identity", () => {
    expect(deploymentIdentityFromEnvironment(reviewedEnvironment)).toEqual({
      deployment: reviewedEnvironment.ENVIO_DEPLOYMENT_LABEL,
      sourceCommit: reviewedEnvironment.ENVIO_SOURCE_COMMIT,
      configSha256: reviewedEnvironment.ENVIO_CONFIG_SHA256,
      schemaSha256: reviewedEnvironment.ENVIO_SCHEMA_SHA256,
      handlerSha256: reviewedEnvironment.ENVIO_HANDLER_SHA256,
      sourceRegistrySha256:
        reviewedEnvironment.ENVIO_SOURCE_REGISTRY_SHA256,
      eventSetSha256: reviewedEnvironment.ENVIO_EVENT_SET_SHA256,
      eventCount: 51,
    });
  });

  it.each([
    ["missing source commit", { ENVIO_SOURCE_COMMIT: undefined }],
    ["uppercase commit", { ENVIO_SOURCE_COMMIT: "A".repeat(40) }],
    ["short hash", { ENVIO_HANDLER_SHA256: "0x12" }],
    ["uppercase hash", { ENVIO_CONFIG_SHA256: `0x${"AA".repeat(32)}` }],
    ["zero event count", { ENVIO_EVENT_COUNT: "0" }],
    ["noncanonical event count", { ENVIO_EVENT_COUNT: "051" }],
  ])("fails the full identity closed for %s", (_name, override) => {
    expect(
      deploymentIdentityFromEnvironment({
        ...reviewedEnvironment,
        ...override,
      }),
    ).toBe(DEFAULT_DEPLOYMENT_IDENTITY);
  });

  it.each([
    "",
    " production-reviewed-2026-07-31",
    "production reviewed",
    "PRODUCTION-REVIEWED",
    "production/reviewed",
    "a".repeat(65),
  ])("fails closed for invalid deployment label %j", (deploymentLabel) => {
    expect(
      deploymentLabelFromEnvironment({
        ENVIO_DEPLOYMENT_LABEL: deploymentLabel,
      }),
    ).toBe(DEFAULT_DEPLOYMENT_LABEL);
  });
});
