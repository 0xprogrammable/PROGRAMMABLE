import { bytesToHex, sha256 as rawSha256, stringToBytes } from "viem";

export const HOOKEMON_ACTION_SELECTOR_SCHEMA_V1 =
  "programmable.hookemon-action-selector.v1" as const;
export const HOOKEMON_BROWSER_ACTION_SCHEMA_V1 =
  "programmable.hookemon-browser-wallet-action.v1" as const;
export const HOOKEMON_ACTION_AUTHORITY_ENVELOPE_SCHEMA_V1 =
  "programmable.hookemon-action-authority-envelope.v1" as const;
export const HOOKEMON_ACTION_AUTHORITY_SIGNING_DOMAIN_V1 =
  "programmable.hookemon-action-authority-envelope-signing.v1" as const;

export type HookemonEnvelopeSha256V1 = `sha256:${string}`;
export type HookemonEnvelopeBytes32V1 = `0x${string}`;
export type HookemonEnvelopeActionKindV1 =
  | "ERC20_APPROVAL"
  | "EOA_CREATE"
  | "COMPLETED_GRAPH_ADOPTION";

export interface HookemonActionSelectorCoreV1 {
  readonly schemaVersion: typeof HOOKEMON_ACTION_SELECTOR_SCHEMA_V1;
  readonly bindingHash: HookemonEnvelopeSha256V1;
  readonly stateVersion: string;
  readonly actionIndex: 0 | 1 | 2;
  readonly actionKind: HookemonEnvelopeActionKindV1;
  readonly previousFinalityEvidenceHash: HookemonEnvelopeSha256V1 | null;
  readonly permitDigest: HookemonEnvelopeBytes32V1 | null;
  readonly validAfterEpochSeconds: string;
  readonly expiresAtEpochSeconds: string;
  readonly currentnessEvidenceHash: HookemonEnvelopeSha256V1;
}

export interface HookemonAuthorityBrowserActionCoreV1 {
  readonly schemaVersion: typeof HOOKEMON_BROWSER_ACTION_SCHEMA_V1;
  readonly bindingHash: HookemonEnvelopeSha256V1;
  readonly stateVersion: string;
  readonly actionIndex: 0 | 1 | 2;
  readonly actionKind: HookemonEnvelopeActionKindV1;
  readonly selectorHash: HookemonEnvelopeSha256V1;
  readonly dataHash: HookemonEnvelopeBytes32V1;
  readonly previousFinalityEvidenceHash: HookemonEnvelopeSha256V1 | null;
  readonly permitDigest: HookemonEnvelopeBytes32V1 | null;
  readonly validAfterEpochSeconds: string;
  readonly expiresAtEpochSeconds: string;
  readonly currentness: Readonly<Record<string, unknown>>;
  readonly transaction: Readonly<Record<string, unknown>>;
}

export interface HookemonAuthorityBrowserActionV1
  extends HookemonAuthorityBrowserActionCoreV1 {
  readonly actionHash: HookemonEnvelopeSha256V1;
}

export interface HookemonActionAuthorityEnvelopeCoreV1 {
  readonly schemaVersion: typeof HOOKEMON_ACTION_AUTHORITY_ENVELOPE_SCHEMA_V1;
  readonly bindingHash: HookemonEnvelopeSha256V1;
  readonly releaseHeadHash: HookemonEnvelopeSha256V1;
  readonly revocationEpoch: string;
  readonly selectorHash: HookemonEnvelopeSha256V1;
  readonly actionHash: HookemonEnvelopeSha256V1;
  readonly authorityKeyId: string;
  readonly signatureAlgorithm: "ed25519";
}

export interface HookemonActionAuthorityEnvelopeV1
  extends HookemonActionAuthorityEnvelopeCoreV1 {
  readonly envelopeHash: HookemonEnvelopeSha256V1;
  readonly signature: `ed25519:${string}`;
}

export interface HookemonActionAuthorityExpectedReleaseV1 {
  readonly bindingHash: HookemonEnvelopeSha256V1;
  readonly releaseHeadHash: HookemonEnvelopeSha256V1;
  readonly revocationEpoch: string;
  readonly authorityKeyId: string;
}

export function canonicalizeHookemonAuthorityJsonV1(value: unknown): string {
  return canonicalizeValue(value, new WeakSet<object>(), 0);
}

