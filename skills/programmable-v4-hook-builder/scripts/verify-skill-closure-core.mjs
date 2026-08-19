import fs from "node:fs";
import path from "node:path";
import { isInside } from "./verify-skill-filesystem-core.mjs";

export function scanPins(value, currentPath, pinErrors) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanPins(entry, `${currentPath}[${index}]`, pinErrors));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (/(commit|revision|sourceCommit|sourceTree)$/i.test(key) && child !== null && (typeof child !== "string" || !/^[a-fA-F0-9]{40}$/.test(child))) {
      pinErrors.push(`${currentPath}.${key}: expected an exact 40-character Git object id`);
    }
    scanPins(child, `${currentPath}.${key}`, pinErrors);
  }
}

export function validateKnowledgeRoutingClosure(findings, context) {
  const { packageEntriesByPath, packageFiles, read, relative } = context;
  const routingRelativePath = "references/knowledge-routing.json";
  let routing;
  try {
    routing = JSON.parse(read(routingRelativePath));
  } catch (error) {
    findings.push(`${routingRelativePath}: ${error.message}`);
    return;
  }
  if (
    routing?.schemaVersion !== "1.0.0"
    || routing?.kind !== "programmable-knowledge-routing"
    || routing?.policy?.selectionSemantics !== "minimum-sufficient-progressive-context"
    || routing?.policy?.unknownCapabilityOutcome !== "preserve-and-route-to-architecture-review"
    || routing?.policy?.automaticAdverseDecision !== false
    || routing?.policy?.networkAccess !== "forbidden"
    || routing?.policy?.estimatedTokenAlgorithm !== "ceil-utf8-bytes-divided-by-four"
  ) {
    findings.push(`${routingRelativePath}: identity or non-adverse offline policy is invalid`);
  }

  const expectedModes = ["autopilot", "explore", "handoff", "preflight", "prototype", "repair", "review", "submit"];
  const actualModes = Object.keys(routing?.modes ?? {}).sort();
  if (actualModes.length !== expectedModes.length || actualModes.some((mode, index) => mode !== expectedModes[index])) {
    findings.push(`${routingRelativePath}: exactly eight builder modes are required`);
  }
  const references = [];
  for (const [mode, profile] of Object.entries(routing?.modes ?? {})) {
    if (!Array.isArray(profile?.initial) || profile.initial.length < 1 || !Array.isArray(profile?.later)) {
      findings.push(`${routingRelativePath}: mode ${mode} is incomplete`);
      continue;
    }
    references.push(...profile.initial);
    for (const deferred of profile.later) {
      if (typeof deferred?.trigger !== "string" || deferred.trigger.length < 12 || deferred.trigger.length > 500) {
        findings.push(`${routingRelativePath}: mode ${mode} has an invalid deferred trigger`);
      }
      references.push(deferred?.reference);
    }
  }
  for (const [label, routes] of [
    ["capability", routing?.capabilityRoutes],
    ["surface", routing?.surfaceRoutes]
  ]) {
    if (!Array.isArray(routes) || routes.length < 1) {
      findings.push(`${routingRelativePath}: ${label} routes are invalid`);
      continue;
    }
    const routeIds = new Set();
    for (const route of routes) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(route?.id ?? "") || routeIds.has(route?.id)) {
        findings.push(`${routingRelativePath}: ${label} route identity is invalid`);
      }
      routeIds.add(route?.id);
      if (!Array.isArray(route?.matches) || route.matches.length < 1 || !Array.isArray(route?.references) || route.references.length < 1) {
        findings.push(`${routingRelativePath}: ${label} route ${route?.id ?? "unknown"} is incomplete`);
      }
      for (const id of route?.matches ?? []) {
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) findings.push(`${routingRelativePath}: ${label} route ${route?.id ?? "unknown"} has an unsafe match id`);
      }
      references.push(...(route?.references ?? []));
    }
  }
  if (!Array.isArray(routing?.unknownCapabilityReferences) || routing.unknownCapabilityReferences.length < 1) {
    findings.push(`${routingRelativePath}: unknown capability fallback is missing`);
  } else {
    references.push(...routing.unknownCapabilityReferences);
  }
  if (!Array.isArray(routing?.archivalReferences) || routing.archivalReferences.length < 1) {
    findings.push(`${routingRelativePath}: explicit archival reference groups are missing`);
  } else {
    const archivalIds = new Set();
    for (const group of routing.archivalReferences) {
      if (
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(group?.id ?? "")
        || archivalIds.has(group?.id)
        || typeof group?.reason !== "string"
        || group.reason.length < 24
        || group.reason.length > 500
        || !Array.isArray(group?.references)
        || group.references.length < 1
      ) {
        findings.push(`${routingRelativePath}: archival reference group is invalid`);
        continue;
      }
      archivalIds.add(group.id);
      references.push(...group.references);
    }
  }
  for (const reference of references) {
    if (typeof reference !== "string" || !/^[a-z0-9]+(?:[-.][a-z0-9]+)*\.(?:md|json)$/.test(reference)) {
      findings.push(`${routingRelativePath}: unsafe reference ${String(reference)}`);
      continue;
    }
    const target = `references/${reference}`;
    if (!packageEntriesByPath.get(target)?.stat.isFile()) findings.push(`${routingRelativePath}: missing routed reference ${target}`);
  }
  const reachableMarkdown = new Set(references.filter((reference) => typeof reference === "string" && reference.endsWith(".md")));
  for (const match of read("SKILL.md").matchAll(/\]\(references\/([a-z0-9.-]+\.md)(?:#[^)]+)?\)/g)) {
    reachableMarkdown.add(match[1]);
  }
  for (const entry of packageFiles) {
    const reference = relative(entry);
    if (!/^references\/[^/]+\.md$/.test(reference)) continue;
    const name = reference.slice("references/".length);
    if (!reachableMarkdown.has(name)) {
      findings.push(`${routingRelativePath}: installed Markdown reference is neither routed, linked, nor archival: ${reference}`);
    }
  }
}

export function validateLocalModuleClosure(findings, context) {
  const { packageEntriesByPath, packageFiles, relative, skillRoot } = context;
  // Validate the portable runtime modules. Tests deliberately contain hostile
  // import-like fixture strings and repository-relative integration imports;
  // their own required-file closure is enforced by the explicit list above.
  const modulePaths = packageFiles.filter((entry) => /^scripts\/[^/]+\.mjs$/.test(relative(entry)));
  const specifierPattern = /(?:\bfrom\s*|\bimport\s*\()\s*["'](\.{1,2}\/[^"']+)["']/g;
  for (const modulePath of modulePaths) {
    const source = fs.readFileSync(modulePath, "utf8");
    for (const match of source.matchAll(specifierPattern)) {
      const target = path.resolve(path.dirname(modulePath), match[1]);
      if (!isInside(skillRoot, target)) {
        findings.push(`${relative(modulePath)}: local module import escapes the skill: ${match[1]}`);
        continue;
      }
      const importedPath = relative(target);
      if (!packageEntriesByPath.get(importedPath)?.stat.isFile()) {
        findings.push(`${relative(modulePath)}: missing local module import ${importedPath}`);
      }
    }
  }
}
