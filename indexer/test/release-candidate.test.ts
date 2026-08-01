import { execFileSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const SCRIPT = path.join(ROOT, "scripts/release-candidate.mjs");
const SOURCE_COMMIT = "1".repeat(40);

describe("Envio release candidate identity", () => {
  it("commits the exact reviewed source, schema, handler and event set", () => {
    const identity = JSON.parse(
      execFileSync(
        process.execPath,
        [SCRIPT, "identity", "--source-commit", SOURCE_COMMIT],
        { cwd: ROOT, encoding: "utf8" },
      ),
    );

    expect(identity).toEqual({
      deployment: "production-1111111",
      sourceCommit: SOURCE_COMMIT,
      configSha256:
        "0x378e3a799c762cb31107792c7123f5f90b54b5826884c398995e7465176fe1c2",
      schemaSha256:
        "0xdf3d65e033e96d7ebbe62b6f114b6a30f10c8944e5c6fca6b020c3130bb738c0",
      handlerSha256:
        "0x9f68d05cc8907f1c422cb2584b338ed42375eb4b6033cbec1338d00577267491",
      sourceRegistrySha256:
        "0x55e7a7c7cd0e419a6be0f9c784990f5048b9845e46e329939025c3fab405565a",
      eventSetSha256:
        "0x7481d6fa986d706e46b9834e40574dd84f21be80b041d35e7d47dbfa59d69243",
      eventCount: 51,
    });
  });

  it("rejects a non-canonical source commit", () => {
    expect(() =>
      execFileSync(
        process.execPath,
        [SCRIPT, "identity", "--source-commit", "HEAD"],
        { cwd: ROOT, encoding: "utf8", stdio: "pipe" },
      )
    ).toThrow();
  });
});
