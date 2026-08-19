#!/usr/bin/env node

import process from "node:process";
import path from "node:path";
import {
  loadSemanticRuleRegistry,
  validateSemanticRuleRegistry
} from "./semantic-rule-registry-core.mjs";

try {
  const args = process.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== "--skill-root")) {
    throw new Error("usage: validate-semantic-rule-registry.mjs [--skill-root <path>]");
  }
  const skillRoot = args.length === 2 ? path.resolve(args[1]) : undefined;
  const validation = validateSemanticRuleRegistry(loadSemanticRuleRegistry(skillRoot), { skillRoot });
  process.stdout.write(`${JSON.stringify(validation, null, 2)}\n`);
  if (validation.status !== "SEMANTIC_RULE_REGISTRY_VALID") process.exitCode = 1;
} catch (error) {
  const code = typeof error?.code === "string" ? `${error.code}: ` : "";
  process.stderr.write(`${code}${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
