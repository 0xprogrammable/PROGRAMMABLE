#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const [reportPath, ...rest] = process.argv.slice(2);
if (!reportPath || rest.length !== 0) {
  process.stderr.write("Usage: node scripts/verify-dex-evm-slither-findings.mjs <slither-results.json>\n");
  process.exit(1);
}

// Each accepted fingerprint is narrow to one detector, contract/function or variable,
// and source file. A resolved finding may disappear. A new target, duplicate, detector,
// or impact remains unreviewed and fails closed.
const accepted = new Map([
  ["locked-ether|Medium|src/core/CoreV1.sol|CoreV1|CoreV1", "executeProtected is a BLOCKED_BY_SPEC entry that always reverts atomically; it cannot retain msg.value."],
  ["missing-zero-check|Low|src/core/DomainVaultV1.sol|constructor|nativeAsset", "address(0) is the immutable native-ETH asset identifier, not an omitted address validation."],
  ["assembly|Informational|src/profiles/CanonicalEOASignatureV1.sol|CanonicalEOASignatureV1|recover(bytes32,bytes)", "Memory-safe assembly copies the exact canonical 65-byte signature fields."],
  ["assembly|Informational|src/profiles/ERC1271VerifierV1.sol|ERC1271VerifierV1|verify(address,bytes32,bytes)", "Memory-safe assembly caps and copies hostile ERC-1271 returndata."],
  ["assembly|Informational|src/profiles/NativeETHProfileV1.sol|NativeETHProfileV1|pushExact(address,uint128)", "Memory-safe assembly performs the gas-bounded native transfer and caps returndata."],
  ["assembly|Informational|src/profiles/StrictMeasuredERC20ProfileV1.sol|StrictMeasuredERC20ProfileV1|_callBoolean(address,bytes4,bytes)", "Memory-safe assembly caps hostile token call returndata."],
  ["assembly|Informational|src/profiles/StrictMeasuredERC20ProfileV1.sol|StrictMeasuredERC20ProfileV1|balanceOfExact(address,address)", "Memory-safe assembly caps hostile balanceOf returndata."],
  ["dead-code|Informational|src/core/ExecutionLockV1.sol|ExecutionLockV1|_phaseForInternalUse()", "The phase read is a protected-execution foundation retained while the execution ABI is BLOCKED_BY_SPEC."],
  ["dead-code|Informational|src/core/ExecutionLockV1.sol|ExecutionLockV1|_transitionPhase(ExecutionLockV1.Phase,ExecutionLockV1.Phase)", "The phase transition is a protected-execution foundation retained while the execution ABI is BLOCKED_BY_SPEC."],
  ["naming-convention|Informational|src/core/CoreV1.sol|CoreV1|COLLECTOR", "Uppercase immutable public identity/configuration fields intentionally read as fixed deployment constants."],
  ["naming-convention|Informational|src/core/CoreV1.sol|CoreV1|CONSTITUTION_ID", "Uppercase immutable public identity/configuration fields intentionally read as fixed deployment constants."],
  ["naming-convention|Informational|src/core/CoreV1.sol|CoreV1|CORE_DEPLOYMENT_ID", "Uppercase immutable public identity/configuration fields intentionally read as fixed deployment constants."],
  ["naming-convention|Informational|src/core/CoreV1.sol|CoreV1|DEPLOYMENT_CHAIN_ID", "Uppercase immutable public identity/configuration fields intentionally read as fixed deployment constants."],
  ["naming-convention|Informational|src/core/DomainVaultV1.sol|DomainVaultV1|ASSET_PROFILE_ID", "Uppercase immutable public vault identity fields intentionally read as fixed deployment constants."],
  ["naming-convention|Informational|src/core/DomainVaultV1.sol|DomainVaultV1|CORE", "Uppercase immutable public vault identity fields intentionally read as fixed deployment constants."],
  ["naming-convention|Informational|src/core/DomainVaultV1.sol|DomainVaultV1|CORE_DEPLOYMENT_ID", "Uppercase immutable public vault identity fields intentionally read as fixed deployment constants."],
  ["naming-convention|Informational|src/core/DomainVaultV1.sol|DomainVaultV1|DOMAIN_REVISION_ID", "Uppercase immutable public vault identity fields intentionally read as fixed deployment constants."],
  ["naming-convention|Informational|src/core/DomainVaultV1.sol|DomainVaultV1|NATIVE_ASSET", "Uppercase immutable public vault identity fields intentionally read as fixed deployment constants."],
  ["naming-convention|Informational|src/core/DomainVaultV1.sol|DomainVaultV1|NATIVE_ASSET_RUNTIME_CODE_HASH", "Uppercase immutable public vault identity fields intentionally read as fixed deployment constants."],
  ["naming-convention|Informational|src/core/DomainVaultV1.sol|DomainVaultV1|VAULT_ID", "Uppercase immutable public vault identity fields intentionally read as fixed deployment constants."],
  ["naming-convention|Informational|src/interfaces/IDomainVaultV1.sol|IDomainVaultV1|ASSET_PROFILE_ID()", "The interface exactly mirrors the uppercase immutable vault getter."],
  ["naming-convention|Informational|src/interfaces/IDomainVaultV1.sol|IDomainVaultV1|CORE()", "The interface exactly mirrors the uppercase immutable vault getter."],
  ["naming-convention|Informational|src/interfaces/IDomainVaultV1.sol|IDomainVaultV1|CORE_DEPLOYMENT_ID()", "The interface exactly mirrors the uppercase immutable vault getter."],
  ["naming-convention|Informational|src/interfaces/IDomainVaultV1.sol|IDomainVaultV1|DOMAIN_REVISION_ID()", "The interface exactly mirrors the uppercase immutable vault getter."],
  ["naming-convention|Informational|src/interfaces/IDomainVaultV1.sol|IDomainVaultV1|NATIVE_ASSET()", "The interface exactly mirrors the uppercase immutable vault getter."],
  ["naming-convention|Informational|src/interfaces/IDomainVaultV1.sol|IDomainVaultV1|VAULT_ID()", "The interface exactly mirrors the uppercase immutable vault getter."],
  ["too-many-digits|Informational|src/core/CoreV1.sol|CoreV1|expectedDomainVault(bytes32,bytes32,address)", "The detector points to typed CREATE2 init-code hashing, not an unexplained numeric literal."]
]);

