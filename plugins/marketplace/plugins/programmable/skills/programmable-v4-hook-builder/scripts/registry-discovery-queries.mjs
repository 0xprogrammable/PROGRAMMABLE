import {
  CONTROL_OR_BIDI,
  UNPAIRED_SURROGATE
} from "./registry-discovery-definitions.mjs";
import {
  compareUtf8,
  fail,
  intersection,
  requireId,
  tokenize
} from "./registry-discovery-primitives.mjs";
import {
  comparisonSide,
  projectSummary,
  scoreRecord
} from "./registry-discovery-validation.mjs";

export function listRegistryProjects(session) {
  return session.index.records.map(projectSummary);
}

export function searchRegistryProjects(session, query, { limit = 10 } = {}) {
  if (
    typeof query !== "string"
    || query.trim() !== query
    || query.length < 2
    || query.length > 500
    || CONTROL_OR_BIDI.test(query)
    || UNPAIRED_SURROGATE.test(query)
  ) {
    fail("REGISTRY_QUERY_INVALID", "search query must be 2 to 500 clean characters", 2);
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) fail("REGISTRY_QUERY_INVALID", "search limit must be between 1 and 20", 2);
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) fail("REGISTRY_QUERY_INVALID", "search query has no usable terms", 2);
  const normalizedQuery = query.normalize("NFKD").toLowerCase().replace(/\p{Mark}+/gu, "").trim();
  const scored = session.search.records.map((record) => scoreRecord(record, queryTokens, normalizedQuery))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || compareUtf8(left.id, right.id))
    .slice(0, limit);
  return {
    newIdeaStillEligible: true,
    noveltyBoundary: "Similarity is a discovery hint only. No match or close match may automatically reject an idea.",
    query,
    queryTokens,
    relatedCanonicalRecordFound: scored.some(({ matchStrength }) => matchStrength === "exact" || matchStrength === "related"),
    results: scored
  };
}

export async function showRegistryProject(session, id) {
  requireId(id);
  return session.loadRecord(id);
}

export async function compareRegistryProjects(session, leftId, rightId) {
  requireId(leftId);
  requireId(rightId);
  if (leftId === rightId) fail("REGISTRY_QUERY_INVALID", "compare requires two different project ids", 2);
  const [left, right] = await Promise.all([session.loadRecord(leftId), session.loadRecord(rightId)]);
  return {
    common: {
      capabilities: intersection(left.capabilities, right.capabilities),
      surfaces: intersection(left.surfaces, right.surfaces),
      tags: intersection(left.discovery.tags, right.discovery.tags)
    },
    left: comparisonSide(left, right),
    right: comparisonSide(right, left),
    trustBoundary: "This is a metadata comparison, not a compatibility, originality, safety, audit, or approval decision."
  };
}
