import { ProgrammableSdkError } from "./errors.js";
import { PROTOCOL_SPEC_ID } from "./constants.js";
import {
  canonicalizePortableValue,
  parsePortableJson,
  portableSha256IdentifierFromSource,
  type PortableJsonValue,
} from "./portable-json.js";
import { isCanonicalDecimal } from "./uint.js";

export const CANONICAL_JSON_TEST_DOMAIN = "programmable:canonical-json-test:v1" as const;
export const AUTHORIZATION_SCOPE_V1_DOMAIN = "programmable:authorization-scope:v1" as const;
export const MARKET_TEMPLATE_V1_DOMAIN = "programmable:market-template:v1" as const;

export type Sha256Identifier = `sha256:${string}`;

export interface ScopeTargetV1 {
  readonly market_id: Sha256Identifier;
  readonly engine_revision_id: Sha256Identifier;
  readonly domain_revision_ids: readonly Sha256Identifier[];
  readonly action_payload_digest: Sha256Identifier;
  readonly execution_phase: string;
}

export interface ScopeAssetAuthorizationV1 {
  readonly native_asset_id: string;
  readonly asset_profile_id: string;
  readonly max_market_execution_gross_debit: string;
  readonly max_protocol_assessment_gross_debit: string;
  readonly max_total_gross_debit: string;
  readonly max_market_execution_external_withholding: string;
  readonly max_protocol_assessment_external_withholding: string;
  readonly credit_recipient_policy_digest: Sha256Identifier;
  readonly minimum_spendable_credit: string;
}

export interface SponsoredAssessmentAuthorizationV1 {
  readonly assessment_authorization_scope_id: Sha256Identifier;
  readonly assessment_principal_id: string;
  readonly asset_profile_id: string;
  readonly native_asset_id: string;
  readonly maximum_gross_assessment_debit: string;
  readonly protocol_collector_id: string;
}

export type ScopeDeadlineV1 =
  | { readonly kind: "non_expiring" }
  | { readonly kind: "bounded"; readonly clock_id: string; readonly not_after: string };

export interface AuthorizationScopeDescriptorV1 {
  readonly $schema: "urn:programmable:schema:authorization-scope-descriptor:v1";
  readonly protocol_spec_id: string;
  readonly constitution_id: Sha256Identifier;
  readonly runtime_id: string;
  readonly chain_reference: string;
  readonly core_deployment_id: Sha256Identifier;
  readonly binding_scope_domain_separator: string;
  readonly authorization_profile_id: "direct-one-shot-v1" | "signed-one-shot-v1" | "stored-scope-v1";
  readonly principal_id: string;
  readonly principal_nonce: string;
  readonly ordered_targets: readonly ScopeTargetV1[];
  readonly asset_authorizations: readonly ScopeAssetAuthorizationV1[];
  readonly sponsored_assessment_authorizations?: readonly SponsoredAssessmentAuthorizationV1[];
  readonly deadline: ScopeDeadlineV1;
  readonly partial_fill_policy: "forbidden" | "cumulative_fills_allowed";
  readonly cancellation_policy: "cancel_closes_scope";
}

type UnknownRecord = Record<string, unknown>;

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9._:-]+$/;
const PROTOCOL_SPEC = /^programmable-protocol\/[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.]+)?$/;
const MARKET_SEMANTIC_ID = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9][a-z0-9_-]*)+$/;
const MARKET_NAME = /^[a-z][a-z0-9_-]{0,63}$/;
const MARKET_EXTENSION_KEY = /^[A-Za-z0-9_.:-]+$/;
const MARKET_CAPABILITIES = new Set([
  "programmable.capability.asset_move.v1",
  "programmable.capability.core_rights.v1",
  "programmable.capability.profile_operation.v1",
  "programmable.capability.temporary_obligation.v1",
  "programmable.capability.authorization_state.v1",
  "programmable.capability.domain_revision.v1",
]);
const MARKET_EFFECTS = new Set([
  "programmable.effect.asset_move.v1",
  "programmable.effect.core_rights_delta.v1",
  "programmable.effect.profile_operation.v1",
  "programmable.effect.temporary_obligation_open.v1",
]);

