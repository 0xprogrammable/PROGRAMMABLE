export const PROTOCOL_SPEC_ID = "programmable-protocol/0.1.0-draft.1" as const;

export const CONSTITUTION_ID =
  "sha256:2715d9770de7b327c054c413a99f7cbba0933f2eabc9639a53948706237cd301" as const;

export const PROTOCOL_COMMIT = "334bb26703a4dab18ce0fca8485c6275a879933a" as const;

export const PORTABLE_VECTOR_SET_DIGEST =
  "sha256:d61a757f8d4c14d3e5ab0f92e77ab39bd54e7a91f4cc5d591819c58768481137" as const;

export const UINT128_MAX = (1n << 128n) - 1n;
export const UINT64_MAX = (1n << 64n) - 1n;
export const EVM_MAX_INITCODE_BYTES = 49_152;
export const PROTOCOL_ASSESSMENT_DENOMINATOR = 2_000n;

export const EIP712_CANDIDATE_STATUS = "UNFROZEN_BLOCKED_BY_SPEC" as const;

export const EIP712_CANDIDATE_BLOCKERS = Object.freeze([
  "portable-capability-grammar",
  "portable-refund-grammar",
  "SPEC-GAP-011",
] as const);

export const PORTABLE_RECEIPT_MAPPING_STATUS = "BLOCKED_BY_SPEC" as const;
