import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  analyzeSubmission,
  validateAgainstSchema
} from "../submission-core.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "..", "..");
const submissionSchema = JSON.parse(
  fs.readFileSync(path.join(skillRoot, "references", "submission.schema.json"), "utf8")
);
const submissionTemplate = JSON.parse(
  fs.readFileSync(path.join(skillRoot, "assets", "templates", "submission.example.json"), "utf8")
);

test("cyclic local references are rejected without recursive validation", () => {
  const schema = {
    $ref: "#/$defs/first",
    $defs: {
      first: { $ref: "#/$defs/second" },
      second: { $ref: "#/$defs/first" }
    }
  };

  const findings = validateAgainstSchema("value", schema);

  assert.deepEqual(
    findings.map(({ code }) => code),
    ["SCHEMA_REFERENCE_CYCLE"]
  );
});

test("excessive local reference chains are rejected at a fixed limit", () => {
  const definitions = {};
  for (let index = 0; index < 80; index += 1) {
    definitions[`step${index}`] = index === 79
      ? { type: "string" }
      : { $ref: `#/$defs/step${index + 1}` };
  }
  const schema = { $ref: "#/$defs/step0", $defs: definitions };

  const findings = validateAgainstSchema("value", schema);

  assert.deepEqual(
    findings.map(({ code }) => code),
    ["SCHEMA_REFERENCE_DEPTH_LIMIT"]
  );
});

test("schemas deeper than the deterministic traversal limit are rejected", () => {
  let schema = { type: "string" };
  for (let index = 0; index < 80; index += 1) {
    schema = {
      type: "object",
      properties: { child: schema }
    };
  }

  const findings = validateAgainstSchema({}, schema);

  assert.deepEqual(
    findings.map(({ code }) => code),
    ["SCHEMA_DEPTH_LIMIT"]
  );
});

test("schemas with excessive node counts are rejected before validation", () => {
  const properties = {};
  for (let index = 0; index < 5000; index += 1) {
    properties[`field${index}`] = { type: "string" };
  }

  const findings = validateAgainstSchema({}, {
    type: "object",
    properties
  });

  assert.deepEqual(
    findings.map(({ code }) => code),
    ["SCHEMA_NODE_LIMIT"]
  );
});

test("schema node limits include primitive array entries", () => {
  const findings = validateAgainstSchema("value", {
    enum: Array.from({ length: 9000 }, (_, index) => `value-${index}`)
  });

  assert.deepEqual(
    findings.map(({ code }) => code),
    ["SCHEMA_NODE_LIMIT"]
  );
});

test("structural schema keywords must use supported JSON shapes", () => {
  for (const schema of [
    { type: "object", required: "name" },
    { type: "object", properties: [] },
    { type: "array", items: "string" }
  ]) {
    const findings = validateAgainstSchema({}, schema);
    assert.deepEqual(
      findings.map(({ code }) => code),
      ["SCHEMA_KEYWORD_INVALID"],
      JSON.stringify(schema)
    );
  }
});

test("property names that match schema keywords remain ordinary fields", () => {
  const findings = validateAgainstSchema(
    { pattern: "literal", $ref: "literal" },
    {
      type: "object",
      additionalProperties: false,
      required: ["pattern", "$ref"],
      properties: {
        pattern: { type: "string" },
        $ref: { type: "string" }
      }
    }
  );

  assert.deepEqual(findings, []);
});

test("submission traversal has deterministic depth and node limits", () => {
  let deepValue = "leaf";
  for (let index = 0; index < 80; index += 1) deepValue = [deepValue];

  const deepFindings = validateAgainstSchema(deepValue, {});
  assert.deepEqual(
    deepFindings.map(({ code }) => code),
    ["SCHEMA_INSTANCE_DEPTH_LIMIT"]
  );

  const wideFindings = validateAgainstSchema(
    Array.from({ length: 50000 }, (_, index) => index),
    {}
  );
  assert.deepEqual(
    wideFindings.map(({ code }) => code),
    ["SCHEMA_INSTANCE_NODE_LIMIT"]
  );
});

test("unsafe and malformed patterns are rejected before RegExp execution", () => {
  const unsafe = validateAgainstSchema("aaaaaaaaaaaaaaaa!", {
    type: "string",
    pattern: "^(?:a+)+$"
  });
  assert.deepEqual(
    unsafe.map(({ code }) => code),
    ["SCHEMA_PATTERN_UNSAFE"]
  );

  const malformed = validateAgainstSchema("value", {
    type: "string",
    pattern: "^[abc$"
  });
  assert.deepEqual(
    malformed.map(({ code }) => code),
    ["SCHEMA_PATTERN_INVALID"]
  );

  const unanchored = validateAgainstSchema("value", {
    type: "string",
    pattern: "value"
  });
  assert.deepEqual(
    unanchored.map(({ code }) => code),
    ["SCHEMA_PATTERN_UNSAFE"]
  );

  const excessive = validateAgainstSchema("value", {
    type: "string",
    pattern: `^${"a".repeat(300)}$`
  });
  assert.deepEqual(
    excessive.map(({ code }) => code),
    ["SCHEMA_PATTERN_LIMIT"]
  );
});

