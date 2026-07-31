import { describe, expect, it } from "vitest";

import {
  DEFAULT_DEPLOYMENT_LABEL,
  deploymentLabelFromEnvironment,
} from "../src/lib/deployment-identity.js";

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
