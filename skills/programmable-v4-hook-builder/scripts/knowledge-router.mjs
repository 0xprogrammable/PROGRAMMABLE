#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { describeKnowledgeSelectors, KnowledgeRouterError, planKnowledge } from "./knowledge-router-core.mjs";
import { openOfflineRegistry, RegistryDiscoveryError, showRegistryProject } from "./registry-discovery-core.mjs";
import { canonicalJson } from "./template-catalog-core.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const maximumTemplatePlanBytes = 1_048_576;

try {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    process.stdout.write(help());
  } else {
    const options = parseArgs(args);
    const templatePlanInput = options.templatePlan === null
      ? { templatePlan: null, templatePlanSplitReview: null }
      : await readTemplatePlan(options.templatePlan);
    const registryProjectInput = await loadRegistryProjects(options.registryProjects);
    const result = planKnowledge({
      mode: options.mode,
      templatePlan: templatePlanInput.templatePlan,
      templatePlanSplitReview: templatePlanInput.templatePlanSplitReview,
      packs: options.packs,
      capabilities: options.capabilities,
      surfaces: options.surfaces,
      registryProjects: registryProjectInput.registryProjects,
      registryProjectSplitReview: registryProjectInput.registryProjectSplitReview,
      skillRoot
    });
    process.stdout.write(`${canonicalJson({ schemaVersion: "1.0.0", ok: true, command: "context", result })}\n`);
  }
} catch (error) {
  const code = error instanceof KnowledgeRouterError || error instanceof RegistryDiscoveryError
    ? error.code
    : "KNOWLEDGE_ROUTER_FAILED";
  const output = {
    schemaVersion: "1.0.0",
    ok: false,
    command: "context",
    error: {
      code,
      message: error instanceof Error ? error.message : String(error)
    }
  };
  if ((error instanceof KnowledgeRouterError || error instanceof RegistryDiscoveryError) && error.details !== undefined) output.error.details = error.details;
  process.stdout.write(`${canonicalJson(output)}\n`);
  process.exitCode = code === "USAGE_ERROR" || code === "KNOWLEDGE_MODE_INVALID" || code === "KNOWLEDGE_INPUT_INVALID" || code === "KNOWLEDGE_PACK_INVALID" || code === "KNOWLEDGE_ROUTE_FAMILY_AMBIGUOUS" || code === "REGISTRY_QUERY_INVALID" ? 2 : 1;
}

function parseArgs(args) {
  const options = { mode: null, templatePlan: null, packs: [], capabilities: [], surfaces: [], registryProjects: [] };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--mode") {
      if (options.mode !== null) usageError("--mode may be provided only once.");
      options.mode = requireValue(args, ++index, "--mode");
    } else if (argument === "--template-plan") {
      if (options.templatePlan !== null) usageError("--template-plan may be provided only once.");
      options.templatePlan = requireValue(args, ++index, "--template-plan");
    } else if (argument === "--capability") {
      options.capabilities.push(requireValue(args, ++index, "--capability"));
    } else if (argument === "--pack") {
      options.packs.push(requireValue(args, ++index, "--pack"));
    } else if (argument === "--surface") {
      options.surfaces.push(requireValue(args, ++index, "--surface"));
    } else if (argument === "--registry-project") {
      options.registryProjects.push(requireValue(args, ++index, "--registry-project"));
    } else {
      usageError(`Unknown argument: ${argument}.`);
    }
  }
  if (options.mode === null) usageError("context requires --mode <mode>.");
  return options;
}

async function loadRegistryProjects(ids) {
  if (ids.length === 0) return { registryProjects: [], registryProjectSplitReview: null };
  if (new Set(ids).size !== ids.length) {
    throw new KnowledgeRouterError("KNOWLEDGE_INPUT_INVALID", "--registry-project requires unique project ids.");
  }
  const sortedIds = [...ids].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  if (sortedIds.length > 20) {
    return {
      registryProjects: [],
      registryProjectSplitReview: { ids: sortedIds }
    };
  }
  const session = openOfflineRegistry({ skillRoot });
  const projects = [];
  for (const id of sortedIds) {
    const record = await showRegistryProject(session, id);
    const summary = session.index.records.find((candidate) => candidate.id === id);
    projects.push({
      capabilities: record.capabilities,
      id,
      recordSha256: summary.sha256,
      status: record.status,
      surfaces: record.surfaces
    });
  }
  return { registryProjects: projects, registryProjectSplitReview: null };
}