export function canonicalHookemonAuthoritySha256V1(
  domain: string,
  value: unknown,
): HookemonEnvelopeSha256V1 {
  if (!/^programmable\.[a-z0-9.-]+\.v[1-9][0-9]*$/u.test(domain)) {
    throw invalid("Hookemon hash domain is invalid");
  }
  const digest = rawSha256(bytesToHex(concatBytes(
    stringToBytes(domain),
    Uint8Array.of(0),
    stringToBytes(canonicalizeHookemonAuthorityJsonV1(value)),
  )));
  return `sha256:${digest.slice(2)}`;
}

export function computeHookemonActionSelectorHashV1(
  raw: Omit<HookemonActionSelectorCoreV1, "schemaVersion"> & Readonly<{
    schemaVersion?: typeof HOOKEMON_ACTION_SELECTOR_SCHEMA_V1;
  }>,
): HookemonEnvelopeSha256V1 {
  const core = assertSelectorCore({
    ...raw,
    schemaVersion: raw.schemaVersion ?? HOOKEMON_ACTION_SELECTOR_SCHEMA_V1,
  });
  return canonicalHookemonAuthoritySha256V1(core.schemaVersion, core);
}

export function computeHookemonAuthorityActionHashV1(
  raw: HookemonAuthorityBrowserActionCoreV1,
): HookemonEnvelopeSha256V1 {
  const core = assertActionCore(raw);
  return canonicalHookemonAuthoritySha256V1(core.schemaVersion, core);
}

export function computeHookemonActionAuthorityEnvelopeHashV1(
  raw: HookemonActionAuthorityEnvelopeCoreV1,
): HookemonEnvelopeSha256V1 {
  const core = assertEnvelopeCore(raw);
  return canonicalHookemonAuthoritySha256V1(core.schemaVersion, core);
}

export function hookemonActionAuthoritySigningBytesV1(
  raw: HookemonActionAuthorityEnvelopeCoreV1 & Readonly<{
    envelopeHash: HookemonEnvelopeSha256V1;
  }>,
): Uint8Array {
  const value = exactObject(raw, [
    "actionHash", "authorityKeyId", "bindingHash", "envelopeHash",
    "releaseHeadHash", "revocationEpoch", "schemaVersion", "selectorHash",
    "signatureAlgorithm",
  ], "Hookemon signing envelope");
  const { envelopeHash: rawEnvelopeHash, ...rawCore } = value;
  const core = assertEnvelopeCore(rawCore);
  const envelopeHash = sha256(rawEnvelopeHash);
  if (envelopeHash !== computeHookemonActionAuthorityEnvelopeHashV1(core)) {
    throw invalid("Hookemon action envelope hash drifted");
  }
  return concatBytes(
    stringToBytes(HOOKEMON_ACTION_AUTHORITY_SIGNING_DOMAIN_V1),
    Uint8Array.of(0),
    stringToBytes(canonicalizeHookemonAuthorityJsonV1({
      ...core,
      envelopeHash,
    })),
  );
}

export async function verifyHookemonActionAuthorityEnvelopeV1(input: Readonly<{
  action: unknown;
  envelope: unknown;
  expectedRelease: HookemonActionAuthorityExpectedReleaseV1;
  verifySignature: (request: Readonly<{
    keyId: string;
    signingBytes: Uint8Array;
    signature: Uint8Array;
  }>) => boolean | Promise<boolean>;
}>): Promise<Readonly<{
  action: HookemonAuthorityBrowserActionV1;
  envelope: HookemonActionAuthorityEnvelopeV1;
}>> {
  const action = assertAuthorityBrowserAction(input.action);
  const currentnessEvidenceHash = sha256(
    action.currentness.currentnessEvidenceHash,
  );
  const expectedSelectorHash = computeHookemonActionSelectorHashV1({
    bindingHash: action.bindingHash,
    stateVersion: action.stateVersion,
    actionIndex: action.actionIndex,
    actionKind: action.actionKind,
    previousFinalityEvidenceHash: action.previousFinalityEvidenceHash,
    permitDigest: action.permitDigest,
    validAfterEpochSeconds: action.validAfterEpochSeconds,
    expiresAtEpochSeconds: action.expiresAtEpochSeconds,
    currentnessEvidenceHash,
  });
  const { actionHash, ...actionCore } = action;
  if (
    action.selectorHash !== expectedSelectorHash
    || actionHash !== computeHookemonAuthorityActionHashV1(actionCore)
  ) throw invalid("Hookemon browser action identifiers drifted");

  const expectedRelease = assertExpectedRelease(input.expectedRelease);
  const envelope = assertEnvelope(input.envelope);
  const { envelopeHash, signature, ...envelopeCore } = envelope;
  if (
    envelope.bindingHash !== expectedRelease.bindingHash
    || envelope.releaseHeadHash !== expectedRelease.releaseHeadHash
    || envelope.revocationEpoch !== expectedRelease.revocationEpoch
    || envelope.authorityKeyId !== expectedRelease.authorityKeyId
    || envelope.bindingHash !== action.bindingHash
    || envelope.selectorHash !== action.selectorHash
    || envelope.actionHash !== action.actionHash
    || envelopeHash !== computeHookemonActionAuthorityEnvelopeHashV1(envelopeCore)
  ) throw invalid("Hookemon action authority envelope left the exact release");
  const verified = await input.verifySignature({
    keyId: envelope.authorityKeyId,
    signingBytes: hookemonActionAuthoritySigningBytesV1({
      ...envelopeCore,
      envelopeHash,
    }),
    signature: ed25519SignatureBytes(signature),
  });
  if (!verified) throw invalid("Hookemon action authority signature is invalid");
  return deepFreeze({ action, envelope });
}