function validationFailure(code: string, message: string): never {
  throw new ProgrammableSdkError(code, message);
}

function portableInputSnapshot(value: unknown): {
  readonly canonical: string;
  readonly value: PortableJsonValue;
} {
  const canonical = canonicalizePortableValue(value);
  return Object.freeze({ canonical, value: parsePortableJson(canonical) });
}

function object(value: unknown, label: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    validationFailure("SCOPE_INVALID_OBJECT", `${label} must be an object`);
  }
  return value as UnknownRecord;
}

function exactKeys(
  value: UnknownRecord,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) validationFailure("SCOPE_UNKNOWN_FIELD", `${label} contains unknown field ${key}`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) validationFailure("SCOPE_MISSING_FIELD", `${label} is missing ${key}`);
  }
}

function string(value: unknown, label: string, minimum = 1, maximum = 256): string {
  const length = typeof value === "string" ? [...value].length : -1;
  if (typeof value !== "string" || length < minimum || length > maximum) {
    validationFailure("SCOPE_INVALID_STRING", `${label} must be a string of length ${minimum}..${maximum}`);
  }
  return value;
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    validationFailure("SCOPE_INVALID_IDENTIFIER", `${label} must be a non-empty identifier`);
  }
  const result = value;
  if (!IDENTIFIER.test(result)) validationFailure("SCOPE_INVALID_IDENTIFIER", `${label} has invalid characters`);
  return result;
}

function digest(value: unknown, label: string): Sha256Identifier {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    validationFailure("SCOPE_INVALID_DIGEST", `${label} must be a lowercase SHA-256 identifier`);
  }
  return value as Sha256Identifier;
}

function decimal(value: unknown, label: string): string {
  if (!isCanonicalDecimal(value)) {
    validationFailure("SCOPE_INVALID_DECIMAL", `${label} must be a canonical non-negative decimal string`);
  }
  return value;
}

function list(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value) || value.length === 0) {
    validationFailure("SCOPE_INVALID_ARRAY", `${label} must be a non-empty array`);
  }
  return value;
}

function marketText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string" || [...value].length === 0 || [...value].length > maximum) {
    validationFailure("MARKET_TEMPLATE_STRING_INVALID", `${label} must contain 1..${maximum} Unicode scalars`);
  }
  return value;
}

function marketSemanticId(value: unknown, label: string): string {
  const result = marketText(value, label, 160);
  if (!MARKET_SEMANTIC_ID.test(result)) {
    validationFailure("MARKET_TEMPLATE_SEMANTIC_ID_INVALID", `${label} is not a semantic ID`);
  }
  return result;
}

function marketStringSet(
  value: unknown,
  label: string,
  validate: (entry: string, entryLabel: string) => void,
): void {
  if (!Array.isArray(value)) validationFailure("MARKET_TEMPLATE_ARRAY_INVALID", `${label} must be an array`);
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      validationFailure("MARKET_TEMPLATE_ARRAY_INVALID", `${label} cannot contain sparse positions`);
    }
    const entry = value[index];
    if (typeof entry !== "string") {
      validationFailure("MARKET_TEMPLATE_ARRAY_INVALID", `${label}[${index}] must be a string`);
    }
    validate(entry, `${label}[${index}]`);
    if (seen.has(entry)) validationFailure("MARKET_TEMPLATE_DUPLICATE_ITEM", `${label} repeats ${entry}`);
    seen.add(entry);
  }
}

