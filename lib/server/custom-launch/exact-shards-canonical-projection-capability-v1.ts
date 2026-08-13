const CAPABILITY_BRAND: unique symbol = Symbol(
  "registry.exact-shards-v2.canonical-projection-capability.v1",
);

export type ExactShardsCanonicalProjectionCapabilityV1 = Readonly<{
  readonly [CAPABILITY_BRAND]: true;
}>;

type CapabilityState = {
  readonly issuer: object;
  readonly canonicalGeneration: string;
  readonly descriptorBindingSha256: string;
  projection: Readonly<{
    kind: "finalized" | "revoked";
    inputBindingSha256: string;
    record: object;
    recordBinding: string;
    anchorBlockHashes: readonly string[];
  }> | null;
};

const CAPABILITIES = new WeakMap<object, CapabilityState>();
const RECORD_CAPABILITIES = new WeakMap<object, object>();

/**
 * Internal orchestrator primitive. The returned one-use token has no readable
 * fields, cannot be JSON encoded or structured-cloned, and is authoritative
 * only to the issuing store instance through module-private WeakMap state.
 */
export function issueExactShardsCanonicalProjectionCapabilityV1(input: Readonly<{
  issuer: object;
  canonicalGeneration: string;
  descriptorBindingSha256: string;
}>): ExactShardsCanonicalProjectionCapabilityV1 {
  if (input.issuer === null || typeof input.issuer !== "object"
    || !/^[1-9][0-9]*$/u.test(input.canonicalGeneration)
    || !/^sha256:[0-9a-f]{64}$/u.test(input.descriptorBindingSha256)) {
    throw new TypeError("ExactShards canonical capability input is invalid");
  }
  const target = Object.create(null) as object;
  Object.defineProperty(target, "toJSON", {
    configurable: false,
    enumerable: false,
    value: () => {
      throw new TypeError("ExactShards canonical capability is not serializable");
    },
    writable: false,
  });
  Object.freeze(target);
  // Proxies are rejected by the structured-clone algorithm, preventing the
  // opaque authority from crossing a worker/process boundary as a raw token.
  const capability = new Proxy(target, Object.freeze({}));
  CAPABILITIES.set(capability, {
    issuer: input.issuer,
    canonicalGeneration: input.canonicalGeneration,
    descriptorBindingSha256: input.descriptorBindingSha256,
    projection: null,
  });
  return capability as ExactShardsCanonicalProjectionCapabilityV1;
}

export function assertExactShardsCanonicalProjectionCapabilityV1(input: Readonly<{
  capability: ExactShardsCanonicalProjectionCapabilityV1;
  descriptorBindingSha256: string;
}>): void {
  const state = capabilityState(input.capability);
  if (state.descriptorBindingSha256 !== input.descriptorBindingSha256
    || state.projection !== null) {
    throw new TypeError("ExactShards canonical capability is invalid or consumed");
  }
}

export function bindExactShardsCanonicalProjectionCapabilityV1(input: Readonly<{
  capability: ExactShardsCanonicalProjectionCapabilityV1;
  descriptorBindingSha256: string;
  kind: "finalized" | "revoked";
  inputBindingSha256: string;
  record: object;
  recordBinding: string;
  anchorBlockHashes: readonly string[];
}>): void {
  assertExactShardsCanonicalProjectionCapabilityV1(input);
  if (!/^sha256:[0-9a-f]{64}$/u.test(input.inputBindingSha256)
    || input.record === null || typeof input.record !== "object"
    || input.recordBinding.length === 0
    || input.anchorBlockHashes.length === 0
    || input.anchorBlockHashes.some((hash) => !/^0x[0-9a-f]{64}$/u.test(hash))
    || RECORD_CAPABILITIES.has(input.record)) {
    throw new TypeError("ExactShards canonical projection binding is invalid");
  }
  const state = capabilityState(input.capability);
  state.projection = Object.freeze({
    kind: input.kind,
    inputBindingSha256: input.inputBindingSha256,
    record: input.record,
    recordBinding: input.recordBinding,
    anchorBlockHashes: Object.freeze([...input.anchorBlockHashes]),
  });
  RECORD_CAPABILITIES.set(input.record, input.capability);
}

export function requireExactShardsCanonicalProjectionBindingV1(input: Readonly<{
  capability: ExactShardsCanonicalProjectionCapabilityV1;
  issuer: object;
  descriptorBindingSha256: string;
  kind: "finalized" | "revoked";
  record: object;
  anchorBlockHashes: readonly string[];
}>): Readonly<{ canonicalGeneration: string }> {
  const state = capabilityState(input.capability);
  const projection = state.projection;
  if (state.issuer !== input.issuer
    || state.descriptorBindingSha256 !== input.descriptorBindingSha256
    || projection === null
    || projection.kind !== input.kind
    || projection.record !== input.record
    || projection.recordBinding.length === 0
    || RECORD_CAPABILITIES.get(input.record) !== input.capability
    || projection.anchorBlockHashes.length !== input.anchorBlockHashes.length
    || projection.anchorBlockHashes.some(
      (hash, index) => hash !== input.anchorBlockHashes[index],
    )) {
    throw new TypeError("ExactShards canonical projection provenance is invalid");
  }
  return Object.freeze({ canonicalGeneration: state.canonicalGeneration });
}

function capabilityState(
  capability: ExactShardsCanonicalProjectionCapabilityV1,
): CapabilityState {
  if (capability === null
    || (typeof capability !== "object" && typeof capability !== "function")) {
    throw new TypeError("ExactShards canonical capability is invalid");
  }
  const state = CAPABILITIES.get(capability);
  if (state === undefined) {
    throw new TypeError("ExactShards canonical capability is invalid");
  }
  return state;
}
