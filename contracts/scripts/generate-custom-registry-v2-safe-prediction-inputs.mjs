import { randomBytes, createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { getAddress } from "viem";

import { assertReleaseEvidenceOutput } from "./custom-registry-v2-release-evidence.mjs";
import { trustedNetworkTime } from "./custom-registry-v2-transaction-journal.mjs";

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const roles = ["approver", "registrar", "finalizer", "revoker"];
export const REQUIRED_RETIRED_SAFE_SALT_COMMITMENTS = Object.freeze([
  "0xee6689d67026d13105af2673155593ff5d324c4566687634f800058ad7a97eec",
  "0xfc5391250dd3c16555185aaa569184bf898158b5adac21390efcf5da9816e2eb",
  "0x6680a7889f37905189fe2cc5c80825e370bec91cae344c804a19b7d2a9a99b71",
  "0x280a54ef916e3422cbb2e802363daa5e8648127832dcb1aab49179c1faa11064",
]);

export function assertCompleteRetiredSaltInventory(retiredSaltCommitments) {
  if (
    !(retiredSaltCommitments instanceof Set) ||
    [...retiredSaltCommitments].some(
      (commitment) => !/^0x[0-9a-f]{64}$/u.test(commitment),
    ) ||
    REQUIRED_RETIRED_SAFE_SALT_COMMITMENTS.some(
      (commitment) => !retiredSaltCommitments.has(commitment),
    )
  ) {
    throw new Error("published retired Safe salt inventory is incomplete");
  }
}

export function generatePredictionRoleEntries({
  owners,
  retiredSaltCommitments,
  randomBytesFunction = randomBytes,
}) {
  if (!Array.isArray(owners) || owners.length !== roles.length) {
    throw new Error("exactly four Safe owner addresses are required");
  }
  const canonicalOwners = owners.map((owner) => getAddress(owner));
  if (new Set(canonicalOwners).size !== roles.length) {
    throw new Error("Safe owner addresses must be distinct");
  }
  const generatedSalts = new Set();
  return roles.map((role, index) => {
    let bytes;
    let commitment;
    let saltNonce;
    do {
      bytes = randomBytesFunction(32);
      if (!Buffer.isBuffer(bytes) || bytes.length !== 32) {
        throw new Error("salt generator must return exactly 32 bytes");
      }
      commitment = `0x${createHash("sha256").update(bytes).digest("hex")}`;
      saltNonce = BigInt(`0x${bytes.toString("hex")}`).toString();
    } while (
      bytes.every((value) => value === 0) ||
      retiredSaltCommitments.has(commitment) ||
      generatedSalts.has(saltNonce)
    );
    generatedSalts.add(saltNonce);
    return {
      role,
      owner: canonicalOwners[index],
      saltNonce,
      saltSha256: commitment,
      generation: "NODE_CRYPTO_RANDOMBYTES_32_OS_CSPRNG",
    };
  });
}

async function main() {
  if (!process.argv.includes("--generate-fresh-prediction-inputs")) {
    throw new Error("explicit --generate-fresh-prediction-inputs is required");
  }
  const outputIndex = process.argv.indexOf("--output");
  if (outputIndex === -1 || !process.argv[outputIndex + 1]) {
    throw new Error("--output is required");
  }
  const sourceCommit = required("REGISTRY_SOURCE_COMMIT");
  const sourceTree = required("REGISTRY_SOURCE_TREE");
  const approvalPolicyCommitment = required(
    "REGISTRY_APPROVAL_POLICY_COMMITMENT",
  );
  if (
    !/^[0-9a-f]{40}$/u.test(sourceCommit) ||
    !/^[0-9a-f]{40}$/u.test(sourceTree) ||
    !/^0x[0-9a-f]{64}$/u.test(approvalPolicyCommitment)
  ) {
    throw new Error("frozen source or Approval policy identity is invalid");
  }
  const generated = trustedNetworkTime();
  const retiredSaltCommitments = new Set(
    (process.env.REGISTRY_RETIRED_SAFE_SALT_COMMITMENTS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  assertCompleteRetiredSaltInventory(retiredSaltCommitments);
  const owners = roles.map((role) =>
    required(`REGISTRY_${role.toUpperCase()}_SAFE_OWNER`),
  );
  const roleEntries = generatePredictionRoleEntries({
    owners,
    retiredSaltCommitments,
  });
  const output = assertReleaseEvidenceOutput(process.argv[outputIndex + 1]);
  const evidence = {
    schemaVersion: "programmable.custom-registry-v2-safe-prediction-inputs.v2",
    source: { commit: sourceCommit, tree: sourceTree },
    approvalPolicyCommitment,
    generatedAtTimestamp: generated.adjustedTimestamp,
    generatedTrustedTime: generated,
    generatedAfterPublicSourceAndApprovalPolicyFreeze: true,
    publicPredictionsRetired: true,
    retiredSaltCommitmentsChecked: retiredSaltCommitments.size,
    roles: roleEntries,
  };
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  process.stdout.write(
    `CUSTOM_REGISTRY_V2_FRESH_SAFE_PREDICTION_INPUTS ${output}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