function assertAuthorityBrowserAction(
  raw: unknown,
): HookemonAuthorityBrowserActionV1 {
  const value = exactObject(raw, [
    "actionHash", "actionIndex", "actionKind", "bindingHash", "currentness",
    "dataHash", "expiresAtEpochSeconds", "permitDigest",
    "previousFinalityEvidenceHash", "schemaVersion", "selectorHash",
    "stateVersion", "transaction", "validAfterEpochSeconds",
  ], "Hookemon authority browser action");
  const { actionHash: rawActionHash, ...rawCore } = value;
  const actionHash = sha256(rawActionHash);
  const core = assertActionCore(rawCore);
  return deepFreeze({ ...core, actionHash });
}

function assertActionCore(raw: unknown): HookemonAuthorityBrowserActionCoreV1 {
  const value = exactObject(raw, [
    "actionIndex", "actionKind", "bindingHash", "currentness", "dataHash",
    "expiresAtEpochSeconds", "permitDigest", "previousFinalityEvidenceHash",
    "schemaVersion", "selectorHash", "stateVersion", "transaction",
    "validAfterEpochSeconds",
  ], "Hookemon authority action core");
  if (value.schemaVersion !== HOOKEMON_BROWSER_ACTION_SCHEMA_V1) {
    throw invalid("Hookemon browser action schema is invalid");
  }
  const actionIndex = index(value.actionIndex);
  const actionKind = kind(value.actionKind);
  if (["ERC20_APPROVAL", "EOA_CREATE", "COMPLETED_GRAPH_ADOPTION"][actionIndex]
    !== actionKind) throw invalid("Hookemon browser action order is invalid");
  const currentness = plainRecord(value.currentness, "Hookemon currentness");
  const transaction = plainRecord(value.transaction, "Hookemon transaction");
  // Canonicalization here rejects accessors, symbols, cycles and non-JSON data
  // before any object can participate in an authority hash.
  canonicalizeHookemonAuthorityJsonV1(currentness);
  canonicalizeHookemonAuthorityJsonV1(transaction);
  return deepFreeze({
    schemaVersion: HOOKEMON_BROWSER_ACTION_SCHEMA_V1,
    bindingHash: sha256(value.bindingHash),
    stateVersion: uint(value.stateVersion),
    actionIndex,
    actionKind,
    selectorHash: sha256(value.selectorHash),
    dataHash: bytes32(value.dataHash),
    previousFinalityEvidenceHash: nullableSha256(value.previousFinalityEvidenceHash),
    permitDigest: nullableBytes32(value.permitDigest),
    validAfterEpochSeconds: uint(value.validAfterEpochSeconds),
    expiresAtEpochSeconds: uint(value.expiresAtEpochSeconds),
    currentness,
    transaction,
  });
}

function assertSelectorCore(raw: unknown): HookemonActionSelectorCoreV1 {
  const value = exactObject(raw, [
    "actionIndex", "actionKind", "bindingHash", "currentnessEvidenceHash",
    "expiresAtEpochSeconds", "permitDigest", "previousFinalityEvidenceHash",
    "schemaVersion", "stateVersion", "validAfterEpochSeconds",
  ], "Hookemon action selector core");
  if (value.schemaVersion !== HOOKEMON_ACTION_SELECTOR_SCHEMA_V1) {
    throw invalid("Hookemon action selector schema is invalid");
  }
  const actionIndex = index(value.actionIndex);
  const actionKind = kind(value.actionKind);
  if (["ERC20_APPROVAL", "EOA_CREATE", "COMPLETED_GRAPH_ADOPTION"][actionIndex]
    !== actionKind) throw invalid("Hookemon action selector order is invalid");
  return deepFreeze({
    schemaVersion: HOOKEMON_ACTION_SELECTOR_SCHEMA_V1,
    bindingHash: sha256(value.bindingHash),
    stateVersion: uint(value.stateVersion),
    actionIndex,
    actionKind,
    previousFinalityEvidenceHash: nullableSha256(value.previousFinalityEvidenceHash),
    permitDigest: nullableBytes32(value.permitDigest),
    validAfterEpochSeconds: uint(value.validAfterEpochSeconds),
    expiresAtEpochSeconds: uint(value.expiresAtEpochSeconds),
    currentnessEvidenceHash: sha256(value.currentnessEvidenceHash),
  });
}

