export const JSON_SCHEMA_KEYWORD_PROFILE_IDS = Object.freeze({
  restrictedSubmission: "restricted-submission-json-schema-v1",
  openWorldExtension: "open-world-extension-json-schema-v1"
});

const keywordOwnerByName = new Map();
const supportedKeywordsByProfile = new WeakMap();

const sharedKeywords = ownKeywordGroup("shared-bounded-json-schema", [
  "$schema", "$id", "$ref", "$defs", "$comment",
  "title", "description", "default", "examples", "deprecated", "readOnly", "writeOnly",
  "type", "const", "enum",
  "allOf", "anyOf", "oneOf", "not", "if", "then", "else",
  "required", "properties", "additionalProperties", "minProperties", "maxProperties",
  "items", "prefixItems", "contains", "minContains", "maxContains", "minItems", "maxItems", "uniqueItems",
  "minLength", "maxLength", "pattern", "format",
  "minimum", "maximum"
]);

const restrictedSubmissionOnlyKeywords = ownKeywordGroup("restricted-submission-json-schema", [
  "definitions",
  "multipleOf",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "propertyNames",
  "x-programmable-derived-from"
]);

export const JSON_SCHEMA_KEYWORD_PROFILES = Object.freeze({
  restrictedSubmission: defineKeywordProfile({
    id: JSON_SCHEMA_KEYWORD_PROFILE_IDS.restrictedSubmission,
    keywordGroups: [sharedKeywords, restrictedSubmissionOnlyKeywords],
    unsupportedKeywordDisposition: "reject-schema"
  }),
  openWorldExtension: defineKeywordProfile({
    id: JSON_SCHEMA_KEYWORD_PROFILE_IDS.openWorldExtension,
    keywordGroups: [sharedKeywords],
    unsupportedKeywordDisposition: "bounded-tooling-review"
  })
});

export function jsonSchemaKeywordIsSupported(profile, keyword) {
  const supportedKeywords = supportedKeywordsByProfile.get(profile);
  if (supportedKeywords === undefined) throw new TypeError("unknown JSON Schema keyword profile");
  return typeof keyword === "string" && supportedKeywords.has(keyword);
}

function ownKeywordGroup(owner, keywords) {
  if (typeof owner !== "string" || owner.length === 0 || !Array.isArray(keywords) || keywords.length === 0) {
    throw new TypeError("JSON Schema keyword groups require one owner and at least one keyword");
  }
  const owned = [];
  for (const keyword of keywords) {
    if (typeof keyword !== "string" || keyword.length === 0) {
      throw new TypeError(`JSON Schema keyword owner ${owner} contains an invalid keyword`);
    }
    const priorOwner = keywordOwnerByName.get(keyword);
    if (priorOwner !== undefined) {
      throw new TypeError(`JSON Schema keyword ${keyword} has duplicate canonical owners ${priorOwner} and ${owner}`);
    }
    keywordOwnerByName.set(keyword, owner);
    owned.push(keyword);
  }
  return Object.freeze(owned);
}

function defineKeywordProfile({ id, keywordGroups, unsupportedKeywordDisposition }) {
  if (
    typeof id !== "string"
    || id.length === 0
    || !Array.isArray(keywordGroups)
    || keywordGroups.length === 0
    || typeof unsupportedKeywordDisposition !== "string"
    || unsupportedKeywordDisposition.length === 0
  ) {
    throw new TypeError("JSON Schema keyword profiles require an id, keyword groups, and an unsupported-keyword disposition");
  }
  const supportedKeywords = keywordGroups.flatMap((keywords) => keywords);
  if (new Set(supportedKeywords).size !== supportedKeywords.length) {
    throw new TypeError(`JSON Schema keyword profile ${id} contains a duplicate keyword`);
  }
  const profile = Object.freeze({
    id,
    supportedKeywords: Object.freeze(supportedKeywords),
    unsupportedKeywordDisposition
  });
  supportedKeywordsByProfile.set(profile, new Set(supportedKeywords));
  return profile;
}
