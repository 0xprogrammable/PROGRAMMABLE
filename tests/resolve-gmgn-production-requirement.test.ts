import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

// @ts-expect-error The production helper is an executable ESM script.
import { resolveGmgnProductionRequirement } from "../scripts/resolve-gmgn-production-requirement.mjs";

const PROJECT_ID = "prj_12345678";
const temporaryDirectories: string[] = [];

function metadata(envs: Array<Record<string, unknown>>) {
  return {
    schemaVersion: "programmable.vercel-sensitive-production-metadata.v1",
    vercelProjectId: PROJECT_ID,
    target: "production",
    envs,
  };
}

function exactGmgnEntry(overrides: Record<string, unknown> = {}) {
  return {
    key: "GMGN_API_KEY",
    type: "sensitive",
    target: ["production"],
    ...overrides,
  };
}

function exactGmgnRateEntry(overrides: Record<string, unknown> = {}) {
  return {
    key: "GMGN_MAX_REQUESTS_PER_SECOND",
    type: "sensitive",
    target: ["production"],
    ...overrides,
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("GMGN Production requirement metadata resolver", () => {
  it("resolves an absent exact key to false", () => {
    expect(resolveGmgnProductionRequirement({
      metadata: metadata([{
        key: "OTHER_SECRET",
        type: "sensitive",
        target: ["production"],
      }]),
      vercelProjectId: PROJECT_ID,
    })).toBe(false);
  });

  it("rejects an API key without exact rate metadata", () => {
    expect(() => resolveGmgnProductionRequirement({
      metadata: metadata([exactGmgnEntry()]),
      vercelProjectId: PROJECT_ID,
    })).toThrow("GMGN Production metadata is incomplete");
  });

  it("rejects rate metadata without an exact API key", () => {
    expect(() => resolveGmgnProductionRequirement({
      metadata: metadata([exactGmgnRateEntry()]),
      vercelProjectId: PROJECT_ID,
    })).toThrow("GMGN Production metadata is incomplete");
  });

  it("rejects a duplicate even when its companion entry is missing", () => {
    expect(() => resolveGmgnProductionRequirement({
      metadata: metadata([exactGmgnEntry(), exactGmgnEntry()]),
      vercelProjectId: PROJECT_ID,
    })).toThrow("GMGN Production metadata is ambiguous");
    expect(() => resolveGmgnProductionRequirement({
      metadata: metadata([exactGmgnRateEntry(), exactGmgnRateEntry()]),
      vercelProjectId: PROJECT_ID,
    })).toThrow("GMGN Production metadata is ambiguous");
  });

  it.each(["sensitive", "encrypted"])(
    "resolves exact API key and %s rate metadata to true",
    (rateType) => {
      expect(resolveGmgnProductionRequirement({
        metadata: metadata([exactGmgnEntry({
          gitBranch: null,
          customEnvironmentIds: [],
          visibility: "secret",
          decrypted: false,
        }), exactGmgnRateEntry({
          type: rateType,
          gitBranch: null,
          customEnvironmentIds: [],
          visibility: "secret",
          decrypted: false,
        })]),
        vercelProjectId: PROJECT_ID,
      })).toBe(true);
    },
  );

  it.each([
    ["duplicate", [
      exactGmgnEntry(),
      exactGmgnEntry(),
      exactGmgnRateEntry(),
    ]],
    ["case drift", [
      exactGmgnEntry({ key: "gmgn_api_key" }),
      exactGmgnRateEntry(),
    ]],
    ["plain type", [
      exactGmgnEntry({ type: "plain" }),
      exactGmgnRateEntry(),
    ]],
    ["encrypted type", [
      exactGmgnEntry({ type: "encrypted" }),
      exactGmgnRateEntry(),
    ]],
    ["Preview target", [
      exactGmgnEntry({ target: ["preview"] }),
      exactGmgnRateEntry(),
    ]],
    ["multiple targets", [exactGmgnEntry({
      target: ["production", "preview"],
    }), exactGmgnRateEntry()]],
    ["branch scope", [
      exactGmgnEntry({ gitBranch: "production" }),
      exactGmgnRateEntry(),
    ]],
    ["custom environment", [exactGmgnEntry({
      customEnvironmentIds: ["env_12345678"],
    }), exactGmgnRateEntry()]],
    ["config visibility", [
      exactGmgnEntry({ visibility: "config" }),
      exactGmgnRateEntry(),
    ]],
    ["decrypted metadata", [
      exactGmgnEntry({ decrypted: true }),
      exactGmgnRateEntry(),
    ]],
    ["system metadata", [
      exactGmgnEntry({ system: true }),
      exactGmgnRateEntry(),
    ]],
  ])("rejects API key %s", (_label, envs) => {
    expect(() => resolveGmgnProductionRequirement({
      metadata: metadata(envs),
      vercelProjectId: PROJECT_ID,
    })).toThrow();
  });

  it.each([
    ["duplicate", [
      exactGmgnEntry(),
      exactGmgnRateEntry(),
      exactGmgnRateEntry(),
    ]],
    ["case drift", [
      exactGmgnEntry(),
      exactGmgnRateEntry({ key: "gmgn_max_requests_per_second" }),
    ]],
    ["plain type", [
      exactGmgnEntry(),
      exactGmgnRateEntry({ type: "plain" }),
    ]],
    ["Preview target", [
      exactGmgnEntry(),
      exactGmgnRateEntry({ target: ["preview"] }),
    ]],
    ["multiple targets", [exactGmgnEntry(), exactGmgnRateEntry({
      target: ["production", "preview"],
    })]],
    ["branch scope", [
      exactGmgnEntry(),
      exactGmgnRateEntry({ gitBranch: "production" }),
    ]],
    ["custom environment", [exactGmgnEntry(), exactGmgnRateEntry({
      customEnvironmentIds: ["env_12345678"],
    })]],
    ["config visibility", [
      exactGmgnEntry(),
      exactGmgnRateEntry({ visibility: "config" }),
    ]],
    ["decrypted metadata", [
      exactGmgnEntry(),
      exactGmgnRateEntry({ decrypted: true }),
    ]],
    ["system metadata", [
      exactGmgnEntry(),
      exactGmgnRateEntry({ system: true }),
    ]],
  ])("rejects rate metadata %s", (_label, envs) => {
    expect(() => resolveGmgnProductionRequirement({
      metadata: metadata(envs),
      vercelProjectId: PROJECT_ID,
    })).toThrow();
  });

  it.each([
    ["a top-level value", exactGmgnEntry({ value: "never-log-this" })],
    ["a VSM value", exactGmgnEntry({ vsmValue: "never-log-this" })],
    ["a legacy value", exactGmgnEntry({ legacyValue: "never-log-this" })],
    ["a mixed-case value", exactGmgnEntry({ Value: "never-log-this" })],
    ["a nested encrypted value", exactGmgnEntry({
      internalContentHint: { encryptedValue: "never-log-this" },
    })],
  ])("rejects bound metadata containing %s", (_label, entry) => {
    expect(() => resolveGmgnProductionRequirement({
      metadata: metadata([entry, exactGmgnRateEntry()]),
      vercelProjectId: PROJECT_ID,
    })).toThrow("Bound Vercel Production metadata is invalid");
  });

  it.each([
    ["a top-level value", exactGmgnRateEntry({
      value: "never-log-this",
    })],
    ["an unknown secretValue", exactGmgnRateEntry({
      secretValue: "never-log-this",
    })],
    ["a nested rawValue", exactGmgnRateEntry({
      providerMetadata: { rawValue: "never-log-this" },
    })],
  ])("rejects rate metadata containing %s", (_label, entry) => {
    expect(() => resolveGmgnProductionRequirement({
      metadata: metadata([exactGmgnEntry(), entry]),
      vercelProjectId: PROJECT_ID,
    })).toThrow("Bound Vercel Production metadata is invalid");
  });

  it.each([
    ["an unknown secretValue field", exactGmgnEntry({
      secretValue: "never-log-this",
    })],
    ["a nested rawValue field", exactGmgnEntry({
      providerMetadata: { rawValue: "never-log-this" },
    })],
    ["an unknown provider metadata field", exactGmgnEntry({
      configurationId: "env_cfg_12345678",
    })],
  ])("fails closed on %s", (_label, entry) => {
    expect(() => resolveGmgnProductionRequirement({
      metadata: metadata([entry, exactGmgnRateEntry()]),
      vercelProjectId: PROJECT_ID,
    })).toThrow("Bound Vercel Production metadata is invalid");
  });

  it("rejects a different bound project or schema", () => {
    expect(() => resolveGmgnProductionRequirement({
      metadata: metadata([exactGmgnEntry(), exactGmgnRateEntry()]),
      vercelProjectId: "prj_87654321",
    })).toThrow("Bound Vercel Production metadata is invalid");
    expect(() => resolveGmgnProductionRequirement({
      metadata: {
        ...metadata([exactGmgnEntry(), exactGmgnRateEntry()]),
        schemaVersion: "programmable.vercel-sensitive-production-metadata.v2",
      },
      vercelProjectId: PROJECT_ID,
    })).toThrow("Bound Vercel Production metadata is invalid");
  });

  it("fails closed on excessively deep metadata", () => {
    let nested: Record<string, unknown> = { label: "safe" };
    for (let depth = 0; depth < 10; depth += 1) nested = { nested };
    expect(() => resolveGmgnProductionRequirement({
      metadata: metadata([
        exactGmgnEntry({ internalContentHint: nested }),
        exactGmgnRateEntry(),
      ]),
      vercelProjectId: PROJECT_ID,
    })).toThrow("Bound Vercel Production metadata is invalid");
  });

  it("prints only the exact Boolean from the CLI", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "gmgn-requirement-"));
    temporaryDirectories.push(directory);
    const metadataFile = resolve(directory, "metadata.json");
    writeFileSync(metadataFile, `${JSON.stringify(metadata([
      exactGmgnEntry(),
      exactGmgnRateEntry({ type: "encrypted" }),
    ]))}\n`, { mode: 0o600 });
    const result = spawnSync(process.execPath, [
      resolve(process.cwd(), "scripts/resolve-gmgn-production-requirement.mjs"),
      "--metadata-file",
      metadataFile,
      "--vercel-project-id",
      PROJECT_ID,
    ], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("true\n");
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain("GMGN_API_KEY");
    expect(result.stdout).not.toContain(PROJECT_ID);
  });

  it("fails without echoing a value-bearing provider record", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "gmgn-requirement-"));
    temporaryDirectories.push(directory);
    const metadataFile = resolve(directory, "metadata.json");
    const sentinel = "provider-value-must-not-escape";
    writeFileSync(metadataFile, `${JSON.stringify(metadata([
      exactGmgnEntry({ value: sentinel }),
      exactGmgnRateEntry(),
    ]))}\n`, { mode: 0o600 });
    const result = spawnSync(process.execPath, [
      resolve(process.cwd(), "scripts/resolve-gmgn-production-requirement.mjs"),
      "--metadata-file",
      metadataFile,
      "--vercel-project-id",
      PROJECT_ID,
    ], { encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).not.toContain(sentinel);
    expect(result.stdout).toBe("");
  });
});