function assertEnvelope(raw: unknown): HookemonActionAuthorityEnvelopeV1 {
  const value = exactObject(raw, [
    "actionHash", "authorityKeyId", "bindingHash", "envelopeHash",
    "releaseHeadHash", "revocationEpoch", "schemaVersion", "selectorHash",
    "signature", "signatureAlgorithm",
  ], "Hookemon action authority envelope");
  const {
    envelopeHash: rawEnvelopeHash,
    signature: rawSignature,
    ...rawCore
  } = value;
  const core = assertEnvelopeCore(rawCore);
  const signature = ed25519Signature(rawSignature);
  return deepFreeze({
    ...core,
    envelopeHash: sha256(rawEnvelopeHash),
    signature,
  });
}

function assertEnvelopeCore(raw: unknown): HookemonActionAuthorityEnvelopeCoreV1 {
  const value = exactObject(raw, [
    "actionHash", "authorityKeyId", "bindingHash", "releaseHeadHash",
    "revocationEpoch", "schemaVersion", "selectorHash", "signatureAlgorithm",
  ], "Hookemon action authority envelope core");
  if (
    value.schemaVersion !== HOOKEMON_ACTION_AUTHORITY_ENVELOPE_SCHEMA_V1
    || value.signatureAlgorithm !== "ed25519"
  ) throw invalid("Hookemon action authority envelope schema is invalid");
  return deepFreeze({
    schemaVersion: HOOKEMON_ACTION_AUTHORITY_ENVELOPE_SCHEMA_V1,
    bindingHash: sha256(value.bindingHash),
    releaseHeadHash: sha256(value.releaseHeadHash),
    revocationEpoch: uint(value.revocationEpoch),
    selectorHash: sha256(value.selectorHash),
    actionHash: sha256(value.actionHash),
    authorityKeyId: identifier(value.authorityKeyId),
    signatureAlgorithm: "ed25519",
  });
}

function assertExpectedRelease(
  raw: unknown,
): HookemonActionAuthorityExpectedReleaseV1 {
  const value = exactObject(raw, [
    "authorityKeyId", "bindingHash", "releaseHeadHash", "revocationEpoch",
  ], "Hookemon action authority expected release");
  return deepFreeze({
    bindingHash: sha256(value.bindingHash),
    releaseHeadHash: sha256(value.releaseHeadHash),
    revocationEpoch: uint(value.revocationEpoch),
    authorityKeyId: identifier(value.authorityKeyId),
  });
}