test("pattern input is bounded before a permitted expression executes", () => {
  const findings = validateAgainstSchema("1".repeat(5000), {
    type: "string",
    pattern: "^[0-9]+$"
  });

  assert.deepEqual(
    findings.map(({ code }) => code),
    ["SCHEMA_PATTERN_INPUT_LIMIT"]
  );
});

test("candidate schemas cannot introduce an unreviewed pattern", () => {
  const findings = validateAgainstSchema("ABC", {
    type: "string",
    pattern: "^[A-Z]+$"
  });

  assert.deepEqual(
    findings.map(({ code }) => code),
    ["SCHEMA_PATTERN_UNSAFE"]
  );
});

test("character-class ranges cannot hide an ambiguous repeated delimiter", () => {
  for (const pattern of [
    "^(?:-[+-/]+)+$",
    "^(?:-[a\\-z]+)+$"
  ]) {
    const findings = validateAgainstSchema("-----!", {
      type: "string",
      pattern
    });

    assert.deepEqual(
      findings.map(({ code }) => code),
      ["SCHEMA_PATTERN_UNSAFE"],
      pattern
    );
  }
});

test("schema finding output is capped for adversarial object width", () => {
  const value = {};
  for (let index = 0; index < 500; index += 1) value[`field${index}`] = true;

  const findings = validateAgainstSchema(value, {
    type: "object",
    additionalProperties: false,
    properties: {}
  });

  assert.ok(findings.length <= 128, `received ${findings.length} findings`);
  assert.equal(findings.at(-1)?.code, "SCHEMA_FINDING_LIMIT");
});

test("inherited object keys cannot satisfy required or allowed properties", () => {
  const missingRequired = validateAgainstSchema({}, {
    type: "object",
    required: ["toString"],
    additionalProperties: false,
    properties: {
      toString: { type: "string" }
    }
  });
  assert.deepEqual(
    missingRequired.map(({ code, path }) => [code, path]),
    [["SCHEMA_REQUIRED", "$.toString"]]
  );

  const unexpectedProperty = validateAgainstSchema({ toString: "spoofed" }, {
    type: "object",
    additionalProperties: false,
    properties: {}
  });
  assert.deepEqual(
    unexpectedProperty.map(({ code, path }) => [code, path]),
    [["SCHEMA_ADDITIONAL_PROPERTY", "$.toString"]]
  );
});

for (const [label, mutate, expectedCode] of [
  ["non-object root", () => "invalid", "SCHEMA_TYPE"],
  ["missing required section", (value) => {
    delete value.model;
    return value;
  }, "SCHEMA_REQUIRED"],
  ["wrong nested type", (value) => {
    value.assets = {};
    return value;
  }, "SCHEMA_TYPE"],
  ["unexpected field", (value) => {
    value.unexpected = true;
    return value;
  }, "SCHEMA_ADDITIONAL_PROPERTY"]
]) {
  test(`analysis stops at a concise schema report for ${label}`, () => {
    const submission = mutate(structuredClone(submissionTemplate));

    const report = analyzeSubmission(submission, { schema: submissionSchema });

    assert.equal(report.decision, "REDESIGN_REQUIRED");
    assert.ok(report.findings.some(({ code }) => code === expectedCode));
    assert.ok(report.findings.every(({ code }) => code.startsWith("SCHEMA_")));
    assert.equal(report.requiredGates.length, 0);
    assert.equal(report.hookPermissionMask, null);
    assert.equal(report.risk.score, null);
  });
}

test("schema-valid submissions retain the complete semantic review", () => {
  const submission = structuredClone(submissionTemplate);
  submission.security.usesTxOrigin = true;

  const report = analyzeSubmission(submission, { schema: submissionSchema });

  assert.ok(!report.findings.some(({ code }) => code.startsWith("SCHEMA_")));
  assert.ok(report.findings.some(({ code }) => code === "TX_ORIGIN_AUTHORIZATION"));
  assert.ok(report.findings.some(({ code }) => code === "UNRESOLVED_DECISION"));
  assert.ok(report.requiredGates.length > 0);
});