function validateMarketExtensionKeys(value: unknown): void {
  const pending: { readonly value: unknown; readonly label: string }[] = [
    { value, label: "market_template.extensions" },
  ];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || current.value === null || typeof current.value !== "object") continue;
    if (Array.isArray(current.value)) {
      for (let index = 0; index < current.value.length; index += 1) {
        pending.push({ value: current.value[index], label: `${current.label}[${index}]` });
      }
      continue;
    }
    for (const key of Object.keys(current.value)) {
      if (!MARKET_EXTENSION_KEY.test(key)) {
        validationFailure(
          "MARKET_TEMPLATE_EXTENSION_KEY_INVALID",
          `${current.label} key ${key} is invalid`,
        );
      }
      pending.push({
        value: (current.value as UnknownRecord)[key],
        label: `${current.label}.${key}`,
      });
    }
  }
}

function assertMarketTemplateSnapshot(value: unknown): asserts value is PortableJsonValue {
  const template = object(value, "market_template");
  exactKeys(
    template,
    [
      "$schema",
      "protocol_spec_id",
      "namespace",
      "name",
      "revision",
      "summary",
      "domain_policy",
      "asset_roles",
      "actions",
      "extensions",
    ],
    [],
    "market_template",
  );
  if (template["$schema"] !== "urn:programmable:schema:market-template:v1") {
    validationFailure("MARKET_TEMPLATE_SCHEMA_MISMATCH", "market_template has an unsupported schema");
  }
  if (template["protocol_spec_id"] !== PROTOCOL_SPEC_ID) {
    validationFailure("MARKET_TEMPLATE_PROTOCOL_LOCK_MISMATCH", "market_template differs from the pinned Protocol Spec");
  }
  marketSemanticId(template["namespace"], "market_template.namespace");
  if (typeof template["name"] !== "string" || !MARKET_NAME.test(template["name"])) {
    validationFailure("MARKET_TEMPLATE_NAME_INVALID", "market_template.name is invalid");
  }
  decimal(template["revision"], "market_template.revision");
  marketText(template["summary"], "market_template.summary", 500);

  const domainPolicy = object(template["domain_policy"], "market_template.domain_policy");
  exactKeys(domainPolicy, ["selector_id", "description"], [], "market_template.domain_policy");
  marketSemanticId(domainPolicy["selector_id"], "market_template.domain_policy.selector_id");
  marketText(domainPolicy["description"], "market_template.domain_policy.description", 500);

  const roleIds = new Set<string>();
  for (const [index, roleValue] of list(template["asset_roles"], "market_template.asset_roles").entries()) {
    const role = object(roleValue, `market_template.asset_roles[${index}]`);
    exactKeys(role, ["role_id", "description", "cardinality"], [], `market_template.asset_roles[${index}]`);
    const roleId = marketSemanticId(role["role_id"], `market_template.asset_roles[${index}].role_id`);
    if (roleIds.has(roleId)) validationFailure("MARKET_TEMPLATE_DUPLICATE_ROLE", `duplicate role ${roleId}`);
    roleIds.add(roleId);
    marketText(role["description"], `market_template.asset_roles[${index}].description`, 500);
    if (!new Set(["one", "zero_or_one", "one_or_more", "zero_or_more"]).has(role["cardinality"] as string)) {
      validationFailure("MARKET_TEMPLATE_CARDINALITY_INVALID", `market_template.asset_roles[${index}] has invalid cardinality`);
    }
  }

  const actionIds = new Set<string>();
  for (const [index, actionValue] of list(template["actions"], "market_template.actions").entries()) {
    const label = `market_template.actions[${index}]`;
    const action = object(actionValue, label);
    exactKeys(
      action,
      [
        "action_id",
        "description",
        "required_protected_capabilities",
        "proposed_protected_effects",
        "opaque_engine_effects",
      ],
      [],
      label,
    );
    const actionId = marketSemanticId(action["action_id"], `${label}.action_id`);
    if (actionIds.has(actionId)) validationFailure("MARKET_TEMPLATE_DUPLICATE_ACTION", `duplicate action ${actionId}`);
    actionIds.add(actionId);
    marketText(action["description"], `${label}.description`, 500);
    marketStringSet(action["required_protected_capabilities"], `${label}.required_protected_capabilities`, (entry, entryLabel) => {
      if (!MARKET_CAPABILITIES.has(entry)) {
        validationFailure("MARKET_TEMPLATE_CAPABILITY_INVALID", `${entryLabel} is not engine-authorizable`);
      }
    });
    marketStringSet(action["proposed_protected_effects"], `${label}.proposed_protected_effects`, (entry, entryLabel) => {
      if (!MARKET_EFFECTS.has(entry)) {
        validationFailure("MARKET_TEMPLATE_EFFECT_INVALID", `${entryLabel} is not engine-proposable`);
      }
    });
    marketStringSet(action["opaque_engine_effects"], `${label}.opaque_engine_effects`, (entry, entryLabel) => {
      if (entry.startsWith("programmable.") || !MARKET_SEMANTIC_ID.test(entry) || [...entry].length > 160) {
        validationFailure("MARKET_TEMPLATE_OPAQUE_EFFECT_INVALID", `${entryLabel} is invalid`);
      }
    });
  }

  const extensions = object(template["extensions"], "market_template.extensions");
  validateMarketExtensionKeys(extensions);
}

