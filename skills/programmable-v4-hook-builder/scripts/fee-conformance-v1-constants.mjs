export const FEE_CONFORMANCE_RECEIPT_V1_SCHEMA_ID =
  "urn:programmable:fee-conformance-receipt-v1:1.0.0";
export const FEE_CONFORMANCE_RECEIPT_V1_VERSION = "1.0.0";
export const FEE_CONFORMANCE_RECEIPT_V1_CONTRACT_ID = "fee-conformance-receipt-v1";
export const FEE_CONFORMANCE_RECEIPT_V1_RESULT = "STRUCTURALLY_CONFORMANT";
export const FEE_CONFORMANCE_RECEIPT_V1_ASSURANCE =
  "structural-only-not-audit-deployment-or-approval";

export const FEE_CONFORMANCE_VECTOR_SET_V1_SCHEMA_ID =
  "urn:programmable:fee-conformance-vector-set-v1:1.0.0";
export const FEE_CONFORMANCE_VECTOR_SET_V1_VERSION = "1.0.0";
export const FEE_CONFORMANCE_VECTOR_SET_V1_CONTRACT_ID = "fee-conformance-vector-set-v1";

export const REQUIRED_FEE_CONFORMANCE_ASSERTIONS_V1 = Object.freeze([
  "executed-gross-quote-basis",
  "fixed-platform-10-bps",
  "inclusive-selected-total",
  "lifetime-carry-fragmentation-resistant",
  "execution-counted-once-no-double-charge",
  "cross-scope-isolation-no-netting",
  "all-entrypoints-anti-bypass",
  "owner-only-claim",
  "owner-selected-nonzero-claim-destination",
  "claim-preserves-remainders",
  "claimable-only-after-full-custody",
  "liability-custody-conservation",
  "callback-authentication",
  "reentrancy-resistance"
]);

export const FEE_MATH_ASSERTIONS_V1 = Object.freeze([
  "executed-gross-quote-basis",
  "fixed-platform-10-bps",
  "inclusive-selected-total",
  "lifetime-carry-fragmentation-resistant"
]);

export const STANDARD_AMM_QUADRANTS_V1 = Object.freeze([
  "one-for-zero-exact-input",
  "one-for-zero-exact-output",
  "zero-for-one-exact-input",
  "zero-for-one-exact-output"
]);

export const FEE_FUNDING_MODELS_V1 = Object.freeze([
  "user-funded",
  "sponsor-segregated",
  "collateral-segregated"
]);

export const FEE_BEHAVIOR_ASSERTIONS_V1 = Object.freeze({
  "user-funded-rate-boundary": Object.freeze(["inclusive-selected-total"]),
  "execution-counting": Object.freeze(["execution-counted-once-no-double-charge"]),
  "scope-isolation": Object.freeze(["cross-scope-isolation-no-netting"]),
  "entrypoint-anti-bypass": Object.freeze(["all-entrypoints-anti-bypass"]),
  "claim-authorization-and-destination": Object.freeze([
    "owner-only-claim",
    "owner-selected-nonzero-claim-destination"
  ]),
  "claim-remainder-persistence": Object.freeze(["claim-preserves-remainders"]),
  "custody-liability-conservation": Object.freeze([
    "claimable-only-after-full-custody",
    "liability-custody-conservation"
  ]),
  "callback-authentication": Object.freeze(["callback-authentication"]),
  "reentrancy-resistance": Object.freeze(["reentrancy-resistance"]),
  "segregated-prefunding-solvency": Object.freeze([
    "claimable-only-after-full-custody",
    "liability-custody-conservation"
  ]),
  "underfunded-no-state-change": Object.freeze(["claimable-only-after-full-custody"]),
  "refund-cancel-obligations-preserved": Object.freeze(["liability-custody-conservation"])
});
