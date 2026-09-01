import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

// @ts-expect-error The production helper is an executable ESM script.
import { bindVercelSensitiveProductionMetadata, omitVercelEnvironmentValues } from "../scripts/bind-vercel-sensitive-production-metadata.mjs";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

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

  it("binds a sensitive GMGN Production entry without retaining its value", () => {
    const sentinel = "gmgn-value-must-not-be-bound";
    const metadata = omitVercelEnvironmentValues({
      envs: [{
        configurationId: "env_cfg_12345678",
        key: "GMGN_API_KEY",
        type: "sensitive",
        target: ["production"],
        value: sentinel,
      }],
    });
    const bound = bindVercelSensitiveProductionMetadata({
      metadata,
      vercelProjectId: "prj_12345678",
    });

    expect(bound).toMatchObject({
      schemaVersion: "programmable.vercel-sensitive-production-metadata.v1",
      vercelProjectId: "prj_12345678",
      target: "production",
      envs: [{
        key: "GMGN_API_KEY",
        type: "sensitive",
        target: ["production"],
      }],
    });
    expect(bound.envs[0]).not.toHaveProperty("configurationId");
    expect(JSON.stringify(bound)).not.toContain(sentinel);
    expect(JSON.stringify(bound)).not.toContain('"value"');
  });

  it("persists only the explicit safe metadata projection", () => {
    const sentinels = [
      "top-level-value",
      "vsm-provider-value",
      "nested-encrypted-value",
      "mixed-case-value",
      "unknown-secret-value",
      "nested-raw-value",
    ];
    const metadata = omitVercelEnvironmentValues({
      envs: [{
        configurationId: "env_cfg_12345678",
        key: "GMGN_API_KEY",
        type: "sensitive",
        target: ["production"],
        value: sentinels[0],
        vsmValue: sentinels[1],
        internalContentHint: {
          encryptedValue: sentinels[2],
          Value: sentinels[3],
          encoding: "utf8",
        },
        secretValue: sentinels[4],
        providerMetadata: {
          rawValue: sentinels[5],
        },
      }],
    });

    expect(metadata.envs[0]).toEqual({
      key: "GMGN_API_KEY",
      type: "sensitive",
      target: ["production"],
    });
    expect(Object.keys(metadata.envs[0]).sort()).toEqual([
      "key",
      "target",
      "type",
    ]);
    for (const sentinel of sentinels) {
      expect(JSON.stringify(metadata)).not.toContain(sentinel);
    }
  });

  it("rejects nested value representations at the strict boundary", () => {
    expect(() => bindVercelSensitiveProductionMetadata({
      metadata: {
        envs: [{
          key: "GMGN_API_KEY",
          internalContentHint: { encryptedValue: "never-bind-this" },
        }],
      },
      vercelProjectId: "prj_12345678",
    })).toThrow("must not contain values");
  });

  it.each([
    ["an unknown secretValue field", {
      secretValue: "never-bind-this",
    }],
    ["a nested rawValue field", {
      providerMetadata: { rawValue: "never-bind-this" },
    }],
    ["an unknown provider metadata field", {
      configurationId: "env_cfg_12345678",
    }],
  ])("rejects %s at the strict binding boundary", (_label, extra) => {
    expect(() => bindVercelSensitiveProductionMetadata({
      metadata: {
        envs: [{
          key: "GMGN_API_KEY",
          type: "sensitive",
          target: ["production"],
          ...extra,
        }],
      },
      vercelProjectId: "prj_12345678",
    })).toThrow("Vercel environment metadata is invalid");
  });

  it("fails closed before writing excessively deep provider metadata", () => {
    let nested: Record<string, unknown> = { label: "safe" };
    for (let depth = 0; depth < 10; depth += 1) nested = { nested };
    expect(() => omitVercelEnvironmentValues({
      envs: [{ key: "GMGN_API_KEY", internalContentHint: nested }],
    })).toThrow("Vercel environment metadata is invalid");
  });

  it("writes a private value-free bound projection from the CLI", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "vercel-metadata-bind-"));
    temporaryDirectories.push(directory);
    const metadataFile = resolve(directory, "metadata.json");
    const sentinel = "provider-value-must-not-be-written";
    const result = spawnSync(process.execPath, [
      resolve(process.cwd(), "scripts/bind-vercel-sensitive-production-metadata.mjs"),
      "--metadata-file",
      metadataFile,
      "--vercel-project-id",
      "prj_12345678",
    ], {
      encoding: "utf8",
      input: JSON.stringify({
        envs: [{
          key: "GMGN_API_KEY",
          type: "sensitive",
          target: ["production"],
          internalContentHint: { encryptedValue: sentinel },
        }],
      }),
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(`${result.stdout}${readFileSync(metadataFile, "utf8")}`).not
      .toContain(sentinel);
    expect(statSync(metadataFile).mode & 0o777).toBe(0o600);
  });

  it("does not echo malformed provider input through CLI errors", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "vercel-metadata-bind-"));
    temporaryDirectories.push(directory);
    const metadataFile = resolve(directory, "metadata.json");
    const sentinel = "malformed-provider-value-must-not-escape";
    const result = spawnSync(process.execPath, [
      resolve(process.cwd(), "scripts/bind-vercel-sensitive-production-metadata.mjs"),
      "--metadata-file",
      metadataFile,
      "--vercel-project-id",
      "prj_12345678",
    ], {
      encoding: "utf8",
      input: `{"envs":[{"value":"${sentinel}"}] trailing`,
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "Vercel Production metadata binding failed\n",
    );
    expect(result.stderr).not.toContain(sentinel);
  });
});
