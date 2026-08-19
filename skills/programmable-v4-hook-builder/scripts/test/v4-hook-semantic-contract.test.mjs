import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateAgainstSchema } from "../submission-core.mjs";
import {
  canonicalV4PermissionMask,
  validateV4HookSemanticContract,
  v4PermissionMask
} from "../v4-hook-semantic-contract-core.mjs";
import { createV4HookSemanticFixture } from "./v4-hook-semantic-fixture.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "..", "..");
const submissionSchema = JSON.parse(fs.readFileSync(path.join(skillRoot, "references", "submission-v2.schema.json"), "utf8"));
const v4HookSemanticProfileSchema = {
  $schema: submissionSchema.$schema,
  $ref: "#/$defs/v4HookSemanticProfile",
  $defs: submissionSchema.$defs
};

const permissions = (overrides = {}) => ({
  beforeInitialize: false,
  afterInitialize: false,
  beforeAddLiquidity: false,
  afterAddLiquidity: false,
  beforeRemoveLiquidity: false,
  afterRemoveLiquidity: false,
  beforeSwap: false,
  afterSwap: true,
  beforeDonate: false,
  afterDonate: false,
  beforeSwapReturnDelta: false,
  afterSwapReturnDelta: false,
  afterAddLiquidityReturnDelta: false,
  afterRemoveLiquidityReturnDelta: false,
  ...overrides
});

const hook = (permissionSet = permissions()) => ({
  profile: createV4HookSemanticFixture(permissionSet),
  permissions: permissionSet
});

test("v4 semantic contract binds all 14 permissions to address bits and a complete source model", () => {
  const permissionSet = permissions();
  assert.equal(v4PermissionMask(permissionSet), 64n);
  assert.equal(canonicalV4PermissionMask(permissionSet), "0x0040");
  assert.deepEqual(validateV4HookSemanticContract(hook(permissionSet), { stage: "prototype", path: "$.hooks[0]" }), []);
});

test("permissions without a semantic profile stay reviewable at proposal and block prototype readiness", () => {
  const proposal = validateV4HookSemanticContract({ profile: {}, permissions: permissions() }, { stage: "proposal" });
  assert.ok(proposal.some(({ code, severity }) => code === "V4_SEMANTIC_PROFILE_FIELD_MISSING" && severity === "review"));
  const prototype = validateV4HookSemanticContract({ profile: {}, permissions: permissions() }, { stage: "prototype" });
  assert.ok(prototype.some(({ code, severity }) => code === "V4_SEMANTIC_PROFILE_FIELD_MISSING" && severity === "blocker"));
});

test("identity, PoolManager, cross-pool and hookData mutations fail closed", () => {
  const mutated = hook();
  mutated.profile.poolManager.authentication = "trust-caller";
  mutated.profile.identities.senderTreatedAsEndUser = true;
  mutated.profile.poolIsolation.crossPoolSubsidy = true;
  mutated.profile.hookData.mode = "versioned-authenticated";
  mutated.profile.hookData.versioned = false;
  const codes = new Set(validateV4HookSemanticContract(mutated, { stage: "prototype" }).map(({ code }) => code));
  assert.ok(codes.has("V4_POOL_MANAGER_AUTH_UNPROVEN"));
  assert.ok(codes.has("V4_CALLBACK_SENDER_AS_END_USER_FORBIDDEN"));
  assert.ok(codes.has("V4_CROSS_POOL_SUBSIDY_FORBIDDEN"));
  assert.ok(codes.has("V4_HOOK_DATA_VERSIONING_REQUIRED"));
});

test("real V2 exact-output hookData is a fixed bounded swap witness without identity, auth or replay semantics", () => {
  const permissionSet = permissions({
    beforeInitialize: true,
    beforeSwap: true,
    beforeSwapReturnDelta: true,
    afterSwapReturnDelta: true
  });
  const profile = createV4HookSemanticFixture(permissionSet, {
    purpose: "programmable-volume-fee-v2-standard-amm",
    hookDataMode: "bounded-swap-witness"
  });
  const candidate = { profile, permissions: permissionSet };

  assert.deepEqual(validateAgainstSchema(profile, v4HookSemanticProfileSchema), []);
  assert.deepEqual(validateV4HookSemanticContract(candidate, { stage: "prototype", path: "$.hooks[0]" }), []);
  assert.deepEqual(profile.hookData, {
    mode: "bounded-swap-witness",
    versioned: false,
    domainBound: false,
    replayProtected: false,
    malformedRejected: true,
    witness: {
      encoding: "abi-v2-static",
      solidityType: "uint256",
      exactByteLength: 32,
      valueSemantics: "exact-output-gross-quote-witness",
      executionDeltaBinding: "gross-witness-and-fee-reconciled-to-executed-quote-delta",
      identitySemantics: "none",
      authenticationSemantics: "none",
      replaySemantics: "none"
    }
  });
  assert.equal(profile.identities.endUserAuthentication, "not-used");
  assert.equal(profile.swapAccounting.partialFillPolicy, "rejected-before-effects");
});

