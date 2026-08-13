import { describe, expect, it } from "vitest";

// @ts-expect-error The production helper is an executable ESM script.
import { bindVercelSensitiveProductionMetadata, omitVercelEnvironmentValues } from "../scripts/bind-vercel-sensitive-production-metadata.mjs";

describe("Vercel sensitive production metadata binding", () => {
  it("removes CLI-returned plain values before binding metadata", () => {
    const metadata = omitVercelEnvironmentValues({
      envs: [
        {
          key: "PUBLIC_CONFIGURATION",
          value: "must-not-be-preserved",
          type: "plain",
          target: ["production"],
        },
        {
          key: "BITQUERY_OAUTH_TOKEN",
          type: "sensitive",
          target: ["production"],
        },
      ],
    });

    expect(JSON.stringify(metadata)).not.toContain("must-not-be-preserved");
    expect(
      metadata.envs.every(
        (entry: Record<string, unknown>) => !("value" in entry),
      ),
    ).toBe(true);
    expect(
      bindVercelSensitiveProductionMetadata({
        metadata,
        vercelProjectId: "prj_12345678",
      }),
    ).toMatchObject({ target: "production", envs: metadata.envs });
  });

  it("still rejects values at the strict binding boundary", () => {
    expect(() =>
      bindVercelSensitiveProductionMetadata({
        metadata: {
          envs: [{ key: "UNSAFE", value: "secret" }],
        },
        vercelProjectId: "prj_12345678",
      }),
    ).toThrow("must not contain values");
  });
});
