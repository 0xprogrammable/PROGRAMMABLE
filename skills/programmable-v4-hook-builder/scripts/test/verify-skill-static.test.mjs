import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "..", "..");
const verifier = path.join(skillRoot, "scripts", "verify-skill.mjs");

function insertAfterFrontmatterDescription(source, fragment) {
  return source.replace(
    /^description:.*$/m,
    (description) => `${description}\n${fragment}`
  );
}

test("trusted verifier validates a candidate skill as data without executing its tests", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-static-skill-"));
  const candidateRoot = path.join(fixtureRoot, "programmable-v4-hook-builder");

  try {
    fs.cpSync(skillRoot, candidateRoot, { recursive: true });
    fs.writeFileSync(
      path.join(candidateRoot, "scripts", "test", "must-not-run.test.mjs"),
      'throw new Error("candidate test code executed");\n'
    );
    const result = childProcess.spawnSync(
      process.execPath,
      [verifier, "--skill-root", candidateRoot, "--untrusted-data"],
      { encoding: "utf8", shell: false }
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /without executing candidate scripts or tests/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("non-canonical skill roots fail closed before candidate tests can execute", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-static-skill-fail-closed-"));
  const candidateRoot = path.join(fixtureRoot, "programmable-v4-hook-builder");
  const markerPath = path.join(fixtureRoot, "candidate-test-executed");

  try {
    fs.cpSync(skillRoot, candidateRoot, { recursive: true });
    fs.writeFileSync(
      path.join(candidateRoot, "scripts", "test", "marker.test.mjs"),
      `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(markerPath)}, "executed\\n");\n`
    );

    const result = childProcess.spawnSync(
      process.execPath,
      [verifier, "--skill-root", candidateRoot],
      { encoding: "utf8", shell: false }
    );

    assert.equal(result.status, 2, result.stdout);
    assert.match(result.stderr, /non-canonical --skill-root requires --untrusted-data/);
    assert.equal(fs.existsSync(markerPath), false);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

for (const requiredPath of [
  "references/companion-manifest-v2.schema.json",
  "references/companion-manifests.md",
  "references/official-model-patterns.md",
  "references/routing-and-discovery.md",
  "references/runtime-assets-v1.schema.json",
  "references/runtime-assets.md",
  "references/workflow.md",
  "assets/examples/transparent-pool-scoped-fee.json",
  "assets/templates/no-hook-architecture.example.json",
  "assets/templates/runtime-assets.example.json",
  "assets/templates/companion-closure-workflow.yml",
  "assets/templates/companion-manifest-v2.example.json",
  "scripts/build-info-core.mjs",
  "scripts/check-upstream-drift.mjs",
  "scripts/companion-manifest-contract.mjs",
  "scripts/example-materializer-core.mjs",
  "scripts/github-exact-object-resolver.mjs",
  "scripts/github-public-source-core.mjs",
  "scripts/metadata-core.mjs",
  "scripts/public-claims-core.mjs",
  "scripts/runtime-assets-core.mjs",
  "scripts/verify-skill.mjs",
  "scripts/test/cross-chain-policy.test.mjs",
  "scripts/test/companion-manifest-v2.test.mjs",
  "scripts/test/schema-security.test.mjs",
  "scripts/test/verify-package-build-info.test.mjs"
]) {
  test(`trusted verifier requires ${requiredPath}`, () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-static-skill-required-"));
    const candidateRoot = path.join(fixtureRoot, "programmable-v4-hook-builder");

    try {
      fs.cpSync(skillRoot, candidateRoot, { recursive: true });
      fs.rmSync(path.join(candidateRoot, requiredPath));

      const result = runUntrustedVerifier(candidateRoot);

      assert.notEqual(result.status, 0, result.stdout);
      assert.match(result.stderr, new RegExp(`missing ${escapeRegExp(requiredPath)}`));
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
}

test("trusted verifier rejects a symlinked skill root without resolving it", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-static-skill-root-link-"));
  const realParent = path.join(fixtureRoot, "real");
  const linkParent = path.join(fixtureRoot, "link");
  const realRoot = path.join(realParent, "programmable-v4-hook-builder");
  const candidateRoot = path.join(linkParent, "programmable-v4-hook-builder");

  try {
    fs.mkdirSync(realParent, { recursive: true });
    fs.mkdirSync(linkParent, { recursive: true });
    fs.cpSync(skillRoot, realRoot, { recursive: true });
    fs.symlinkSync(realRoot, candidateRoot, "dir");

    const result = runUntrustedVerifier(candidateRoot);

    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /skill root may not be a symbolic link/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("trusted verifier rejects a symlinked parent between the candidate checkout and skill root", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-static-skill-parent-link-"));
  const candidateCheckout = path.join(fixtureRoot, "candidate");
  const externalSkills = path.join(fixtureRoot, "external-skills");
  const candidateRoot = path.join(candidateCheckout, "skills", "programmable-v4-hook-builder");

  try {
    fs.mkdirSync(candidateCheckout, { recursive: true });
    fs.mkdirSync(externalSkills, { recursive: true });
    fs.cpSync(skillRoot, path.join(externalSkills, "programmable-v4-hook-builder"), { recursive: true });
    fs.symlinkSync(externalSkills, path.join(candidateCheckout, "skills"), "dir");

    const result = runUntrustedVerifier(candidateRoot);

    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /skill root path contains a symbolic link: skills/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("trusted verifier stops at a package symlink before reading its target", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-static-skill-file-link-"));
  const candidateRoot = path.join(fixtureRoot, "programmable-v4-hook-builder");
  const externalSkill = path.join(fixtureRoot, "external-skill.md");

  try {
    fs.cpSync(skillRoot, candidateRoot, { recursive: true });
    const localPath = ["", "Users", "private", ""].join("/");
    fs.writeFileSync(externalSkill, `This file has no frontmatter and mentions ${localPath}.\n`);
    fs.rmSync(path.join(candidateRoot, "SKILL.md"));
    fs.symlinkSync(externalSkill, path.join(candidateRoot, "SKILL.md"));

    const result = runUntrustedVerifier(candidateRoot);

    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /symbolic links are not allowed: SKILL\.md/);
    assert.doesNotMatch(result.stderr, /frontmatter|local filesystem path/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("trusted verifier stops at an intermediate directory symlink before parsing files below it", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-static-skill-directory-link-"));
  const candidateRoot = path.join(fixtureRoot, "programmable-v4-hook-builder");
  const externalReferences = path.join(fixtureRoot, "external-references");

  try {
    fs.cpSync(skillRoot, candidateRoot, { recursive: true });
    fs.renameSync(path.join(candidateRoot, "references"), externalReferences);
    fs.writeFileSync(path.join(externalReferences, "submission.schema.json"), "not JSON\n");
    fs.symlinkSync(externalReferences, path.join(candidateRoot, "references"), "dir");

    const result = runUntrustedVerifier(candidateRoot);

    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /symbolic links are not allowed: references/);
    assert.doesNotMatch(result.stderr, /schema or template JSON/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("trusted verifier rejects an oversized SKILL file before reading it", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-static-skill-oversized-skill-"));
  const candidateRoot = path.join(fixtureRoot, "programmable-v4-hook-builder");

  try {
    fs.cpSync(skillRoot, candidateRoot, { recursive: true });
    fs.writeFileSync(path.join(candidateRoot, "SKILL.md"), `No frontmatter\n${"x".repeat(1_000_000)}`);

    const result = runUntrustedVerifier(candidateRoot);

    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /SKILL\.md exceeds the 1000000-byte per-file limit/);
    assert.doesNotMatch(result.stderr, /frontmatter/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("trusted verifier rejects an oversized interface file before parsing it", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-static-skill-oversized-interface-"));
  const candidateRoot = path.join(fixtureRoot, "programmable-v4-hook-builder");

  try {
    fs.cpSync(skillRoot, candidateRoot, { recursive: true });
    fs.writeFileSync(path.join(candidateRoot, "agents", "openai.yaml"), `not an interface\n${"x".repeat(1_000_000)}`);

    const result = runUntrustedVerifier(candidateRoot);

    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /agents\/openai\.yaml exceeds the 1000000-byte per-file limit/);
    assert.doesNotMatch(result.stderr, /missing display_name|missing short_description|missing default_prompt/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("trusted verifier rejects an oversized package before scanning its text", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-static-skill-oversized-package-"));
  const candidateRoot = path.join(fixtureRoot, "programmable-v4-hook-builder");
  const localPath = ["", "Users", "private", ""].join("/");

  try {
    fs.cpSync(skillRoot, candidateRoot, { recursive: true });
    for (let index = 0; index < 9; index += 1) {
      const prefix = index === 0 ? `${localPath}\n` : "";
      fs.writeFileSync(
        path.join(candidateRoot, "assets", `large-${index}.txt`),
        `${prefix}${"x".repeat(900_000 - prefix.length)}`
      );
    }

    const result = runUntrustedVerifier(candidateRoot);

    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /portable package is \d+ bytes; keep it at or below 8000000/);
    assert.doesNotMatch(result.stderr, /local filesystem path/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("trusted verifier rejects excessive file count before checking candidate script syntax", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-static-skill-file-count-"));
  const candidateRoot = path.join(fixtureRoot, "programmable-v4-hook-builder");

  try {
    fs.cpSync(skillRoot, candidateRoot, { recursive: true });
    for (let index = 0; index < 260; index += 1) {
      fs.writeFileSync(path.join(candidateRoot, "assets", `count-${index}.txt`), "\n");
    }
    fs.writeFileSync(path.join(candidateRoot, "scripts", "invalid-syntax.mjs"), "export const = ;\n");

    const result = runUntrustedVerifier(candidateRoot);

    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /portable package has \d+ files; keep it at or below 256/);
    assert.doesNotMatch(result.stderr, /invalid-syntax|SyntaxError/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("candidate schema references cannot weaken trusted example validation", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-static-skill-schema-ref-"));
  const candidateRoot = path.join(fixtureRoot, "programmable-v4-hook-builder");

  try {
    fs.cpSync(skillRoot, candidateRoot, { recursive: true });
    fs.writeFileSync(
      path.join(candidateRoot, "references", "submission.schema.json"),
      `${JSON.stringify({
        $ref: "#/$defs/permissive",
        $defs: { permissive: { type: "object" } }
      }, null, 2)}\n`
    );
    const examplePath = path.join(candidateRoot, "assets", "templates", "submission.example.json");
    const example = JSON.parse(fs.readFileSync(examplePath, "utf8"));
    example.model.id = "NOT A VALID MODEL ID";
    fs.writeFileSync(examplePath, `${JSON.stringify(example, null, 2)}\n`);

    const result = runUntrustedVerifier(candidateRoot);

    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /template \$\.model\.id: Text does not match the required format/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("candidate schema regex is parsed as data and never executed", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-static-skill-schema-regex-"));
  const candidateRoot = path.join(fixtureRoot, "programmable-v4-hook-builder");

  try {
    fs.cpSync(skillRoot, candidateRoot, { recursive: true });
    const schemaPath = path.join(candidateRoot, "references", "submission.schema.json");
    const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
    schema.properties.model.properties.id.pattern = "(";
    fs.writeFileSync(schemaPath, `${JSON.stringify(schema, null, 2)}\n`);

    const result = runUntrustedVerifier(candidateRoot);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.doesNotMatch(result.stderr, /Invalid regular expression/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

for (const [label, mutate] of [
  [
    "an inline host policy hidden below metadata",
    (source) => insertAfterFrontmatterDescription(
      source,
      'metadata: {"allowed-tools": "shell"}'
    )
  ],
  [
    "a quoted host-policy key",
    (source) => insertAfterFrontmatterDescription(
      source,
      '"allowed\\u002dtools": "shell"'
    )
  ],
  [
    "an inherited root key",
    (source) => insertAfterFrontmatterDescription(source, "constructor: bypass")
  ],
  [
    "an inherited root setter key",
    (source) => insertAfterFrontmatterDescription(source, "__proto__: bypass")
  ],
  [
    "an inherited nested key",
    (source) => insertAfterFrontmatterDescription(
      source,
      "metadata:\n  constructor: bypass"
    )
  ],
  [
    "an inherited nested setter key",
    (source) => insertAfterFrontmatterDescription(
      source,
      "metadata:\n  __proto__: bypass"
    )
  ],
  [
    "a custom YAML tag",
    (source) => source.replace(
      "description: Use when",
      "description: !host-policy Use when"
    )
  ],
  [
    "an anchor",
    (source) => source.replace(
      "name: programmable-v4-hook-builder",
      "name: &shared programmable-v4-hook-builder"
    )
  ],
  [
    "a duplicate key",
    (source) => source.replace(
      "description: Use when",
      "name: programmable-v4-hook-builder\ndescription: Use when"
    )
  ],
  [
    "a non-string description",
    (source) => source.replace(
      /^description:.*$/m,
      "description: true"
    )
  ],
  [
    "an unterminated quoted scalar",
    (source) => source.replace(
      "name: programmable-v4-hook-builder",
      'name: "programmable-v4-hook-builder'
    )
  ]
]) {
  test(`trusted verifier rejects SKILL.md with ${label}`, () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-static-skill-yaml-"));
    const candidateRoot = path.join(fixtureRoot, "programmable-v4-hook-builder");

    try {
      fs.cpSync(skillRoot, candidateRoot, { recursive: true });
      const skillPath = path.join(candidateRoot, "SKILL.md");
      fs.writeFileSync(skillPath, mutate(fs.readFileSync(skillPath, "utf8")));

      const result = runUntrustedVerifier(candidateRoot);

      assert.notEqual(result.status, 0, result.stdout);
      assert.match(result.stderr, /SKILL\.md frontmatter:/);
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
}

for (const [label, mutate] of [
  [
    "an inline dependency policy",
    (source) => `${source}dependencies: {tools: [{type: "mcp", value: "wallet"}]}\n`
  ],
  [
    "a quoted dependency key",
    (source) => `${source}"depend\\u0065ncies": {"tools": []}\n`
  ],
  [
    "an inherited nested key",
    (source) => source.replace(
      '  short_description: "Build and check open-ended Uniswap v4 projects"',
      '  constructor: "bypass"\n  short_description: "Build and check open-ended Uniswap v4 projects"'
    )
  ],
  [
    "a custom YAML tag",
    (source) => source.replace(
      'display_name: "Programmable v4 Builder"',
      'display_name: !host-policy "Programmable v4 Builder"'
    )
  ],
  [
    "an anchor",
    (source) => source.replace(
      'display_name: "Programmable v4 Builder"',
      'display_name: &shared "Programmable v4 Builder"'
    )
  ],
  [
    "a merge key",
    (source) => source.replace(
      '  display_name: "Programmable v4 Builder"',
      "  <<: *shared\n  display_name: \"Programmable v4 Builder\""
    )
  ],
  [
    "a duplicate key",
    (source) => source.replace(
      '  short_description: "Build and check open-ended Uniswap v4 projects"',
      '  display_name: "Duplicate"\n  short_description: "Build and check open-ended Uniswap v4 projects"'
    )
  ],
  [
    "a non-string interface value",
    (source) => source.replace(
      'display_name: "Programmable v4 Builder"',
      "display_name: true"
    )
  ],
  [
    "an unsupported nested key",
    (source) => source.replace(
      '  short_description: "Build and check open-ended Uniswap v4 projects"',
      '  custom_policy: "allow"\n  short_description: "Build and check open-ended Uniswap v4 projects"'
    )
  ],
  [
    "an unterminated quoted scalar",
    (source) => source.replace(
      'display_name: "Programmable v4 Builder"',
      'display_name: "Programmable v4 Builder'
    )
  ]
]) {
  test(`trusted verifier rejects agents/openai.yaml with ${label}`, () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-static-agent-yaml-"));
    const candidateRoot = path.join(fixtureRoot, "programmable-v4-hook-builder");

    try {
      fs.cpSync(skillRoot, candidateRoot, { recursive: true });
      const interfacePath = path.join(candidateRoot, "agents", "openai.yaml");
      fs.writeFileSync(interfacePath, mutate(fs.readFileSync(interfacePath, "utf8")));

      const result = runUntrustedVerifier(candidateRoot);

      assert.notEqual(result.status, 0, result.stdout);
      assert.match(result.stderr, /agents\/openai\.yaml:/);
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
}

test("trusted verifier accepts supported optional metadata fields as strings", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-static-canonical-yaml-"));
  const candidateRoot = path.join(fixtureRoot, "programmable-v4-hook-builder");

  try {
    fs.cpSync(skillRoot, candidateRoot, { recursive: true });
    const skillPath = path.join(candidateRoot, "SKILL.md");
    fs.writeFileSync(
      skillPath,
      insertAfterFrontmatterDescription(
        fs.readFileSync(skillPath, "utf8"),
        "metadata:\n  short-description: Build and review v4 launch models"
      )
    );
    const interfacePath = path.join(candidateRoot, "agents", "openai.yaml");
    fs.writeFileSync(
      interfacePath,
      fs.readFileSync(interfacePath, "utf8").replace(
        '  default_prompt: "',
        '  brand_color: "#E76BAA"\n  default_prompt: "'
      )
    );

    const result = runUntrustedVerifier(candidateRoot);

    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("installed verifier accepts current pinned gh skill GitHub provenance", () => {
  const fixture = materializeInstalledSkill([
    "github-path: skills/programmable-v4-hook-builder",
    "github-pinned: 3cd1378ae17542e3a1ab73771da272af567fbe15",
    "github-ref: 3cd1378ae17542e3a1ab73771da272af567fbe15",
    "github-repo: https://github.com/0xprogrammable/programmable",
    "github-tree-sha: cd0a64bc1a575a6e49ca594181088ecce3d4a643"
  ]);

  try {
    const result = runInstalledVerifier(fixture.skillRoot);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Validated portable skill structure/);
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true });
  }
});

test("installed verifier accepts current unpinned gh skill GitHub provenance", () => {
  const fixture = materializeInstalledSkill([
    "github-path: products/hooks/skills/programmable-v4-hook-builder",
    "github-ref: v1.0.0",
    "github-repo: https://github.com/0xprogrammable/programmable",
    "github-tree-sha: 89abcdef0123456789abcdef0123456789abcdef"
  ]);

  try {
    const result = runInstalledVerifier(fixture.skillRoot);

    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true });
  }
});

test("trusted untrusted-data verifier does not accept installer provenance as source policy", () => {
  const fixture = materializeInstalledSkill([
    "github-path: skills/programmable-v4-hook-builder",
    "github-ref: main",
    "github-repo: https://github.com/0xprogrammable/programmable",
    "github-tree-sha: 89abcdef0123456789abcdef0123456789abcdef"
  ]);

  try {
    const result = runUntrustedVerifier(fixture.skillRoot);

    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /SKILL\.md frontmatter:/);
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true });
  }
});

test("installed verifier accepts gh skill local provenance but still scans all other bytes", () => {
  const fixture = materializeInstalledSkill([
    `local-path: ${macAbsolutePath("example", "projects", "programmable", "skills", "programmable-v4-hook-builder")}`
  ]);

  try {
    const accepted = runInstalledVerifier(fixture.skillRoot);
    assert.equal(accepted.status, 0, accepted.stderr || accepted.stdout);

    fs.appendFileSync(
      path.join(fixture.skillRoot, "SKILL.md"),
      `\nThe installed package must not disclose ${macAbsolutePath("example", "private", "source")} outside provenance.\n`
    );
    const rejected = runInstalledVerifier(fixture.skillRoot);

    assert.notEqual(rejected.status, 0, rejected.stdout);
    assert.match(rejected.stderr, /SKILL\.md: portable package contains a local filesystem path/);
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true });
  }
});

test("installed verifier accepts gh skill single-quoted local provenance", () => {
  const localPath = macAbsolutePath(
    "example",
    "Builder's Projects",
    "programmable-v4-hook-builder"
  );
  const fixture = materializeInstalledSkill([
    `local-path: '${localPath.replaceAll("'", "''")}'`
  ]);

  try {
    const result = runInstalledVerifier(fixture.skillRoot);

    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true });
  }
});

for (const [label, metadataLines, expected] of [
  [
    "a policy key",
    [
      "github-path: skills/programmable-v4-hook-builder",
      "github-ref: main",
      "github-repo: https://github.com/0xprogrammable/programmable",
      "github-tree-sha: 0123456789abcdef0123456789abcdef01234567",
      "allowed-tools: shell"
    ],
    /unsupported key allowed-tools/
  ],
  [
    "a custom YAML tag",
    [
      "github-path: skills/programmable-v4-hook-builder",
      "github-ref: !host-policy main",
      "github-repo: https://github.com/0xprogrammable/programmable",
      "github-tree-sha: 0123456789abcdef0123456789abcdef01234567"
    ],
    /non-canonical plain string/
  ],
  [
    "a YAML anchor",
    [
      "github-path: skills/programmable-v4-hook-builder",
      "github-ref: &shared main",
      "github-repo: https://github.com/0xprogrammable/programmable",
      "github-tree-sha: 0123456789abcdef0123456789abcdef01234567"
    ],
    /non-canonical plain string/
  ],
  [
    "a duplicate provenance key",
    [
      "github-path: skills/programmable-v4-hook-builder",
      "github-ref: main",
      "github-ref: release",
      "github-repo: https://github.com/0xprogrammable/programmable",
      "github-tree-sha: 0123456789abcdef0123456789abcdef01234567"
    ],
    /duplicates key github-ref/
  ],
  [
    "mixed local and remote provenance",
    [
      "github-path: skills/programmable-v4-hook-builder",
      "github-ref: main",
      "github-repo: https://github.com/0xprogrammable/programmable",
      "github-tree-sha: 0123456789abcdef0123456789abcdef01234567",
      `local-path: ${macAbsolutePath("example", "projects", "programmable-v4-hook-builder")}`
    ],
    /installed metadata must be exactly local-path or the GitHub repository/
  ],
  [
    "a repository URL with credentials",
    [
      "github-path: skills/programmable-v4-hook-builder",
      "github-ref: main",
      "github-repo: https://user@github.com/0xprogrammable/programmable",
      "github-tree-sha: 0123456789abcdef0123456789abcdef01234567"
    ],
    /github-repo must be a canonical HTTPS GitHub repository URL/
  ],
  [
    "a traversing GitHub path",
    [
      "github-path: skills/../programmable-v4-hook-builder",
      "github-ref: main",
      "github-repo: https://github.com/0xprogrammable/programmable",
      "github-tree-sha: 0123456789abcdef0123456789abcdef01234567"
    ],
    /github-path must be a normalized relative path/
  ],
  [
    "a relative local provenance path",
    ["local-path: projects/programmable-v4-hook-builder"],
    /local-path must be an absolute filesystem path/
  ],
  [
    "oversized local provenance",
    [`local-path: ${macAbsolutePath("example", "a".repeat(4096))}`],
    /exceeds the 4096-byte provenance limit/
  ]
]) {
  test(`installed verifier rejects ${label}`, () => {
    const fixture = materializeInstalledSkill(metadataLines);

    try {
      const result = runInstalledVerifier(fixture.skillRoot);

      assert.notEqual(result.status, 0, result.stdout);
      assert.match(result.stderr, expected);
    } finally {
      fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true });
    }
  });
}

function materializeInstalledSkill(metadataLines) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-installed-skill-"));
  const installedSkillRoot = path.join(fixtureRoot, "programmable-v4-hook-builder");
  fs.cpSync(skillRoot, installedSkillRoot, { recursive: true });

  const skillPath = path.join(installedSkillRoot, "SKILL.md");
  const source = fs.readFileSync(skillPath, "utf8");
  const frontmatter = source.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(frontmatter, "canonical skill fixture must have frontmatter");
  const lines = frontmatter[1].split("\n");
  const rootLine = (key) => {
    const line = lines.find((candidate) => candidate.startsWith(`${key}:`));
    assert.ok(line, `canonical skill fixture must declare ${key}`);
    return line;
  };
  const body = source.slice(frontmatter[0].length).replace(/^(?:\r?\n)+/u, "");
  const installedFrontmatter = [
    "---",
    rootLine("description"),
    rootLine("license"),
    "metadata:",
    ...metadataLines.map((line) => `    ${line}`),
    rootLine("name"),
    "---"
  ].join("\n");
  fs.writeFileSync(skillPath, `${installedFrontmatter}\n${body}`);

  return { fixtureRoot, skillRoot: installedSkillRoot };
}

function runInstalledVerifier(installedSkillRoot) {
  return childProcess.spawnSync(
    process.execPath,
    [path.join(installedSkillRoot, "scripts", "verify-skill.mjs"), "--installed"],
    { cwd: installedSkillRoot, encoding: "utf8", shell: false }
  );
}

function macAbsolutePath(...segments) {
  return ["", "Users", ...segments].join("/");
}

function runUntrustedVerifier(candidateRoot) {
  return childProcess.spawnSync(
    process.execPath,
    [verifier, "--skill-root", candidateRoot, "--untrusted-data"],
    { encoding: "utf8", shell: false }
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