function fingerprint(detector) {
  const primary = detector.elements?.[0];
  if (!primary) throw new Error(`Detector ${detector.check ?? "unknown"} has no source element`);
  const source = primary.source_mapping?.filename_relative ?? "";
  const parent = primary.type_specific_fields?.parent?.name ?? primary.name ?? "";
  const identity = primary.type_specific_fields?.signature ?? primary.name ?? "";
  return `${detector.check}|${detector.impact}|${source}|${parent}|${identity}`;
}

try {
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  if (report.success !== true || !Array.isArray(report.results?.detectors)) {
    throw new Error("Slither did not return a successful detector result set");
  }

  const seen = new Set();
  const triaged = [];
  for (const detector of report.results.detectors) {
    const key = fingerprint(detector);
    const rationale = accepted.get(key);
    if (!rationale) throw new Error(`Unreviewed Slither finding: ${key}`);
    if (seen.has(key)) throw new Error(`Duplicate Slither finding exceeds its reviewed allowance: ${key}`);
    seen.add(key);
    triaged.push({ key, rationale });
  }

  triaged.sort((left, right) => left.key.localeCompare(right.key));
  process.stdout.write(`Slither every-finding triage verified: ${triaged.length} reviewed findings; no unreviewed target or duplicate.\n`);
  for (const item of triaged) process.stdout.write(`- ${item.key}: ${item.rationale}\n`);
} catch (error) {
  process.stderr.write(`Slither finding triage failed: ${error.message}\n`);
  process.exitCode = 1;
}
