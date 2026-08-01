import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "..", "..");

for (const policyPath of [
  "references/official-launchpad-deployments.json",
  "references/official-model-patterns.md",
  "references/routing-and-discovery.md",
  "scripts/official-launchpad-core.mjs"
]) {
  test(`policy bundle binds ${policyPath}`, () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-policy-bundle-"));
    const copiedSkill = path.join(fixtureRoot, "programmable-v4-hook-builder");

    try {
      fs.cpSync(skillRoot, copiedSkill, { recursive: true });
      const firstHash = validate(copiedSkill).toolchain.policyBundleSha256;
      const fixtureChange = policyPath.endsWith(".mjs")
        ? "\n// Policy fixture change.\n"
        : "\nPolicy fixture change.\n";
      fs.appendFileSync(path.join(copiedSkill, policyPath), fixtureChange);
      const secondHash = validate(copiedSkill).toolchain.policyBundleSha256;

      assert.match(firstHash, /^sha256:[a-f0-9]{64}$/);
      assert.match(secondHash, /^sha256:[a-f0-9]{64}$/);
      assert.notEqual(secondHash, firstHash);
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
}

test("policy bundle normalizes only exact gh installer changes", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-installed-policy-bundle-"));
  const copiedSkill = path.join(fixtureRoot, "programmable-v4-hook-builder");

  try {
    fs.cpSync(skillRoot, copiedSkill, { recursive: true });
    const skillPath = path.join(copiedSkill, "SKILL.md");
    const canonical = fs.readFileSync(skillPath, "utf8");
    const canonicalDocument = canonical.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/u);
    assert.ok(canonicalDocument);
    const canonicalFields = new Map(canonicalDocument[1].split("\n").map((line) => line.split(/: (.*)/su).slice(0, 2)));
    const body = canonicalDocument[2];
    const canonicalHash = validate(copiedSkill).toolchain.policyBundleSha256;
    const remoteFrontmatter = [
      "---",
      `description: ${canonicalFields.get("description")}`,
      `license: ${canonicalFields.get("license")}`,
      "metadata:",
      "    github-path: skills/programmable-v4-hook-builder",
      "    github-pinned: 0123456789abcdef0123456789abcdef01234567",
      "    github-ref: 0123456789abcdef0123456789abcdef01234567",
      "    github-repo: https://github.com/0xprogrammable/programmable",
      "    github-tree-sha: 89abcdef0123456789abcdef0123456789abcdef",
      `name: ${canonicalFields.get("name")}`,
      "---"
    ].join("\n");
    const localFrontmatter = [
      "---",
      `description: ${canonicalFields.get("description")}`,
      `license: ${canonicalFields.get("license")}`,
      "metadata:",
      "    local-path: /tmp/programmable-v4-hook-builder",
      `name: ${canonicalFields.get("name")}`,
      "---"
    ].join("\n");

    const hashSource = (source) => {
      fs.writeFileSync(skillPath, source);
      return validate(copiedSkill).toolchain.policyBundleSha256;
    };

    assert.equal(hashSource(`${remoteFrontmatter}\n${body}`), canonicalHash, "remote gh install removes the separator blank line");
    assert.equal(
      hashSource(`${remoteFrontmatter.replace("    github-pinned: 0123456789abcdef0123456789abcdef01234567\n", "")}\n${body}`),
      canonicalHash,
      "unpinned remote provenance is also an exact installer profile"
    );
    assert.equal(hashSource(`${localFrontmatter}\n${body}`), canonicalHash, "local gh install uses the same policy bytes");
    assert.equal(
      hashSource(`${localFrontmatter.replace("/tmp/programmable-v4-hook-builder", "'/tmp/programmable v4 hook builder'")}\n${body}`),
      canonicalHash,
      "single-quoted absolute local provenance remains an exact installer profile"
    );

    for (const [label, source] of [
      ["name", `${remoteFrontmatter.replace(`name: ${canonicalFields.get("name")}`, `name: ${canonicalFields.get("name")}-changed`)}\n${body}`],
      ["description", `${remoteFrontmatter.replace(`description: ${canonicalFields.get("description")}`, `description: ${canonicalFields.get("description")} Changed.`)}\n${body}`],
      ["license", `${remoteFrontmatter.replace(`license: ${canonicalFields.get("license")}`, "license: Apache-2.0")}\n${body}`],
      ["body", `${remoteFrontmatter}\n${body}\nChanged policy body.\n`],
      ["extra separator blank line", `${remoteFrontmatter}\n\n\n${body}`],
      ["unknown root field", `${remoteFrontmatter.replace("---\n", "---\nallowed-tools: Bash\n")}\n${body}`],
      ["unknown metadata field", `${remoteFrontmatter.replace("    github-path:", "    allowed-tools: Bash\n    github-path:")}\n${body}`],
      ["duplicate root field", `${remoteFrontmatter.replace("---\n", `---\nname: ${canonicalFields.get("name")}\n`)}\n${body}`],
      ["mixed provenance", `${localFrontmatter.replace("    local-path:", "    github-path: skills/programmable-v4-hook-builder\n    local-path:")}\n${body}`],
      ["malformed provenance indentation", `${remoteFrontmatter.replace("    github-path:", "  github-path:")}\n${body}`],
      ["malformed local scalar", `${localFrontmatter.replace("/tmp/programmable-v4-hook-builder", "[unterminated")}\n${body}`],
      ["relative local path", `${localFrontmatter.replace("/tmp/programmable-v4-hook-builder", "relative/path")}\n${body}`],
      ["traversing GitHub path", `${remoteFrontmatter.replace("skills/programmable-v4-hook-builder", "skills/../programmable-v4-hook-builder")}\n${body}`],
      ["credentialed GitHub repository", `${remoteFrontmatter.replace("https://github.com/0xprogrammable/programmable", "https://token@github.com/0xprogrammable/programmable")}\n${body}`],
      ["unsafe Git ref", `${remoteFrontmatter.replace("    github-ref: 0123456789abcdef0123456789abcdef01234567", "    github-ref: refs/heads/main.lock")}\n${body}`],
      ["invalid tree SHA", `${remoteFrontmatter.replace("89abcdef0123456789abcdef0123456789abcdef", "89abcdef")}\n${body}`]
    ]) {
      assert.notEqual(hashSource(source), canonicalHash, `${label} must remain policy-bound or fail closed`);
    }

    assert.match(canonicalHash, /^sha256:[a-f0-9]{64}$/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

function validate(copiedSkill) {
  const submissionPath = path.join(copiedSkill, "assets", "templates", "submission.example.json");
  const validatorPath = path.join(copiedSkill, "scripts", "validate-submission.mjs");
  const result = childProcess.spawnSync(process.execPath, [validatorPath, submissionPath], {
    cwd: copiedSkill,
    encoding: "utf8",
    shell: false
  });

  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