async function readTemplatePlan(candidate) {
  const target = path.resolve(candidate);
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch {
    throw new KnowledgeRouterError("TEMPLATE_PLAN_INVALID", `Template plan does not exist: ${candidate}.`);
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2) {
    throw new KnowledgeRouterError("TEMPLATE_PLAN_INVALID", "Template plan must be a real JSON file, not a symbolic link.");
  }
  if (stat.size > maximumTemplatePlanBytes) {
    const sourceSha256 = await streamFileSha256(target, stat.size);
    return {
      templatePlan: null,
      templatePlanSplitReview: {
        byteLength: stat.size,
        maximumBytes: maximumTemplatePlanBytes,
        reason: "size-overflow",
        sourceSha256
      }
    };
  }
  try {
    return {
      templatePlan: parseBoundedStrictJsonBytes(fs.readFileSync(target), {
        maxSourceBytes: maximumTemplatePlanBytes
      }),
      templatePlanSplitReview: null
    };
  } catch {
    throw new KnowledgeRouterError("TEMPLATE_PLAN_INVALID", "Template plan must be valid UTF-8 JSON.");
  }
}

async function streamFileSha256(target, expectedBytes) {
  const hash = crypto.createHash("sha256");
  let byteLength = 0;
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
  try {
    for await (const chunk of fs.createReadStream(target, { flags })) {
      byteLength += chunk.length;
      hash.update(chunk);
    }
  } catch {
    throw new KnowledgeRouterError("TEMPLATE_PLAN_INVALID", "Template plan changed or became unreadable during source hashing.");
  }
  if (byteLength !== expectedBytes) {
    throw new KnowledgeRouterError("TEMPLATE_PLAN_INVALID", "Template plan changed during source hashing.");
  }
  return `sha256:${hash.digest("hex")}`;
}

function requireValue(args, index, option) {
  const value = args[index];
  if (value === undefined || value.startsWith("--")) usageError(`${option} requires a value.`);
  return value;
}

function usageError(message) {
  throw new KnowledgeRouterError("USAGE_ERROR", message);
}

function help() {
  const selectors = describeKnowledgeSelectors({ skillRoot });
  const capabilityFamilies = selectors.routeFamilies.filter(({ kind }) => kind === "capability");
  const surfaceFamilies = selectors.routeFamilies.filter(({ kind }) => kind === "surface");
  return [
    "Usage: knowledge-router.mjs --mode <explore|autopilot|preflight|prototype|repair|review|submit|handoff> [--template-plan <programmable-template.json>] [--registry-project <id>]... [--pack <catalog-pack-id>]... [--capability <id>]... [--surface <id>]...",
    "",
    "Return the smallest deterministic local reference profile for one builder task.",
    "",
    "Options:",
    "  --mode <mode>           Select the current builder mode.",
    "  --template-plan <path>  Derive exact capabilities and surfaces from one current template plan.",
    "  --pack <id>             Expand one catalog pack into its exact capabilities and surfaces; repeat as needed.",
    "  --capability <id>       Add an explicit known or owner-defined capability; repeat as needed.",
    "  --surface <id>          Add an explicit project surface; repeat as needed.",
    "  --registry-project <id> Load one hash-bound project from the bundled Registry snapshot as discovery context; repeat as needed.",
    "  --help                  Show this help and the bundled selectable ids without using the network.",
    "",
    "Selectable capability ids:",
    formatIds(selectors.capabilityIds),
    "",
    "Selectable surface ids:",
    formatIds(selectors.surfaceIds),
    "",
    "Selectable pack ids:",
    formatIds(selectors.packIds),
    "",
    "Reserved routing-family names (not selectable project ids):",
    ...capabilityFamilies.map(({ id, selectableIds, matchingPackIds }) => (
      `  capability ${id} -> ${selectableIds.join(", ")}${matchingPackIds.length === 0 ? "" : `; packs: ${matchingPackIds.join(", ")}`}`
    )),
    ...surfaceFamilies.map(({ id, selectableIds }) => `  surface ${id} -> ${selectableIds.join(", ")}`),
    "",
    "Unknown capabilities are preserved and routed to architecture review; they never cause an automatic rejection.",
    "Use a new owner-defined kebab-case id only when none of the listed ids expresses the confirmed behavior.",
    "Up to 256 direct capability or surface ids and 20 Registry projects use one normal routing plan. Larger valid inventories return a complete HOLD_SPLIT_REVIEW plan with deterministic chunks and no materialization or adverse decision.",
    "A real template plan above 1 MiB routes to the same manual-provenance hold; symbolic links and invalid UTF-8 or JSON remain invalid.",
    "Registry capabilities and surfaces are descriptive metadata in a separate namespace. They never select Builder packs, change eligibility, or trigger architecture review.",
    "The command reads bundled local references only and never uses the network or changes a project.",
    ""
  ].join("\n");
}

function formatIds(values) {
  const lines = [];
  let current = "  ";
  for (const value of values) {
    const next = current === "  " ? `${current}${value}` : `${current}, ${value}`;
    if (Buffer.byteLength(next) > 116) {
      lines.push(current);
      current = `  ${value}`;
    } else {
      current = next;
    }
  }
  if (current !== "  ") lines.push(current);
  return lines.join("\n");
}