function validateTarget(value: unknown, label: string): void {
  const target = object(value, label);
  exactKeys(
    target,
    ["market_id", "engine_revision_id", "domain_revision_ids", "action_payload_digest", "execution_phase"],
    [],
    label,
  );
  digest(target["market_id"], `${label}.market_id`);
  digest(target["engine_revision_id"], `${label}.engine_revision_id`);
  const domains = list(target["domain_revision_ids"], `${label}.domain_revision_ids`);
  const seen = new Set<string>();
  for (const [index, domain] of domains.entries()) {
    const checked = digest(domain, `${label}.domain_revision_ids[${index}]`);
    if (seen.has(checked)) validationFailure("duplicate_domain_revision_id", `${label} repeats a Domain Revision`);
    seen.add(checked);
  }
  digest(target["action_payload_digest"], `${label}.action_payload_digest`);
  identifier(target["execution_phase"], `${label}.execution_phase`);
}

function validateAsset(value: unknown, label: string): string {
  const asset = object(value, label);
  exactKeys(
    asset,
    [
      "native_asset_id",
      "asset_profile_id",
      "max_market_execution_gross_debit",
      "max_protocol_assessment_gross_debit",
      "max_total_gross_debit",
      "max_market_execution_external_withholding",
      "max_protocol_assessment_external_withholding",
      "credit_recipient_policy_digest",
      "minimum_spendable_credit",
    ],
    [],
    label,
  );
  const nativeAsset = string(asset["native_asset_id"], `${label}.native_asset_id`);
  const profile = identifier(asset["asset_profile_id"], `${label}.asset_profile_id`);
  for (const field of [
    "max_market_execution_gross_debit",
    "max_protocol_assessment_gross_debit",
    "max_total_gross_debit",
    "max_market_execution_external_withholding",
    "max_protocol_assessment_external_withholding",
    "minimum_spendable_credit",
  ]) {
    decimal(asset[field], `${label}.${field}`);
  }
  digest(asset["credit_recipient_policy_digest"], `${label}.credit_recipient_policy_digest`);
  return `${profile}\u0000${nativeAsset}`;
}

function validateSponsor(value: unknown, label: string): { tuple: string; assetTuple: string; maximum: bigint } {
  const sponsor = object(value, label);
  exactKeys(
    sponsor,
    [
      "assessment_authorization_scope_id",
      "assessment_principal_id",
      "asset_profile_id",
      "native_asset_id",
      "maximum_gross_assessment_debit",
      "protocol_collector_id",
    ],
    [],
    label,
  );
  const scope = digest(sponsor["assessment_authorization_scope_id"], `${label}.assessment_authorization_scope_id`);
  string(sponsor["assessment_principal_id"], `${label}.assessment_principal_id`);
  const profile = string(sponsor["asset_profile_id"], `${label}.asset_profile_id`);
  const asset = string(sponsor["native_asset_id"], `${label}.native_asset_id`);
  const maximumString = decimal(sponsor["maximum_gross_assessment_debit"], `${label}.maximum_gross_assessment_debit`);
  string(sponsor["protocol_collector_id"], `${label}.protocol_collector_id`);
  const assetTuple = `${profile}\u0000${asset}`;
  return { tuple: `${scope}\u0000${assetTuple}`, assetTuple, maximum: BigInt(maximumString) };
}

