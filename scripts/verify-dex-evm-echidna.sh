#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
package_root="$repository_root/packages/dex-evm"
expected_harness_relative="test/invariant/ProtocolAssessmentEchidna.sol"
expected_harness_contract="ProtocolAssessmentEchidna"
expected_test_limit="50000"
expected_sequence_length="100"
expected_timeout_seconds="300"
expected_workers="1"
expected_seed="46630"
expected_foundry_commit="4072e48705af9d93e3c0f6e29e93b5e9a40caed8"
harness_relative="${PROGRAMMABLE_DEX_ECHIDNA_HARNESS:-$expected_harness_relative}"
harness_contract="${PROGRAMMABLE_DEX_ECHIDNA_CONTRACT:-$expected_harness_contract}"
test_limit="${PROGRAMMABLE_DEX_ECHIDNA_TEST_LIMIT:-$expected_test_limit}"
sequence_length="${PROGRAMMABLE_DEX_ECHIDNA_SEQUENCE_LENGTH:-$expected_sequence_length}"
timeout_seconds="${PROGRAMMABLE_DEX_ECHIDNA_TIMEOUT_SECONDS:-$expected_timeout_seconds}"
workers="${PROGRAMMABLE_DEX_ECHIDNA_WORKERS:-$expected_workers}"
harness_path="$package_root/$harness_relative"

if [[ "$harness_relative" != "$expected_harness_relative" || "$harness_contract" != "$expected_harness_contract" ]]; then
  echo "The exact Echidna harness and contract are fixed for this campaign" >&2
  exit 1
fi
if [[ "$test_limit" != "$expected_test_limit" || "$sequence_length" != "$expected_sequence_length" \
  || "$timeout_seconds" != "$expected_timeout_seconds" || "$workers" != "$expected_workers" ]]; then
  echo "The Echidna campaign budget must remain test-limit=50000, seq-len=100, timeout=300, workers=1" >&2
  exit 1
fi
if [[ ! -f "$harness_path" || -L "$harness_path" ]]; then
  echo "Required Echidna harness is absent or not an ordinary file: $harness_relative" >&2
  exit 1
fi

if [[ "${FOUNDRY_PROFILE:-ci}" != "ci" ]]; then
  echo "FOUNDRY_PROFILE must be ci for the exact Echidna campaign" >&2
  exit 1
fi
export FOUNDRY_PROFILE=ci

if [[ "$(node --version)" != "v24.14.0" ]]; then
  echo "Node.js v24.14.0 is required for the exact Echidna campaign" >&2
  exit 1
fi

forge_version="$(forge --version)"
if [[ "$(printf '%s\n' "$forge_version" | sed -n '1p')" != "forge Version: 1.7.1" ]] \
  || [[ "$(printf '%s\n' "$forge_version" | sed -n '2p')" != "Commit SHA: $expected_foundry_commit" ]]; then
  echo "Foundry v1.7.1 at commit $expected_foundry_commit is required for the exact Echidna campaign" >&2
  exit 1
fi

if [[ "$(slither --version 2>&1 | tr -d '[:space:]')" != "0.11.5" ]]; then
  echo "Slither 0.11.5 is required for the exact Echidna campaign" >&2
  exit 1
fi

echo "[dex-evm/echidna] exact clean forge-std dependency and Foundry policy"
bash "$repository_root/scripts/bootstrap-dex-evm-deps.sh"
node "$repository_root/scripts/verify-dex-evm-package.mjs"
node "$repository_root/scripts/verify-dex-evm-import-boundary.mjs"

echo "[dex-evm/echidna] exact Solidity 0.8.26 artifact metadata"
(
  cd "$package_root"
  forge clean
  forge build
)
node "$repository_root/scripts/generate-dex-evm-build-artifacts.mjs" --check

echidna_bin="${ECHIDNA_BIN:-}"
if [[ -z "$echidna_bin" ]]; then
  echidna_bin="$(command -v echidna || true)"
