import {
  encodeAbiParameters,
  keccak256,
  stringToHex,
} from "viem";

export const CLASSIC_V4_DIGEST_DOMAINS = Object.freeze({
  generic: "programmable.classic-v4.generic-json.v1",
  preparationPlan: "programmable.classic-v4.preparation-plan.v1",
  deploymentEvidence: "programmable.classic-v4.deployment-evidence.v1",
  sourceEvidence: "programmable.classic-v4.source-evidence.v1",
  releaseBinding: "programmable.classic-v4.release-binding.v1",
  lifecycleCanaryPlan: "programmable.classic-v4.lifecycle-canary-plan.v1",
  lifecycleEvidence: "programmable.classic-v4.lifecycle-evidence.v1",
  releaseManifest: "programmable.classic-v4.release-manifest.v1",
  canaryCreatorSalt: "programmable.classic-v4.canary-creator-salt.v1",
  deploymentRpcSnapshot: "programmable.classic-v4.deployment-rpc-snapshot.v1",
  lifecycleRpcSnapshot: "programmable.classic-v4.lifecycle-rpc-snapshot.v1",
  sourcePins: "programmable.classic-v4.source-pins.v1",
  dependencyClosure: "programmable.classic-v4.dependency-closure.v1",
  buildArtifacts: "programmable.classic-v4.build-artifacts.v1",
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function canonicalDigestString(value) {
  if (/^0x[0-9a-f]+$/i.test(value) || /^[0-9a-f]{40}$/i.test(value)) {
    return value.toLowerCase();
  }
  return value.replace(/0x[0-9a-f]{40}/gi, (address) =>
    address.toLowerCase(),
  );
}

function stableValue(value) {
  if (value === null) return ["null"];
  if (Array.isArray(value)) return ["array", value.map(stableValue)];
  if (typeof value === "string") {
    return ["string", canonicalDigestString(value)];
  }
  if (typeof value === "boolean") return ["boolean", value];
  if (typeof value === "number") {
    assert(Number.isFinite(value), "Digest input contains a non-finite number");
    return ["number", Object.is(value, -0) ? 0 : value];
  }
  if (typeof value === "bigint") return ["bigint", value.toString()];
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    assert(
      prototype === Object.prototype || prototype === null,
      "Digest input contains a non-plain object",
    );
    return [
      "object",
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    ];
  }
  throw new Error(`Digest input contains unsupported ${typeof value}`);
}

export function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

export function digestJson(
  value,
  domain = CLASSIC_V4_DIGEST_DOMAINS.generic,
) {
  assert(
    typeof domain === "string" &&
      /^[a-z0-9][a-z0-9.-]+\.v[1-9][0-9]*$/.test(domain),
    "Invalid digest domain",
  );
  return keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "bytes" }],
      [domain, stringToHex(stableStringify(value))],
    ),
  );
}