function assertAuthorizationScopeDescriptorSnapshot(
  value: unknown,
): asserts value is AuthorizationScopeDescriptorV1 & PortableJsonValue {
  const scope = object(value, "scope_descriptor");
  exactKeys(
    scope,
    [
      "$schema",
      "protocol_spec_id",
      "constitution_id",
      "runtime_id",
      "chain_reference",
      "core_deployment_id",
      "binding_scope_domain_separator",
      "authorization_profile_id",
      "principal_id",
      "principal_nonce",
      "ordered_targets",
      "asset_authorizations",
      "deadline",
      "partial_fill_policy",
      "cancellation_policy",
    ],
    ["sponsored_assessment_authorizations"],
    "scope_descriptor",
  );
  if (scope["$schema"] !== "urn:programmable:schema:authorization-scope-descriptor:v1") {
    validationFailure("SCOPE_SCHEMA_MISMATCH", "scope_descriptor has an unsupported schema");
  }
  if (typeof scope["protocol_spec_id"] !== "string" || !PROTOCOL_SPEC.test(scope["protocol_spec_id"])) {
    validationFailure("SCOPE_SPEC_ID_INVALID", "scope_descriptor.protocol_spec_id is invalid");
  }
  digest(scope["constitution_id"], "scope_descriptor.constitution_id");
  identifier(scope["runtime_id"], "scope_descriptor.runtime_id");
  identifier(scope["chain_reference"], "scope_descriptor.chain_reference");
  digest(scope["core_deployment_id"], "scope_descriptor.core_deployment_id");
  identifier(scope["binding_scope_domain_separator"], "scope_descriptor.binding_scope_domain_separator");
  const profile = scope["authorization_profile_id"];
  if (profile !== "direct-one-shot-v1" && profile !== "signed-one-shot-v1" && profile !== "stored-scope-v1") {
    validationFailure("SCOPE_AUTHORIZATION_PROFILE_INVALID", "scope_descriptor.authorization_profile_id is invalid");
  }
  string(scope["principal_id"], "scope_descriptor.principal_id");
  decimal(scope["principal_nonce"], "scope_descriptor.principal_nonce");
  for (const [index, target] of list(scope["ordered_targets"], "scope_descriptor.ordered_targets").entries()) {
    validateTarget(target, `scope_descriptor.ordered_targets[${index}]`);
  }
  const assets = new Map<string, UnknownRecord>();
  for (const [index, assetValue] of list(scope["asset_authorizations"], "scope_descriptor.asset_authorizations").entries()) {
    const tuple = validateAsset(assetValue, `scope_descriptor.asset_authorizations[${index}]`);
    if (assets.has(tuple)) validationFailure("duplicate_asset_authorization_tuple", "scope_descriptor repeats an asset tuple");
    assets.set(tuple, object(assetValue, `scope_descriptor.asset_authorizations[${index}]`));
  }
  if (scope["sponsored_assessment_authorizations"] !== undefined) {
    const sponsorTuples = new Set<string>();
    for (const [index, sponsorValue] of list(
      scope["sponsored_assessment_authorizations"],
      "scope_descriptor.sponsored_assessment_authorizations",
    ).entries()) {
      const sponsor = validateSponsor(sponsorValue, `scope_descriptor.sponsored_assessment_authorizations[${index}]`);
      if (sponsorTuples.has(sponsor.tuple)) {
        validationFailure("duplicate_sponsored_assessment_tuple", "scope_descriptor repeats a sponsored assessment tuple");
      }
      sponsorTuples.add(sponsor.tuple);
      const matchingAsset = assets.get(sponsor.assetTuple);
      if (matchingAsset === undefined) {
        validationFailure("sponsored_assessment_asset_not_authorized", "sponsor asset tuple is not authorized");
      }
      const assessmentMaximum = BigInt(decimal(
        matchingAsset["max_protocol_assessment_gross_debit"],
        "matching_asset.max_protocol_assessment_gross_debit",
      ));
      const totalMaximum = BigInt(decimal(matchingAsset["max_total_gross_debit"], "matching_asset.max_total_gross_debit"));
      if (sponsor.maximum > assessmentMaximum || sponsor.maximum > totalMaximum) {
        validationFailure(
          "sponsored_assessment_limit_exceeds_asset_authorization",
          "sponsor maximum exceeds its matching asset authorization",
        );
      }
    }
  }
  const deadline = object(scope["deadline"], "scope_descriptor.deadline");
  if (deadline["kind"] === "non_expiring") {
    exactKeys(deadline, ["kind"], [], "scope_descriptor.deadline");
  } else if (deadline["kind"] === "bounded") {
    exactKeys(deadline, ["kind", "clock_id", "not_after"], [], "scope_descriptor.deadline");
    identifier(deadline["clock_id"], "scope_descriptor.deadline.clock_id");
    decimal(deadline["not_after"], "scope_descriptor.deadline.not_after");
  } else {
    validationFailure("SCOPE_DEADLINE_INVALID", "scope_descriptor.deadline.kind is invalid");
  }
  const partialFill = scope["partial_fill_policy"];
  if (partialFill !== "forbidden" && partialFill !== "cumulative_fills_allowed") {
    validationFailure("SCOPE_PARTIAL_FILL_INVALID", "scope_descriptor.partial_fill_policy is invalid");
  }
  if (
    (profile === "stored-scope-v1" && partialFill !== "cumulative_fills_allowed") ||
    (profile !== "stored-scope-v1" && partialFill !== "forbidden")
  ) {
    validationFailure("SCOPE_PROFILE_FILL_MISMATCH", "authorization profile and partial-fill policy disagree");
  }
  if (scope["cancellation_policy"] !== "cancel_closes_scope") {
    validationFailure("SCOPE_CANCELLATION_POLICY_INVALID", "scope_descriptor.cancellation_policy is invalid");
  }
}

