import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

const INDEXER_ROOT = process.cwd();
const SCRIPT = path.join(INDEXER_ROOT, "scripts/deployment-identity.mjs");

function run(arguments_: string[]): string {
  return execFileSync(process.execPath, [SCRIPT, ...arguments_], {
    cwd: INDEXER_ROOT,
    encoding: "utf8",
  });
}

describe("deployment artifact identity", () => {
  it("reproduces the exact live-baseline commitments", () => {
    const actual = JSON.parse(
      run(["--verify", "deployment-identity.live-baseline.json"]),
    ) as Record<string, unknown>;
    const manifest = JSON.parse(
      readFileSync(
        path.join(INDEXER_ROOT, "deployment-identity.live-baseline.json"),
        "utf8",
      ),
    ) as { identity: Record<string, unknown> };

    expect(actual).toEqual(manifest.identity);
    expect(actual.eventSetSha256).toBe(
      "0x7481d6fa986d706e46b9834e40574dd84f21be80b041d35e7d47dbfa59d69243",
    );
    expect(actual.eventCount).toBe(51);
  });

  it("renders the complete fail-closed Envio environment", () => {
    const output = run([
      "--verify",
      "deployment-identity.live-baseline.json",
      "--format",
      "env",
    ]);

    expect(output).toContain("ENVIO_DEPLOYMENT_LABEL=production-1e7c381\n");
    expect(output).toContain(`ENVIO_EVENT_COUNT=51\n`);
    expect(output.trim().split("\n")).toHaveLength(8);
  });

  it("rejects artifact drift against a previously generated identity", () => {
    const temporaryRoot = mkdtempSync(
      path.join(tmpdir(), "programmable-indexer-identity-"),
    );
    const artifactPaths = [
      "config.yaml",
      "schema.graphql",
      "src/EventHandlers.ts",
      "src/lib/release-map.ts",
    ];
    for (const relativePath of artifactPaths) {
      const destination = path.join(temporaryRoot, "indexer", relativePath);
      mkdirSync(path.dirname(destination), { recursive: true });
      cpSync(path.join(INDEXER_ROOT, relativePath), destination);
    }
    writeFileSync(
      path.join(temporaryRoot, "SOURCE_COMMIT"),
      `${"1".repeat(40)}\n`,
    );

    const identity = JSON.parse(
      run(["--root", temporaryRoot]),
    ) as Record<string, unknown>;
    const expectedPath = path.join(temporaryRoot, "expected.json");
    writeFileSync(expectedPath, `${JSON.stringify({ identity }, null, 2)}\n`);
    const schemaPath = path.join(temporaryRoot, "indexer/schema.graphql");
    writeFileSync(schemaPath, `${readFileSync(schemaPath, "utf8")}\n`);

    const result = spawnSync(
      process.execPath,
      [SCRIPT, "--root", temporaryRoot, "--verify", expectedPath],
      { cwd: INDEXER_ROOT, encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("deployment identity mismatch: schemaSha256");
  });
});
