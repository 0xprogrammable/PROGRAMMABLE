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

test("every supported composition and conditional keyword is enforced", () => {
  const schema = {
    type: "object",
    required: ["mode", "value"],
    properties: {
      mode: { enum: ["text", "number"] },
      value: {}
    },
    allOf: [
      {
        if: {
          properties: { mode: { const: "text" } },
          required: ["mode"]
        },
        then: { properties: { value: { type: "string", minLength: 2 } } },
        else: { properties: { value: { type: "number", minimum: 1 } } }
      }
    ],
    additionalProperties: false
  };

  assert.deepEqual(validateAgainstSchema({ mode: "text", value: "ok" }, schema), []);
  assert.ok(validateAgainstSchema({ mode: "text", value: 2 }, schema).some(({ code }) => code === "SCHEMA_TYPE"));
  assert.ok(validateAgainstSchema({ mode: "number", value: 0 }, schema).some(({ code }) => code === "SCHEMA_MINIMUM"));

  assert.ok(validateAgainstSchema("x", {
    anyOf: [{ const: "a" }, { const: "b" }]
  }).some(({ code }) => code === "SCHEMA_ANY_OF"));
  assert.ok(validateAgainstSchema(2, {
    oneOf: [{ type: "number" }, { type: "integer" }]
  }).some(({ code }) => code === "SCHEMA_ONE_OF"));
  assert.ok(validateAgainstSchema("forbidden", {
    not: { const: "forbidden" }
  }).some(({ code }) => code === "SCHEMA_NOT"));
});

test("array tuple and contains constraints cannot be silently ignored", () => {
  const tupleSchema = {
    type: "array",
    prefixItems: [{ type: "string" }, { type: "integer" }],
    items: false
  };
  assert.deepEqual(validateAgainstSchema(["scope", 1], tupleSchema), []);
  assert.ok(validateAgainstSchema(["scope", 1, true], tupleSchema).some(({ code }) => code === "SCHEMA_FALSE"));

  const containsSchema = {
    type: "array",
    contains: { const: "covered" },
    minContains: 2,
    maxContains: 2
  };
  assert.ok(validateAgainstSchema(["covered"], containsSchema).some(({ code }) => code === "SCHEMA_MIN_CONTAINS"));
  assert.deepEqual(validateAgainstSchema(["covered", "covered"], containsSchema), []);
  assert.ok(validateAgainstSchema(["covered", "covered", "covered"], containsSchema).some(({ code }) => code === "SCHEMA_MAX_CONTAINS"));
});

test("object, numeric, format and additional-property constraints are enforced", () => {
  const objectSchema = {
    type: "object",
    minProperties: 1,
    maxProperties: 2,
    propertyNames: { type: "string", pattern: "^[a-z][a-z0-9-]*$" },
    additionalProperties: { type: "integer", minimum: 0 }
  };
  assert.ok(validateAgainstSchema({}, objectSchema).some(({ code }) => code === "SCHEMA_MIN_PROPERTIES"));
  assert.ok(validateAgainstSchema({ Bad: 1 }, objectSchema).some(({ code }) => code === "SCHEMA_PATTERN"));
  assert.ok(validateAgainstSchema({ valid: -1 }, objectSchema).some(({ code }) => code === "SCHEMA_MINIMUM"));
  assert.ok(validateAgainstSchema({ a: 1, b: 2, c: 3 }, objectSchema).some(({ code }) => code === "SCHEMA_MAX_PROPERTIES"));

  assert.deepEqual(validateAgainstSchema(0.3, { type: "number", multipleOf: 0.1 }), []);
  assert.ok(validateAgainstSchema(0.31, { type: "number", multipleOf: 0.1 }).some(({ code }) => code === "SCHEMA_MULTIPLE_OF"));
  assert.ok(validateAgainstSchema(1e21, { type: "number", multipleOf: 3 }).some(({ code }) => code === "SCHEMA_MULTIPLE_OF"));
  assert.ok(validateAgainstSchema(1, { exclusiveMinimum: 1 }).some(({ code }) => code === "SCHEMA_EXCLUSIVE_MINIMUM"));
  assert.ok(validateAgainstSchema(2, { exclusiveMaximum: 2 }).some(({ code }) => code === "SCHEMA_EXCLUSIVE_MAXIMUM"));

  assert.deepEqual(validateAgainstSchema("ipfs://bafybeigdyrzt", { type: "string", format: "uri" }), []);
  assert.ok(validateAgainstSchema("relative/path", { type: "string", format: "uri" }).some(({ code }) => code === "SCHEMA_URI"));
  assert.deepEqual(validateAgainstSchema("2024-02-29T23:59:59+01:00", { type: "string", format: "date-time" }), []);
  assert.ok(validateAgainstSchema("2023-02-29T23:59:59Z", { type: "string", format: "date-time" }).some(({ code }) => code === "SCHEMA_DATE_TIME"));
});

test("unsupported schema keywords fail closed instead of becoming decorative", () => {
  const findings = validateAgainstSchema({}, {
    type: "object",
    dependentRequired: { feePolicy: ["markets"] }
  });

  assert.deepEqual(
    findings.map(({ code }) => code),
    ["SCHEMA_KEYWORD_UNSUPPORTED"]
  );
});

test("validation-budget exhaustion is sticky across conditional branches", () => {
  const expensiveBranch = () => ({
    type: "array",
    allOf: Array.from({ length: 1300 }, () => ({
      items: { type: "number" }
    }))
  });
  const value = Array.from({ length: 100 }, (_, index) => index);

  for (const schema of [
    { if: expensiveBranch(), then: false },
    { oneOf: [expensiveBranch(), true] },
    { not: expensiveBranch() }
  ]) {
    const findings = validateAgainstSchema(value, schema);
    assert.deepEqual(
      findings.map(({ code }) => code),
      ["SCHEMA_VALIDATION_STEP_LIMIT"]
    );
  }
});

test("local references may resolve to a boolean schema", () => {
  const findings = validateAgainstSchema("anything", {
    $ref: "#/$defs/denied",
    $defs: { denied: false }
  });

  assert.ok(findings.some(({ code }) => code === "SCHEMA_FALSE"));
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