test("non-witness hookData modes require an explicit null witness and reject invented witness semantics", () => {
  const permissionSet = permissions();
  const profile = createV4HookSemanticFixture(permissionSet);
  assert.deepEqual(validateAgainstSchema(profile, v4HookSemanticProfileSchema), []);
  assert.deepEqual(validateV4HookSemanticContract({ profile, permissions: permissionSet }, { stage: "prototype" }), []);

  delete profile.hookData.witness;
  assert.ok(validateAgainstSchema(profile, v4HookSemanticProfileSchema).length > 0);
  assert.ok(validateV4HookSemanticContract({ profile, permissions: permissionSet }, { stage: "prototype" }).some(({ code }) => code === "V4_SEMANTIC_GROUP_FIELD_MISSING"));

  profile.hookData.witness = {
    encoding: "abi-v2-static",
    solidityType: "uint256",
    exactByteLength: 32,
    valueSemantics: "exact-output-gross-quote-witness",
    executionDeltaBinding: "gross-witness-and-fee-reconciled-to-executed-quote-delta",
    identitySemantics: "none",
    authenticationSemantics: "none",
    replaySemantics: "none"
  };
  assert.ok(validateAgainstSchema(profile, v4HookSemanticProfileSchema).length > 0);
  assert.ok(validateV4HookSemanticContract({ profile, permissions: permissionSet }, { stage: "prototype" }).some(({ code }) => code === "V4_HOOK_DATA_WITNESS_CONFLICT"));
});

test("bounded swap witness rejects malformed shape, missing delta binding and invented credential semantics", () => {
  const permissionSet = permissions({ beforeSwap: true });
  const candidate = {
    profile: createV4HookSemanticFixture(permissionSet, { hookDataMode: "bounded-swap-witness" }),
    permissions: permissionSet
  };
  candidate.profile.hookData.witness.exactByteLength = 31;
  candidate.profile.hookData.witness.executionDeltaBinding = "unbound";
  candidate.profile.hookData.witness.identitySemantics = "user";
  candidate.profile.hookData.witness.authenticationSemantics = "trusted-router";
  candidate.profile.hookData.witness.replaySemantics = "nonce";
  candidate.profile.hookData.replayProtected = true;
  candidate.profile.identities.endUserAuthentication = "trusted-router-binding";
  candidate.profile.swapAccounting.partialFillPolicy = "supported-and-tested";

  const schemaFindings = validateAgainstSchema(candidate.profile, v4HookSemanticProfileSchema);
  assert.ok(schemaFindings.length > 0);
  const codes = new Set(validateV4HookSemanticContract(candidate, { stage: "prototype" }).map(({ code }) => code));
  for (const code of [
    "V4_SWAP_WITNESS_BYTE_LENGTH_INVALID",
    "V4_SWAP_WITNESS_DELTA_BINDING_INVALID",
    "V4_SWAP_WITNESS_IDENTITY_SEMANTICS_FORBIDDEN",
    "V4_SWAP_WITNESS_AUTHENTICATION_SEMANTICS_FORBIDDEN",
    "V4_SWAP_WITNESS_REPLAY_SEMANTICS_FORBIDDEN",
    "V4_SWAP_WITNESS_PARTIAL_FILL_POLICY_REQUIRED"
  ]) assert.ok(codes.has(code), code);

  const missingWitness = {
    profile: createV4HookSemanticFixture(permissionSet, { hookDataMode: "bounded-swap-witness" }),
    permissions: permissionSet
  };
  delete missingWitness.profile.hookData.witness;
  assert.ok(validateAgainstSchema(missingWitness.profile, v4HookSemanticProfileSchema).length > 0);
  assert.ok(validateV4HookSemanticContract(missingWitness, { stage: "prototype" }).some(({ code }) => code === "V4_SEMANTIC_GROUP_MISSING"));
});

test("return-delta permissions require matching backing, bounds, quadrants and executable evidence", () => {
  const permissionSet = permissions({ beforeSwap: true, beforeSwapReturnDelta: true });
  const mutated = hook(permissionSet);
  mutated.profile.returnDelta.backing = "not-applicable";
  mutated.profile.returnDelta.noOpAnalyzed = false;
  mutated.profile.swapAccounting.supportedQuadrants = ["zero-for-one-exact-input"];
  mutated.profile.swapAccounting.rejectedQuadrants = [];
  mutated.profile.evidence.fork = [];
  const codes = new Set(validateV4HookSemanticContract(mutated, { stage: "prototype" }).map(({ code }) => code));
  assert.ok(codes.has("V4_RETURN_DELTA_BACKING_UNRESOLVED"));
  assert.ok(codes.has("V4_RETURN_DELTA_NOOP_ANALYSIS_REQUIRED"));
  assert.ok(codes.has("V4_SWAP_QUADRANT_MATRIX_INCOMPLETE"));
  assert.ok(codes.has("V4_RETURN_DELTA_EVIDENCE_REQUIRED"));
});

test("a missing required canonical router surface fails closed", () => {
  const mutated = hook();
  mutated.profile.routing.universalRouter = false;
  const findings = validateV4HookSemanticContract(mutated, { stage: "prototype", path: "$.hooks[0]" });

  assert.deepEqual(findings, [{
    severity: "blocker",
    code: "V4_ROUTING_SURFACE_UNPROVEN",
    path: "$.hooks[0].profile.routing.universalRouter",
    message: "Canonical app-layer readiness requires universalRouter coverage.",
    details: {}
  }]);
});

test("permission-mask and expected-address mutations are detected independently", () => {
  const maskMutation = hook();
  maskMutation.profile.deployment.permissionMask = "0x0000";
  let codes = new Set(validateV4HookSemanticContract(maskMutation, { stage: "prototype" }).map(({ code }) => code));
  assert.ok(codes.has("V4_PERMISSION_MASK_MISMATCH"));

  const addressMutation = hook();
  addressMutation.profile.deployment.expectedAddress = "0x0000000000000000000000000000000000000000";
  codes = new Set(validateV4HookSemanticContract(addressMutation, { stage: "prototype" }).map(({ code }) => code));
  assert.ok(codes.has("V4_HOOK_ADDRESS_PERMISSION_MISMATCH"));
});