export function canonicalJsonTestDigest(source: string | Uint8Array): Sha256Identifier {
  return portableSha256IdentifierFromSource(CANONICAL_JSON_TEST_DOMAIN, source);
}

export function assertMarketTemplateV1(value: unknown): asserts value is PortableJsonValue {
  const snapshot = portableInputSnapshot(value);
  assertMarketTemplateSnapshot(snapshot.value);
}

export function assertAuthorizationScopeDescriptorV1(
  value: unknown,
): asserts value is AuthorizationScopeDescriptorV1 & PortableJsonValue {
  const snapshot = portableInputSnapshot(value);
  assertAuthorizationScopeDescriptorSnapshot(snapshot.value);
}

export function authorizationScopeIdV1(value: unknown): Sha256Identifier {
  const snapshot = portableInputSnapshot(value);
  assertAuthorizationScopeDescriptorSnapshot(snapshot.value);
  return portableSha256IdentifierFromSource(AUTHORIZATION_SCOPE_V1_DOMAIN, snapshot.canonical);
}

export function marketTemplateIdV1(value: unknown): Sha256Identifier {
  const snapshot = portableInputSnapshot(value);
  assertMarketTemplateSnapshot(snapshot.value);
  return portableSha256IdentifierFromSource(MARKET_TEMPLATE_V1_DOMAIN, snapshot.canonical);
}