fi
if [[ -z "$echidna_bin" || ! -x "$echidna_bin" ]]; then
  echo "Echidna 2.3.3 is required when the stateful harness exists" >&2
  exit 1
fi
if [[ "$($echidna_bin --version 2>&1 | tr -d '\r')" != "Echidna 2.3.3" ]]; then
  echo "Echidna 2.3.3 is required" >&2
  exit 1
fi

campaign_root="$(mktemp -d "${TMPDIR:-/tmp}/programmable-dex-echidna.XXXXXX")"
trap 'rm -rf "$campaign_root"' EXIT
campaign_log="$campaign_root/echidna.log"

cd "$package_root"
if ! "$echidna_bin" "$harness_relative" \
  --contract "$harness_contract" \
  --test-mode property \
  --test-limit "$test_limit" \
  --seq-len "$sequence_length" \
  --timeout "$timeout_seconds" \
  --workers "$workers" \
  --seed "$expected_seed" \
  --corpus-dir "$campaign_root/corpus" \
  --coverage-dir "$campaign_root/coverage" \
  --format text \
  --disable-onchain-sources \
  >"$campaign_log" 2>&1; then
  cat "$campaign_log" >&2
  exit 1
fi
cat "$campaign_log"

ECHIDNA_CAMPAIGN_LOG="$campaign_log" \
ECHIDNA_EXPECTED_SEED="$expected_seed" \
ECHIDNA_EXPECTED_TEST_LIMIT="$test_limit" \
node --input-type=module <<'NODE'
import { readFile } from "node:fs/promises";

const expectedProperties = [
  "echidna_assessment_never_exceeds_basis",
  "echidna_cumulative_floor_is_exact",
  "echidna_denominator_is_fixed"
].sort();
const text = (await readFile(process.env.ECHIDNA_CAMPAIGN_LOG, "utf8"))
  .replace(/\u001B\[[0-?]*[ -/]*[@-~]/gu, "");
const lines = text.split(/\r?\n/u);
const results = lines.flatMap((line) => {
  const match = /^(echidna_[A-Za-z0-9_]+): (passing|failing)$/u.exec(line);
  return match === null ? [] : [{ name: match[1], status: match[2] }];
});
if (results.length !== expectedProperties.length) {
  throw new Error(`Expected exactly ${expectedProperties.length} Echidna property results, received ${results.length}`);
}
const actualProperties = results.map(({ name }) => name).sort();
if (JSON.stringify(actualProperties) !== JSON.stringify(expectedProperties)) {
  throw new Error(`Echidna property set mismatch: ${JSON.stringify(actualProperties)}`);
}
for (const result of results) {
  if (result.status !== "passing") throw new Error(`Echidna property did not pass: ${result.name}`);
}

const seedMatches = [...text.matchAll(/^Seed: ([0-9]+)$/gmu)].map((match) => match[1]);
if (seedMatches.length !== 1 || seedMatches[0] !== process.env.ECHIDNA_EXPECTED_SEED) {
  throw new Error(`Echidna seed mismatch: ${JSON.stringify(seedMatches)}`);
}
const callMatches = [...text.matchAll(/^Total calls: ([0-9]+)$/gmu)].map((match) => Number(match[1]));
const testLimit = Number(process.env.ECHIDNA_EXPECTED_TEST_LIMIT);
if (callMatches.length !== 1 || !Number.isSafeInteger(callMatches[0]) || callMatches[0] < testLimit) {
  throw new Error(`Echidna total-call boundary mismatch: ${JSON.stringify(callMatches)}`);
}
process.stdout.write(
  `Echidna exact campaign verified: ${expectedProperties.length}/${expectedProperties.length} properties passed; `
    + `seed ${seedMatches[0]}; ${callMatches[0]} calls (>=${testLimit}).\n`
);
NODE

echo "[dex-evm/echidna] dependency pin remains clean after the campaign"
bash "$repository_root/scripts/bootstrap-dex-evm-deps.sh"