function canonicalizeValue(
  value: unknown,
  active: WeakSet<object>,
  depth: number,
): string {
  if (depth > 128) throw invalid("Hookemon canonical JSON is too deep");
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    assertUnicodeScalarString(value);
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw invalid("Hookemon canonical JSON number is invalid");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw invalid(`Hookemon canonical JSON does not support ${typeof value}`);
  }
  if (active.has(value)) throw invalid("Hookemon canonical JSON is cyclic");
  active.add(value);
  try {
    if (Array.isArray(value)) {
      const ownKeys = Reflect.ownKeys(value);
      if (ownKeys.some((key) => typeof key !== "string"
        || (key !== "length" && !/^(?:0|[1-9][0-9]*)$/u.test(key)))) {
        throw invalid("Hookemon canonical JSON array has custom properties");
      }
      const elements: string[] = [];
      for (let position = 0; position < value.length; position += 1) {
        if (!Object.hasOwn(value, position)) {
          throw invalid("Hookemon canonical JSON array is sparse");
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, String(position));
        if (
          descriptor === undefined
          || descriptor.get !== undefined
          || descriptor.set !== undefined
          || !("value" in descriptor)
          || descriptor.enumerable !== true
        ) throw invalid("Hookemon canonical JSON array element is invalid");
        elements.push(canonicalizeValue(descriptor.value, active, depth + 1));
      }
      return `[${elements.join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw invalid("Hookemon canonical JSON object prototype is invalid");
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key === "symbol")) {
      throw invalid("Hookemon canonical JSON object has symbols");
    }
    const keys = ownKeys as string[];
    const descriptors = new Map<string, PropertyDescriptor>();
    for (const key of keys) {
      assertUnicodeScalarString(key);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined
        || !descriptor.enumerable
        || descriptor.get !== undefined
        || descriptor.set !== undefined
        || !("value" in descriptor)
      ) throw invalid("Hookemon canonical JSON property is invalid");
      descriptors.set(key, descriptor);
    }
    keys.sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${
      canonicalizeValue(descriptors.get(key)!.value, active, depth + 1)
    }`).join(",")}}`;
  } finally {
    active.delete(value);
  }
}

function assertUnicodeScalarString(value: string): void {
  for (let position = 0; position < value.length; position += 1) {
    const code = value.charCodeAt(position);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(position + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw invalid("Hookemon canonical JSON has a lone high surrogate");
      }
      position += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw invalid("Hookemon canonical JSON has a lone low surrogate");
    }
  }
}

function exactObject(
  raw: unknown,
  expectedKeys: readonly string[],
  label: string,
): Record<string, unknown> {
  const value = plainRecord(raw, label);
  const keys = Reflect.ownKeys(value);
  const strings = keys.filter((key): key is string => typeof key === "string")
    .sort();
  const expected = [...expectedKeys].sort();
  if (
    keys.length !== strings.length
    || strings.length !== expected.length
    || strings.some((key, position) => key !== expected[position])
  ) throw invalid(`${label} has unexpected fields`);
  return value;
}

function plainRecord(raw: unknown, label: string): Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw invalid(`${label} is invalid`);
  }
  const prototype = Object.getPrototypeOf(raw) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    throw invalid(`${label} has an invalid prototype`);
  }
  return raw as Record<string, unknown>;
}

function index(value: unknown): 0 | 1 | 2 {
  if (value !== 0 && value !== 1 && value !== 2) {
    throw invalid("Hookemon action index is invalid");
  }
  return value;
}

function kind(value: unknown): HookemonEnvelopeActionKindV1 {
  if (![
    "ERC20_APPROVAL", "EOA_CREATE", "COMPLETED_GRAPH_ADOPTION",
  ].includes(String(value))) throw invalid("Hookemon action kind is invalid");
  return value as HookemonEnvelopeActionKindV1;
}

function bytes32(value: unknown): HookemonEnvelopeBytes32V1 {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/u.test(value)) {
    throw invalid("Hookemon authority bytes32 is invalid");
  }
  return value as HookemonEnvelopeBytes32V1;
}

function nullableBytes32(value: unknown): HookemonEnvelopeBytes32V1 | null {
  return value === null ? null : bytes32(value);
}

function sha256(value: unknown): HookemonEnvelopeSha256V1 {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw invalid("Hookemon authority SHA-256 is invalid");
  }
  return value as HookemonEnvelopeSha256V1;
}

function nullableSha256(value: unknown): HookemonEnvelopeSha256V1 | null {
  return value === null ? null : sha256(value);
}

function uint(value: unknown): string {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value)
    || BigInt(value) >= 1n << 64n) {
    throw invalid("Hookemon authority uint64 is invalid");
  }
  return value;
}

function identifier(value: unknown): string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > 256
    || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u.test(value)
  ) throw invalid("Hookemon authority key id is invalid");
  return value;
}

function ed25519Signature(value: unknown): `ed25519:${string}` {
  if (typeof value !== "string" || !/^ed25519:[A-Za-z0-9_-]{86}$/u.test(value)) {
    throw invalid("Hookemon Ed25519 signature encoding is invalid");
  }
  ed25519SignatureBytes(value as `ed25519:${string}`);
  return value as `ed25519:${string}`;
}

function ed25519SignatureBytes(value: `ed25519:${string}`): Uint8Array {
  const encoded = value.slice("ed25519:".length);
  const base64 = encoded.replace(/-/gu, "+").replace(/_/gu, "/") + "==";
  let decoded: string;
  try {
    decoded = atob(base64);
  } catch {
    throw invalid("Hookemon Ed25519 signature encoding is invalid");
  }
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  if (bytes.length !== 64) throw invalid("Hookemon Ed25519 signature length is invalid");
  return bytes;
}

function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function invalid(message: string): TypeError {
  return new TypeError(message);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}
