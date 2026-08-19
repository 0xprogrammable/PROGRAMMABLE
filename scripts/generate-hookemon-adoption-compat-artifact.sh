#!/bin/sh
# Regenerates or checks the canonical, lib-free Hookemon adoption-compat artifact.
set -eu

mode=${1:---write}
case "$mode" in
    --write | --check) ;;
    *)
        echo "usage: $0 [--write|--check]" >&2
        exit 2
        ;;
esac

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"

for command_name in forge cast node jq shasum awk sed xxd mktemp cmp; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
        echo "missing required command: $command_name" >&2
        exit 1
    fi
done

artifact="artifacts/hookemon-completed-graph-adoption-compat-v1.json"
config="config/hookemon-compat/foundry.toml"
generator="scripts/generate-hookemon-adoption-compat-artifact.sh"
checker="scripts/check-hookemon-adoption-compat-artifact.sh"
tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/hookemon-adoption-compat.XXXXXX")
trap 'rm -rf -- "$tmp_dir"' EXIT HUP INT TERM
build_out="$tmp_dir/out"
build_cache="$tmp_dir/cache"
test_log="$tmp_dir/forge-test.log"
candidate="$tmp_dir/artifact.json"

FOUNDRY_CONFIG="$config" FOUNDRY_OUT="$build_out" FOUNDRY_CACHE_PATH="$build_cache" forge build >/dev/null
FOUNDRY_CONFIG="$config" FOUNDRY_OUT="$build_out" FOUNDRY_CACHE_PATH="$build_cache" \
    forge test --match-contract ProgrammableCompletedGraphAdoptionCompatV1Test >"$test_log"

interface_out="$build_out/IProgrammableCompletedGraphAdoptionCompatV1.sol/IProgrammableCompletedGraphAdoptionCompatV1.json"
state_verifier_out="$build_out/IProgrammableCompletedGraphAdoptionCompatV1.sol/IProgrammableCompletedGraphAdoptionStateVerifierV1.json"
preflight_interface_out="$build_out/IProgrammableCompletedGraphAdoptionCompatV1.sol/IProgrammableCompletedGraphAdoptionPreflightV1.json"
codec_out="$build_out/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol/ProgrammableCompletedGraphAdoptionCompatCodecV1.json"
validator_out="$build_out/ProgrammableCompletedGraphAdoptionValidatorV1.sol/ProgrammableCompletedGraphAdoptionValidatorV1.json"
preflight_out="$build_out/ProgrammableCompletedGraphAdoptionPreflightV1.sol/ProgrammableCompletedGraphAdoptionPreflightV1.json"
registry_out="$build_out/ProgrammableCompletedGraphAdoptionGrantRegistryV1.sol/ProgrammableCompletedGraphAdoptionGrantRegistryV1.json"
test_out="$build_out/ProgrammableCompletedGraphAdoptionCompatV1.t.sol/ProgrammableCompletedGraphAdoptionCompatV1Test.json"

for output_path in "$interface_out" "$state_verifier_out" "$preflight_interface_out" "$codec_out" "$validator_out" "$preflight_out" "$registry_out" "$test_out"; do
    if [ ! -f "$output_path" ]; then
        echo "missing compiler output: $output_path" >&2
        exit 1
    fi
done

if ! jq -e '
    .metadata.compiler.version == "0.8.26+commit.8a97fa7a"
    and .metadata.settings.evmVersion == "cancun"
    and .metadata.settings.optimizer.enabled == true
    and .metadata.settings.optimizer.runs == 1000
    and ((.metadata.settings.viaIR // false) == false)
    and .metadata.settings.metadata.bytecodeHash == "none"
    and .metadata.settings.metadata.appendCBOR == false
    and (.metadata.settings.libraries | length) == 0
    and (.metadata.sources | keys) == [
        "src/hookemon/IProgrammableCompletedGraphAdoptionCompatV1.sol",
        "src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol",
        "src/hookemon/ProgrammableCompletedGraphAdoptionGrantRegistryV1.sol",
        "src/hookemon/ProgrammableCompletedGraphAdoptionPreflightV1.sol",
        "src/hookemon/ProgrammableCompletedGraphAdoptionValidatorV1.sol"
    ]
' "$registry_out" >/dev/null; then
    echo "compiler profile is not the pinned local-only 0.8.26/Cancun/optimizer-1000/non-viaIR profile" >&2
    exit 1
fi

source_hash() {
    shasum -a 256 "$1" | awk '{print $1}'
}

abi_hash() {
    canonical_abi=$(jq -cS '.abi' "$1")
    printf '%s' "$canonical_abi" | shasum -a 256 | awk '{print $1}'
}

bytecode_hex() {
    jq -r "$2.object" "$1" | sed 's/^0x//'
}

bytecode_hash() {
    bytecode_hex "$1" "$2" | xxd -r -p | shasum -a 256 | awk '{print $1}'
}

bytecode_keccak() {
    hex=$(bytecode_hex "$1" "$2")
    cast keccak "0x$hex"
}

extract_keccak_preimage() {
    source_path=$1
    constant_name=$2
    node - "$source_path" "$constant_name" <<'NODE'
const fs = require("node:fs");
const [sourcePath, constantName] = process.argv.slice(2);
const source = fs.readFileSync(sourcePath, "utf8");
const escaped = constantName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const expression = new RegExp(
  String.raw`(?:bytes32\s+(?:public|private|internal)\s+constant\s+${escaped}\s*=\s*)keccak256\s*\(\s*((?:"(?:\\.|[^"\\])*"\s*)+)\)\s*;`,
  "m",
).exec(source);
if (expression === null) {
  throw new Error(`missing canonical keccak preimage for ${constantName} in ${sourcePath}`);
}
const literals = expression[1].match(/"(?:\\.|[^"\\])*"/g) ?? [];
if (literals.length === 0) throw new Error(`empty canonical preimage for ${constantName}`);
process.stdout.write(literals.map((literal) => JSON.parse(literal)).join(""));
NODE
}

extract_uint_constant() {
    source_path=$1
    constant_name=$2
    node - "$source_path" "$constant_name" <<'NODE'
const fs = require("node:fs");
const [sourcePath, constantName] = process.argv.slice(2);
const source = fs.readFileSync(sourcePath, "utf8");
const escaped = constantName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const match = new RegExp(
  String.raw`uint(?:8|16|32|64|128|256)?\s+(?:public|private|internal)\s+constant\s+${escaped}\s*=\s*([^;]+);`,
  "m",
).exec(source);
if (match === null) throw new Error(`missing numeric constant ${constantName} in ${sourcePath}`);
const normalized = match[1].trim().replaceAll("_", "");
const value = /^(\d+)$/.exec(normalized);
const duration = /^(\d+)\s+(seconds|minutes|hours|days)$/.exec(normalized);
if (value !== null) {
  process.stdout.write(value[1]);
} else if (duration !== null) {
  const multiplier = { seconds: 1n, minutes: 60n, hours: 3600n, days: 86400n }[duration[2]];
  process.stdout.write((BigInt(duration[1]) * multiplier).toString());
} else {
  throw new Error(`unsupported numeric constant expression ${constantName}=${match[1].trim()}`);
}
NODE
}

keccak_constant() {
    source_path=$1
    constant_name=$2
    preimage=$(extract_keccak_preimage "$source_path" "$constant_name")
    cast keccak "$preimage"
}

selector() {
    function_name=$2
    value=$(jq -r --arg function_name "$function_name" '
        .methodIdentifiers
        | to_entries[]
        | select(.key | startswith($function_name + "("))
        | "0x" + .value
    ' "$1" | awk 'NR == 1 {print; exit}')
    if [ -z "$value" ]; then
        echo "missing selector for $function_name in $1" >&2
        exit 1
    fi
    printf '%s\n' "$value"
}

interface_source_sha=$(source_hash "src/hookemon/IProgrammableCompletedGraphAdoptionCompatV1.sol")
codec_source_sha=$(source_hash "src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol")
validator_source_sha=$(source_hash "src/hookemon/ProgrammableCompletedGraphAdoptionValidatorV1.sol")
preflight_source_sha=$(source_hash "src/hookemon/ProgrammableCompletedGraphAdoptionPreflightV1.sol")
registry_source_sha=$(source_hash "src/hookemon/ProgrammableCompletedGraphAdoptionGrantRegistryV1.sol")
test_source_sha=$(source_hash "test/hookemon/ProgrammableCompletedGraphAdoptionCompatV1.t.sol")

interface_abi_sha=$(abi_hash "$interface_out")
state_verifier_abi_sha=$(abi_hash "$state_verifier_out")
preflight_interface_abi_sha=$(abi_hash "$preflight_interface_out")
codec_abi_sha=$(abi_hash "$codec_out")
validator_abi_sha=$(abi_hash "$validator_out")
preflight_abi_sha=$(abi_hash "$preflight_out")
registry_abi_sha=$(abi_hash "$registry_out")
test_abi_sha=$(abi_hash "$test_out")

codec_runtime_hex=$(bytecode_hex "$codec_out" '.deployedBytecode')
codec_init_hex=$(bytecode_hex "$codec_out" '.bytecode')
validator_runtime_hex=$(bytecode_hex "$validator_out" '.deployedBytecode')
validator_init_hex=$(bytecode_hex "$validator_out" '.bytecode')
preflight_runtime_hex=$(bytecode_hex "$preflight_out" '.deployedBytecode')
preflight_init_hex=$(bytecode_hex "$preflight_out" '.bytecode')
registry_runtime_hex=$(bytecode_hex "$registry_out" '.deployedBytecode')
registry_init_hex=$(bytecode_hex "$registry_out" '.bytecode')

codec_runtime_bytes=$((${#codec_runtime_hex} / 2))
codec_init_bytes=$((${#codec_init_hex} / 2))
validator_runtime_bytes=$((${#validator_runtime_hex} / 2))
validator_init_bytes=$((${#validator_init_hex} / 2))
preflight_runtime_bytes=$((${#preflight_runtime_hex} / 2))
preflight_init_bytes=$((${#preflight_init_hex} / 2))
registry_runtime_bytes=$((${#registry_runtime_hex} / 2))
registry_init_bytes=$((${#registry_init_hex} / 2))

codec_runtime_sha=$(bytecode_hash "$codec_out" '.deployedBytecode')
codec_init_sha=$(bytecode_hash "$codec_out" '.bytecode')
validator_runtime_sha=$(bytecode_hash "$validator_out" '.deployedBytecode')
validator_init_sha=$(bytecode_hash "$validator_out" '.bytecode')
preflight_runtime_sha=$(bytecode_hash "$preflight_out" '.deployedBytecode')
preflight_init_sha=$(bytecode_hash "$preflight_out" '.bytecode')
registry_runtime_sha=$(bytecode_hash "$registry_out" '.deployedBytecode')
registry_init_sha=$(bytecode_hash "$registry_out" '.bytecode')
codec_runtime_keccak=$(bytecode_keccak "$codec_out" '.deployedBytecode')
codec_init_keccak=$(bytecode_keccak "$codec_out" '.bytecode')
validator_runtime_keccak=$(bytecode_keccak "$validator_out" '.deployedBytecode')
validator_init_keccak=$(bytecode_keccak "$validator_out" '.bytecode')
preflight_runtime_keccak=$(bytecode_keccak "$preflight_out" '.deployedBytecode')
preflight_init_keccak=$(bytecode_keccak "$preflight_out" '.bytecode')
registry_runtime_keccak=$(bytecode_keccak "$registry_out" '.deployedBytecode')
registry_init_keccak=$(bytecode_keccak "$registry_out" '.bytecode')

test_count=$(sed -n 's/.*Suite result: ok\. \([0-9][0-9]*\) passed;.*/\1/p' "$test_log" | tail -n 1)
winner_fuzz_runs=$(sed -n 's/.*testFuzzWinnerKeyHasExactlyOneActiveGrant(bytes32).*runs: \([0-9][0-9]*\),.*/\1/p' "$test_log" | tail -n 1)
if [ -z "$test_count" ] || [ -z "$winner_fuzz_runs" ]; then
    echo "could not parse focused test/fuzz evidence" >&2
    exit 1
fi

register_selector=$(selector "$registry_out" 'registerAdoptionProfileV1')
set_status_selector=$(selector "$registry_out" 'setAdoptionProfileStatusV1')
set_kill_selector=$(selector "$registry_out" 'setGlobalAdoptionKillV1')
activate_selector=$(selector "$registry_out" 'activateLaunchGrantV1')
revoke_grant_selector=$(selector "$registry_out" 'revokeLaunchGrantV1')
revoke_currentness_selector=$(selector "$registry_out" 'revokeExecutionCurrentnessV1')
adopt_selector=$(selector "$registry_out" 'adoptCompletedGraphV1')
advance_finality_selector=$(selector "$registry_out" 'advanceFinalityIndexingV1')
advance_controls_selector=$(selector "$registry_out" 'advanceSecurityPolicyEpochsV1')
grant_digest_selector=$(selector "$registry_out" 'launchGrantDigest')
currentness_digest_selector=$(selector "$registry_out" 'executionCurrentnessDigest')
preflight_control_selector=$(selector "$registry_out" 'preflightControlStateV1')
preflight_grant_receipt_selector=$(selector "$registry_out" 'preflightGrantReceiptStateV1')
preflight_component_selector=$(selector "$registry_out" 'preflightComponentStateV1')
canonical_receipt_selector=$(selector "$registry_out" 'canonicalReceiptCore')
preflight_readback_selector=$(selector "$preflight_out" 'adoptionPreflightReadbackV1')
preflight_aggregate_selector=$(selector "$preflight_out" 'computeAdoptionPreflightAggregateV1')
verify_state_selector=$(selector "$state_verifier_out" 'verifyCurrentStateV1')
validate_profile_selector=$(selector "$validator_out" 'validateProfileCapabilityV1')
validate_grant_selector=$(selector "$validator_out" 'validateLaunchGrantV1')
validate_envelope_selector=$(selector "$validator_out" 'validateAdoptionEnvelopeV1')
source_commit_selector=$(selector "$codec_out" 'computeSourceCommitHash')
source_tree_selector=$(selector "$codec_out" 'computeSourceTreeHash')
stamp_launch_id_selector=$(selector "$codec_out" 'computeStampLaunchId')
winner_key_selector=$(selector "$codec_out" 'computeWinnerKeyHash')
source_revision_matches_selector=$(selector "$codec_out" 'sourceRevisionMatches')
preflight_query_hash_selector=$(selector "$codec_out" 'computeAdoptionPreflightQueryHash')
preflight_component_leaf_selector=$(selector "$codec_out" 'computeAdoptionPreflightComponentLeafHash')
preflight_global_head_selector=$(selector "$codec_out" 'computeAdoptionPreflightGlobalHeadHash')
preflight_readback_hash_selector=$(selector "$codec_out" 'computeAdoptionPreflightReadbackHash')

typehash_rows="$tmp_dir/typehashes.jsonl"
: >"$typehash_rows"
while IFS='|' read -r key source_path constant_name; do
    [ -n "$key" ] || continue
    preimage=$(extract_keccak_preimage "$source_path" "$constant_name")
    hash=$(cast keccak "$preimage")
    jq -cn --arg key "$key" --arg constant "$constant_name" --arg preimage "$preimage" --arg hash "$hash" \
        '{key:$key,constant:$constant,preimage:$preimage,hash:$hash}' >>"$typehash_rows"
done <<'TYPEHASH_ROWS'
profileKey|src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol|PROFILE_KEY_TYPEHASH
plan|src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol|PLAN_TYPEHASH
sourceCommit|src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol|SOURCE_COMMIT_TYPEHASH
sourceTree|src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol|SOURCE_TREE_TYPEHASH
launchGrantBindingA|src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol|LAUNCH_GRANT_BINDING_A_TYPEHASH
launchGrantBindingB|src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol|LAUNCH_GRANT_BINDING_B_TYPEHASH
launchGrantReview|src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol|LAUNCH_GRANT_REVIEW_TYPEHASH
launchGrant|src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol|LAUNCH_GRANT_TYPEHASH
executionCurrentness|src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol|EXECUTION_CURRENTNESS_TYPEHASH
preflightQuery|src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol|PREFLIGHT_QUERY_TYPEHASH
preflightRuntimeControl|src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol|PREFLIGHT_RUNTIME_CONTROL_TYPEHASH
preflightLifecycle|src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol|PREFLIGHT_LIFECYCLE_TYPEHASH
preflightReservation|src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol|PREFLIGHT_RESERVATION_TYPEHASH
preflightComponentLeaf|src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol|PREFLIGHT_COMPONENT_LEAF_TYPEHASH
preflightGlobalHead|src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol|PREFLIGHT_GLOBAL_HEAD_TYPEHASH
preflightReadback|src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol|PREFLIGHT_READBACK_TYPEHASH
adoptionRequest|src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol|ADOPTION_REQUEST_TYPEHASH
profileCapability|src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol|PROFILE_CAPABILITY_TYPEHASH
stampLaunchId|src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol|STAMP_LAUNCH_ID_TYPEHASH
winnerKey|src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol|WINNER_KEY_TYPEHASH
component|src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol|COMPONENT_TYPEHASH
componentConfiguration|src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol|COMPONENT_CONFIGURATION_TYPEHASH
sharedComponentIdentity|src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol|SHARED_COMPONENT_IDENTITY_TYPEHASH
componentCreationEvidence|src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol|COMPONENT_CREATION_EVIDENCE_TYPEHASH
componentCreationEvidenceSource|src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol|COMPONENT_CREATION_EVIDENCE_SOURCE_TYPEHASH
componentCreationEvidenceComponent|src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol|COMPONENT_CREATION_EVIDENCE_COMPONENT_TYPEHASH
creationReceiptEvidence|src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol|CREATION_RECEIPT_EVIDENCE_TYPEHASH
edge|src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol|EDGE_TYPEHASH
componentGraph|src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol|COMPONENT_GRAPH_TYPEHASH
runtimeSet|src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol|RUNTIME_SET_TYPEHASH
configurationSet|src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol|CONFIGURATION_SET_TYPEHASH
configuration|src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol|CONFIGURATION_TYPEHASH
result|src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol|RESULT_TYPEHASH
applicationIdentity|src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol|APPLICATION_IDENTITY_TYPEHASH
canonicalReceiptCore|src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol|CANONICAL_RECEIPT_CORE_TYPEHASH
finalityIndexingReceipt|src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol|FINALITY_INDEXING_RECEIPT_TYPEHASH
grantStateHead|src/hookemon/ProgrammableCompletedGraphAdoptionGrantRegistryV1.sol|GRANT_STATE_HEAD_TYPEHASH
preflightAuthorityRoles|src/hookemon/ProgrammableCompletedGraphAdoptionGrantRegistryV1.sol|PREFLIGHT_AUTHORITY_ROLES_TYPEHASH
preflightCoreDependencies|src/hookemon/ProgrammableCompletedGraphAdoptionGrantRegistryV1.sol|PREFLIGHT_CORE_DEPENDENCIES_TYPEHASH
preflightBaseRuntimeBinding|src/hookemon/ProgrammableCompletedGraphAdoptionGrantRegistryV1.sol|PREFLIGHT_BASE_RUNTIME_BINDING_TYPEHASH
preflightProfileRuntimeBinding|src/hookemon/ProgrammableCompletedGraphAdoptionGrantRegistryV1.sol|PREFLIGHT_PROFILE_RUNTIME_BINDING_TYPEHASH
preflightRuntimeAuthorityBinding|src/hookemon/ProgrammableCompletedGraphAdoptionGrantRegistryV1.sol|PREFLIGHT_RUNTIME_AUTHORITY_BINDING_TYPEHASH
eip712Domain|src/hookemon/ProgrammableCompletedGraphAdoptionGrantRegistryV1.sol|EIP712_DOMAIN_TYPEHASH
TYPEHASH_ROWS

typehashes_json=$(jq -cs 'reduce .[] as $row ({}; .[$row.key] = $row.hash)' "$typehash_rows")
typehash_preimages_json=$(jq -cs 'reduce .[] as $row ({}; .[$row.key] = {constant:$row.constant,preimage:$row.preimage})' "$typehash_rows")

codec_id_hash=$(keccak_constant "src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol" CODEC_ID_HASH)
validator_id_hash=$(keccak_constant "src/hookemon/ProgrammableCompletedGraphAdoptionValidatorV1.sol" VALIDATOR_ID_HASH)
preflight_id_hash=$(keccak_constant "src/hookemon/ProgrammableCompletedGraphAdoptionPreflightV1.sol" PREFLIGHT_ID_HASH)
readiness_constraint_hash=$(keccak_constant "src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol" ADOPTION_ONLY_READINESS_CONSTRAINT_HASH)
eip712_name_hash=$(keccak_constant "src/hookemon/ProgrammableCompletedGraphAdoptionGrantRegistryV1.sol" EIP712_NAME_HASH)
eip712_version_hash=$(keccak_constant "src/hookemon/ProgrammableCompletedGraphAdoptionGrantRegistryV1.sol" EIP712_VERSION_HASH)

max_components=$(extract_uint_constant "src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol" MAX_COMPONENTS)
max_edges=$(extract_uint_constant "src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol" MAX_EDGES)
max_currentness_lifetime=$(extract_uint_constant "src/hookemon/ProgrammableCompletedGraphAdoptionGrantRegistryV1.sol" MAX_CURRENTNESS_LIFETIME)
max_signature_bytes=$(extract_uint_constant "src/hookemon/ProgrammableCompletedGraphAdoptionGrantRegistryV1.sol" MAX_SIGNATURE_BYTES)
authority_gas_reserve=$(extract_uint_constant "src/hookemon/ProgrammableCompletedGraphAdoptionGrantRegistryV1.sol" AUTHORITY_GAS_RESERVE)
max_authority_gas=$(extract_uint_constant "src/hookemon/ProgrammableCompletedGraphAdoptionGrantRegistryV1.sol" MAX_AUTHORITY_STATICCALL_GAS)
state_verifier_gas_reserve=$(extract_uint_constant "src/hookemon/ProgrammableCompletedGraphAdoptionValidatorV1.sol" STATE_VERIFIER_GAS_RESERVE)
max_state_verifier_gas=$(extract_uint_constant "src/hookemon/ProgrammableCompletedGraphAdoptionValidatorV1.sol" MAX_STATE_VERIFIER_STATICCALL_GAS)

config_sha=$(source_hash "$config")
remappings_sha=$(source_hash "remappings.txt")
generator_sha=$(source_hash "$generator")
checker_sha=$(source_hash "$checker")

jq \
    --arg interface_source_sha "$interface_source_sha" \
    --arg codec_source_sha "$codec_source_sha" \
	--arg validator_source_sha "$validator_source_sha" \
	--arg preflight_source_sha "$preflight_source_sha" \
	--arg registry_source_sha "$registry_source_sha" \
    --arg test_source_sha "$test_source_sha" \
    --arg interface_abi_sha "$interface_abi_sha" \
	--arg state_verifier_abi_sha "$state_verifier_abi_sha" \
	--arg preflight_interface_abi_sha "$preflight_interface_abi_sha" \
	--arg codec_abi_sha "$codec_abi_sha" \
	--arg validator_abi_sha "$validator_abi_sha" \
	--arg preflight_abi_sha "$preflight_abi_sha" \
    --arg registry_abi_sha "$registry_abi_sha" \
    --arg test_abi_sha "$test_abi_sha" \
    --arg codec_runtime_sha "$codec_runtime_sha" \
    --arg codec_init_sha "$codec_init_sha" \
	--arg validator_runtime_sha "$validator_runtime_sha" \
	--arg validator_init_sha "$validator_init_sha" \
	--arg preflight_runtime_sha "$preflight_runtime_sha" \
	--arg preflight_init_sha "$preflight_init_sha" \
    --arg registry_runtime_sha "$registry_runtime_sha" \
    --arg registry_init_sha "$registry_init_sha" \
    --arg codec_runtime_keccak "$codec_runtime_keccak" \
    --arg codec_init_keccak "$codec_init_keccak" \
	--arg validator_runtime_keccak "$validator_runtime_keccak" \
	--arg validator_init_keccak "$validator_init_keccak" \
	--arg preflight_runtime_keccak "$preflight_runtime_keccak" \
	--arg preflight_init_keccak "$preflight_init_keccak" \
    --arg registry_runtime_keccak "$registry_runtime_keccak" \
    --arg registry_init_keccak "$registry_init_keccak" \
    --arg register_selector "$register_selector" \
    --arg set_status_selector "$set_status_selector" \
    --arg set_kill_selector "$set_kill_selector" \
    --arg activate_selector "$activate_selector" \
    --arg revoke_grant_selector "$revoke_grant_selector" \
    --arg revoke_currentness_selector "$revoke_currentness_selector" \
    --arg adopt_selector "$adopt_selector" \
    --arg advance_finality_selector "$advance_finality_selector" \
    --arg advance_controls_selector "$advance_controls_selector" \
	--arg grant_digest_selector "$grant_digest_selector" \
	--arg currentness_digest_selector "$currentness_digest_selector" \
	--arg preflight_control_selector "$preflight_control_selector" \
	--arg preflight_grant_receipt_selector "$preflight_grant_receipt_selector" \
	--arg preflight_component_selector "$preflight_component_selector" \
	--arg canonical_receipt_selector "$canonical_receipt_selector" \
	--arg preflight_readback_selector "$preflight_readback_selector" \
	--arg preflight_aggregate_selector "$preflight_aggregate_selector" \
	--arg verify_state_selector "$verify_state_selector" \
	--arg validate_profile_selector "$validate_profile_selector" \
	--arg validate_grant_selector "$validate_grant_selector" \
	--arg validate_envelope_selector "$validate_envelope_selector" \
    --arg source_commit_selector "$source_commit_selector" \
    --arg source_tree_selector "$source_tree_selector" \
    --arg stamp_launch_id_selector "$stamp_launch_id_selector" \
    --arg winner_key_selector "$winner_key_selector" \
	--arg source_revision_matches_selector "$source_revision_matches_selector" \
	--arg preflight_query_hash_selector "$preflight_query_hash_selector" \
	--arg preflight_component_leaf_selector "$preflight_component_leaf_selector" \
	--arg preflight_global_head_selector "$preflight_global_head_selector" \
	--arg preflight_readback_hash_selector "$preflight_readback_hash_selector" \
	--arg codec_id_hash "$codec_id_hash" \
	--arg validator_id_hash "$validator_id_hash" \
	--arg preflight_id_hash "$preflight_id_hash" \
    --arg readiness_constraint_hash "$readiness_constraint_hash" \
    --arg eip712_name_hash "$eip712_name_hash" \
    --arg eip712_version_hash "$eip712_version_hash" \
    --arg config_sha "$config_sha" \
    --arg remappings_sha "$remappings_sha" \
    --arg generator_sha "$generator_sha" \
    --arg checker_sha "$checker_sha" \
    --argjson typehashes "$typehashes_json" \
    --argjson typehash_preimages "$typehash_preimages_json" \
    --argjson codec_runtime_bytes "$codec_runtime_bytes" \
    --argjson codec_init_bytes "$codec_init_bytes" \
	--argjson validator_runtime_bytes "$validator_runtime_bytes" \
	--argjson validator_init_bytes "$validator_init_bytes" \
	--argjson preflight_runtime_bytes "$preflight_runtime_bytes" \
	--argjson preflight_init_bytes "$preflight_init_bytes" \
    --argjson registry_runtime_bytes "$registry_runtime_bytes" \
    --argjson registry_init_bytes "$registry_init_bytes" \
    --argjson max_components "$max_components" \
    --argjson max_edges "$max_edges" \
    --argjson max_currentness_lifetime "$max_currentness_lifetime" \
    --argjson max_signature_bytes "$max_signature_bytes" \
    --argjson authority_gas_reserve "$authority_gas_reserve" \
    --argjson max_authority_gas "$max_authority_gas" \
    --argjson state_verifier_gas_reserve "$state_verifier_gas_reserve" \
    --argjson max_state_verifier_gas "$max_state_verifier_gas" \
    --argjson test_count "$test_count" \
    --argjson winner_fuzz_runs "$winner_fuzz_runs" '
	.schemaVersion = "1.4.0"
	| if any(.contracts[]; .name == "IProgrammableCompletedGraphAdoptionPreflightV1") then . else
	    .contracts += [{
	        name: "IProgrammableCompletedGraphAdoptionPreflightV1",
	        source: "src/hookemon/IProgrammableCompletedGraphAdoptionCompatV1.sol",
	        role: "IMMUTABLE_TYPED_PREFLIGHT_INTERFACE"
	    }]
	  end
	| if any(.contracts[]; .name == "ProgrammableCompletedGraphAdoptionPreflightV1") then . else
	    .contracts += [{
	        name: "ProgrammableCompletedGraphAdoptionPreflightV1",
	        source: "src/hookemon/ProgrammableCompletedGraphAdoptionPreflightV1.sol",
	        role: "IMMUTABLE_SIDE_EFFECT_FREE_PREFLIGHT_COMPANION"
	    }]
	  end
	| .contracts |= map(
        if .name == "IProgrammableCompletedGraphAdoptionCompatV1" then
            .sourceSha256 = $interface_source_sha
            | .abiSha256 = $interface_abi_sha
	    elif .name == "IProgrammableCompletedGraphAdoptionStateVerifierV1" then
	        .abiSha256 = $state_verifier_abi_sha
	    elif .name == "IProgrammableCompletedGraphAdoptionPreflightV1" then
	        .sourceSha256 = $interface_source_sha
	        | .abiSha256 = $preflight_interface_abi_sha
        elif .name == "ProgrammableCompletedGraphAdoptionCompatCodecV1" then
            .sourceSha256 = $codec_source_sha
            | .abiSha256 = $codec_abi_sha
            | .artifact = "out-hookemon-compat/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol/ProgrammableCompletedGraphAdoptionCompatCodecV1.json"
            | .runtimeBytes = $codec_runtime_bytes
            | .runtimeMarginToEip170Bytes = (24576 - $codec_runtime_bytes)
            | .runtimeSha256 = $codec_runtime_sha
            | .runtimeKeccak256 = $codec_runtime_keccak
            | .initcodeBytes = $codec_init_bytes
            | .initcodeSha256 = $codec_init_sha
            | .initcodeKeccak256 = $codec_init_keccak
	    elif .name == "ProgrammableCompletedGraphAdoptionValidatorV1" then
            .sourceSha256 = $validator_source_sha
            | .abiSha256 = $validator_abi_sha
            | .artifact = "out-hookemon-compat/ProgrammableCompletedGraphAdoptionValidatorV1.sol/ProgrammableCompletedGraphAdoptionValidatorV1.json"
            | .runtimeBytes = $validator_runtime_bytes
            | .runtimeMarginToEip170Bytes = (24576 - $validator_runtime_bytes)
            | .runtimeSha256 = $validator_runtime_sha
            | .runtimeKeccak256 = $validator_runtime_keccak
            | .initcodeBytes = $validator_init_bytes
	        | .initcodeSha256 = $validator_init_sha
	        | .initcodeKeccak256 = $validator_init_keccak
	    elif .name == "ProgrammableCompletedGraphAdoptionPreflightV1" then
	        .sourceSha256 = $preflight_source_sha
	        | .abiSha256 = $preflight_abi_sha
	        | .artifact = "out-hookemon-compat/ProgrammableCompletedGraphAdoptionPreflightV1.sol/ProgrammableCompletedGraphAdoptionPreflightV1.json"
	        | .runtimeBytes = $preflight_runtime_bytes
	        | .runtimeMarginToEip170Bytes = (24576 - $preflight_runtime_bytes)
	        | .runtimeSha256 = $preflight_runtime_sha
	        | .runtimeKeccak256 = $preflight_runtime_keccak
	        | .initcodeBytes = $preflight_init_bytes
	        | .initcodeSha256 = $preflight_init_sha
	        | .initcodeKeccak256 = $preflight_init_keccak
        elif .name == "ProgrammableCompletedGraphAdoptionGrantRegistryV1" then
            .sourceSha256 = $registry_source_sha
            | .abiSha256 = $registry_abi_sha
            | .artifact = "out-hookemon-compat/ProgrammableCompletedGraphAdoptionGrantRegistryV1.sol/ProgrammableCompletedGraphAdoptionGrantRegistryV1.json"
            | .runtimeBytes = $registry_runtime_bytes
            | .runtimeMarginToEip170Bytes = (24576 - $registry_runtime_bytes)
            | .runtimeSha256 = $registry_runtime_sha
            | .runtimeKeccak256 = $registry_runtime_keccak
            | .initcodeBytes = $registry_init_bytes
            | .initcodeSha256 = $registry_init_sha
            | .initcodeKeccak256 = $registry_init_keccak
        else . end
    )
    | .test.sourceSha256 = $test_source_sha
    | .test.abiSha256 = $test_abi_sha
    | .abiCanonicalization = "recursive JSON object-key sort via jq -cS; UTF-8 bytes; no trailing LF"
    | .canonicalConstants = {
	    codecIdHash: $codec_id_hash,
	    validatorIdHash: $validator_id_hash,
	    preflightIdHash: $preflight_id_hash,
	    preflightRequiredRuntimeMask: 511,
        adoptionOnlyReadinessConstraintHash: $readiness_constraint_hash,
        eip712NameHash: $eip712_name_hash,
        eip712VersionHash: $eip712_version_hash,
        maxComponents: $max_components,
        maxEdges: $max_edges,
        maxCurrentnessLifetimeSeconds: $max_currentness_lifetime,
        maxCurrentnessSignatureBytes: $max_signature_bytes,
        authorityGasReserve: $authority_gas_reserve,
        maxAuthorityStaticcallGas: $max_authority_gas,
        stateVerifierGasReserve: $state_verifier_gas_reserve,
        maxStateVerifierStaticcallGas: $max_state_verifier_gas
    }
    | .typehashes = $typehashes
    | .typehashPreimages = $typehash_preimages
    | .selectors = {
        registerAdoptionProfileV1: $register_selector,
        setAdoptionProfileStatusV1: $set_status_selector,
        setGlobalAdoptionKillV1: $set_kill_selector,
        activateLaunchGrantV1: $activate_selector,
        revokeLaunchGrantV1: $revoke_grant_selector,
        revokeExecutionCurrentnessV1: $revoke_currentness_selector,
        adoptCompletedGraphV1: $adopt_selector,
        advanceFinalityIndexingV1: $advance_finality_selector,
        advanceSecurityPolicyEpochsV1: $advance_controls_selector,
	    launchGrantDigest: $grant_digest_selector,
	    executionCurrentnessDigest: $currentness_digest_selector,
	    preflightControlStateV1: $preflight_control_selector,
	    preflightGrantReceiptStateV1: $preflight_grant_receipt_selector,
	    preflightComponentStateV1: $preflight_component_selector,
	    canonicalReceiptCore: $canonical_receipt_selector,
	    adoptionPreflightReadbackV1: $preflight_readback_selector,
	    computeAdoptionPreflightAggregateV1: $preflight_aggregate_selector,
	    verifyCurrentStateV1: $verify_state_selector,
	    validateProfileCapabilityV1: $validate_profile_selector,
	    validateLaunchGrantV1: $validate_grant_selector,
	    validateAdoptionEnvelopeV1: $validate_envelope_selector,
        computeSourceCommitHash: $source_commit_selector,
        computeSourceTreeHash: $source_tree_selector,
        computeStampLaunchId: $stamp_launch_id_selector,
	    computeWinnerKeyHash: $winner_key_selector,
	    sourceRevisionMatches: $source_revision_matches_selector,
	    computeAdoptionPreflightQueryHash: $preflight_query_hash_selector,
	    computeAdoptionPreflightComponentLeafHash: $preflight_component_leaf_selector,
	    computeAdoptionPreflightGlobalHeadHash: $preflight_global_head_selector,
	    computeAdoptionPreflightReadbackHash: $preflight_readback_hash_selector
    }
    | .compiler.sizeMethod = "Foundry standard JSON bytecode/deployedBytecode under the exact pinned profile"
    | .supersedes = {
        withdrawnCandidates: [
            {
                commit: "a688cde9d77a8fea652f48756e4e49ace5318569",
                verdict: "P0_FAIL",
                reason: "epoch/currentness revival, missing lifecycle kill and opaque current-state verification"
            },
            {
                commit: "d329cfab7d6aa0131b82343c9ca73365985b2d51",
                verdict: "P0_P1_FAIL",
                reason: "profile revival, stale artifact, runtime-only shared identity and overbroad dependency claim"
            }
        ]
    }
    | .identitySeparation = {
        sourceLaunchId: {
            role: "SOURCE_DEFINED_GRAPH_IDENTITY",
            formula: "exact reviewed source output copied into CompletedGraphPlanV1 and LaunchGrantV1",
            independentFrom: ["stampLaunchId", "antiReplayNonce"]
        },
        stampLaunchId: {
            role: "ROUTER_REGISTRY_CANONICAL_STAMP_IDENTITY",
            formula: "keccak256(abi.encode(STAMP_LAUNCH_ID_TYPEHASH, chainId, registry, launchWallet, profileKey, contractPlanHash, sourceLaunchId))",
            independentFrom: ["antiReplayNonce"]
        },
        antiReplayNonce: {
            role: "INDEPENDENT_TERMINAL_ONE_WINNER_NONCE",
            formula: "reviewer-bound nonzero bytes32 included in LaunchGrant review hash; excluded from sourceLaunchId, stampLaunchId and winnerKeyHash formulas",
            equalityForbiddenWith: ["sourceLaunchId", "stampLaunchId"]
        },
        hookemonExecutionEvidenceComparator: {
            status: "EXTERNAL_UNFROZEN_NOT_CONSUMED",
            staticWords: 37,
            rule: "Hookemon supplies its own read-only comparator candidate. This package neither copies nor authorizes an unfrozen applicant-specific typehash or selector."
        }
    }
    | .sourceIdentityReferents = {
        applicantRequest: {
            role: "APPLICANT_AND_REVIEW_ADMISSION_IDENTITY",
            binding: "LaunchGrantV1.applicantIdHash plus reviewerAttestationHash; the attestation must transitively commit the exact reviewAdmissionHash and request receipt",
            mayReplaceExecutableSource: false
        },
        executableEvidenceSource: {
            role: "EXECUTABLE_AND_MEASURED_SOURCE_REVISION",
            binding: "CompletedGraphPlanV1.sourceRepositoryHash/sourceCommitId/sourceTreeId and LaunchGrantV1.sourceRepositoryHash/sourceCommitHash/sourceTreeHash",
            gitCommitRule: "sourceCommitHash = keccak256(abi.encode(SOURCE_COMMIT_TYPEHASH, exact raw bytes20 executable-source Git commit object id))",
            gitTreeRule: "sourceTreeHash = keccak256(abi.encode(SOURCE_TREE_TYPEHASH, exact raw bytes20 executable-source Git tree object id))",
            mayBeRequestOrCarrierRevision: false
        },
        carrierEvidenceProvenance: {
            role: "OFFCHAIN_CARRIER_PROVENANCE_ONLY",
            binding: "LaunchGrantV1.builderEvidenceHash may commit the exact carrier/evidence provenance",
            mayReplaceApplicantRequestOrExecutableSource: false
        }
    }
    | .digestRules.stampLaunchId = "keccak256(abi.encode(STAMP_LAUNCH_ID_TYPEHASH, chainId, registry, launchWallet, profileKey, contractPlanHash, sourceLaunchId)); sourceLaunchId is explicitly fed only through this published formula"
    | .digestRules.sourceCommitHash = "keccak256(abi.encode(SOURCE_COMMIT_TYPEHASH, exact raw bytes20 Git commit object id)); raw bytes20 padding/equality is forbidden"
    | .digestRules.sourceTreeHash = "keccak256(abi.encode(SOURCE_TREE_TYPEHASH, exact raw bytes20 Git tree object id)); raw bytes20 padding/equality is forbidden"
    | .digestRules.winnerKeyHash = "keccak256(abi.encode(WINNER_KEY_TYPEHASH, exact chain/registry/applicant/profile/source including sourceLaunchId/plan/graph/intent/security/policy/review-generation domain)); supplied winnerKeyHash must equal the Codec result; antiReplayNonce is excluded so a second nonce cannot create another winner"
    | .digestRules.creationReceiptEvidenceHash = "keccak256(abi.encode(CREATION_RECEIPT_EVIDENCE_TYPEHASH, CreationReceiptEvidenceV1))"
	| .digestRules.grantStateHead = "keccak256(abi.encode(GRANT_STATE_HEAD_TYPEHASH, grantDigest, grantHash, stampLaunchId, status))"
	| .digestRules.preflightQueryHash = "keccak256(abi.encode(PREFLIGHT_QUERY_TYPEHASH, keccak256(abi.encode(AdoptionPreflightQueryV1)))); candidate currentness digest is a separate diagnostic argument and is excluded"
	| .digestRules.preflightComponentLeafHash = "keccak256(abi.encode(PREFLIGHT_COMPONENT_LEAF_TYPEHASH, canonical index/account/scope/expected shared identity/expected runtime/actual runtime/exclusive occupant/shared identity))"
	| .digestRules.preflightReadbackHash = "keccak256(abi.encode(PREFLIGHT_READBACK_TYPEHASH, globalReadbackHeadHash, keccak256(abi.encodePacked(componentLeafHash[0..n-1]))))"
	| .digestRules.receiptCoreHash = "keccak256 over the eight typed core fields stampLaunchId, sourceLaunchId, grant digest/hash, currentness digest, plan hash, capability hash and request hash; receiptCoreHash itself is excluded"
	| .deployment = {
	    status: "UNDEPLOYED",
	    chainId: null,
	    codec: null,
	    validator: null,
	    preflight: null,
	    registry: null,
	    creationTransactions: null,
	    finalityReceipts: null,
	    sourceVerificationReceipts: null
	}
	| .activation = {
	    status: "DENY",
	    registeredProfiles: [],
	    issuedProductionGrants: [],
	    publicConsumersBound: false
	}
    | .compatibilityBoundary = {
        genericContractRole: "SOURCE_NEUTRAL_COMPLETED_GRAPH_ADOPTION_AND_CANONICAL_STAMP_ONLY",
        arbitraryExecution: "FORBIDDEN",
        applicantSpecificComparatorSelectorsAccepted: false,
        legacyNonceEqualsSourceOrStampIdentity: "FORBIDDEN",
        rawGitObjectPaddingEquality: "FORBIDDEN",
        consumerRule: "Consumers use only this artifact ABI/typehash/selector set. Applicant-specific evidence is hash-bound through reviewed plan/evidence and an exact registered state verifier; it is never interpreted as generic Router calldata."
    }
    | .hookemonCompatibility = {
        status: "DENY_PENDING_EXACT_APPLICANT_REVIEW_DEPLOYMENT_EVIDENCE_AND_PROFILE_BINDING",
        sourceExecution: "UNSUPPORTED_BY_THIS_ADOPT_ONLY_INTERFACE",
        identifiers: ["sourceLaunchId", "stampLaunchId", "antiReplayNonce"],
        observedExecutionEvidenceComparator: "EXTERNAL_UNFROZEN_NOT_CONSUMED",
        legacyCustomGraphRequestMigration: "FORBIDDEN_REQUIRES_NEW_REVIEWED_ROUTE_SCHEMA_PROFILE_AND_GRANT",
        sourceScheduleWindow: "SOURCE_REVISION_OR_JIT_REVIEW_BINDING_REQUIRED_ROUTER_DOES_NOT_BYPASS"
    }
    | .shardsCompatibility = {
        status: "DENY_UNDEPLOYED_EXTERNAL_NESTED_FACTORY_PROFILE_NOT_BOUND_BY_THIS_ARTIFACT",
        frozenSourceMutation: false,
        relationship: "This additive ADOPT-only package does not reinterpret or modify the frozen Shards NESTED_FACTORY execution profile."
    }
    | .launchGrantAndCurrentness.epochPolicy = "Grant and Currentness securityControlHeadHash, security epoch/hash, policy epoch/hash and review generation/hash must equal current Registry and registered profile controls. Any drift requires a new profile identity where applicable, review, grant, currentness, winner nonce and derived winner key. Fresh currentness cannot revive an old grant."
	| .launchGrantAndCurrentness.currentness = "A separately reviewer-signed, revocable, one-use transport binds chain, registry, wallet, grant digest, plan, typed request, typed preflight aggregate, pre-sign Validator simulation evidence, exact service deployment identity, dual-provider quorum evidence, result, intent, current head/epochs/review generation and nonce. validAfter/deadline may span no more than 3600 seconds and is never an Applicant approval deadline."
	| .launchGrantAndCurrentness.globalKill = "Reviewer or governance can kill activation and consumption immediately. Clearing a set kill requires a strictly newer review generation plus a security or policy epoch advance; all pre-incident grants/currentness remain fail-closed."
	| .launchGrantAndCurrentness.stateReadback = "adoptionPreflightReadbackV1 is the side-effect-free typed consumer surface. It distinguishes chain/registry, all nine runtime classes, immutable runtime/authority binding, security/policy/review controls, kill/profile/grant/winner/currentness, graph/component/token/pool vacancy, receipt core and finality/indexing state without issuing a permit or creating an Applicant TTL. canonicalReceiptCore preserves the full immutable post-adoption core."
	| .preflight = {
	    status: "IMMUTABLE_TYPED_COMPANION_UNDEPLOYED",
	    sideEffects: false,
	    signing: false,
	    applicantTtl: false,
	    requiredRuntimeMask: 511,
	    runtimeMaskBits: ["reviewer", "governance", "finality", "indexer", "codec", "validator", "stateVerifier", "canonicalPoolManagerOrNoPool", "preflight"],
	    providerPolicy: "dualProviderQuorumEvidenceHash is a purpose-bound Authority attestation over two independent provider observations at one exact block identity; the contract never claims it queried providers",
	    providerOutage: "PENDING_RETRYABLE_APPROVAL_UNCHANGED",
	    simulationPolicy: "simulationEvidenceHash binds the exact pre-sign side-effect-free Validator eth_call recipe/result and cannot claim simulation of circular final signed calldata",
	    deploymentPolicy: "serviceDeploymentBindingHash must bind the exact content-addressed Authority/API deployment; cache-only or provider-only state is insufficient",
	    vacancyPolicy: "zero graph/component/token/pool/index occupants before the first transaction is valid and expected; total=1 is a post-transaction dual-finality/indexing condition only"
	}
    | .typedProvenance.createEvidence = "Top-level CREATE evidence binds finalized tx hash/block/index, sender+nonce, to=zero, value, exact initcode input hash, receipt success, CREATE-derived topLevelCreatedAddress, finality and dual-provider evidence. CREATE nonce zero is valid."
    | .typedProvenance.create2Evidence = "CREATE2 evidence binds the finalized outer transaction context, the top-level CREATE address when outer to=zero, component deployer+salt+initcode-derived account, and a nonzero internalCreationTraceHash. Nested constructor CREATE2 and shared/fixed factories are representable; authenticated trace/history verification remains an external activation prerequisite."
    | .currentStateVerifier.binding = "A registered codehash-pinned stateVerifier, state schema and nonzero behavior-evidence hash are mandatory. Onchain bytecode screening rejects DELEGATECALL; it does not claim to prove every CALL/STATICCALL forwarding dependency immutable."
    | .dependencyRule = {
        status: "DELEGATECALL_PROXY_REJECTED_EXTERNAL_BEHAVIOR_ATTESTATION_REQUIRED",
	    rule: "Reviewer, governance, finality/indexer authorities, Codec, Validator, Preflight and profile state verifier require exact runtime codehashes and bytecode without DELEGATECALL. Because CALL/STATICCALL forwarding plus mutable storage cannot be proven generically from runtime alone, exact source/storage/control behavior evidence is mandatory before any non-null activation."
    }
    | .focusedValidation.forge = (($test_count | tostring) + " focused tests passed; one winner-key property fuzzed for " + ($winner_fuzz_runs | tostring) + " runs")
    | .focusedValidation.slitherHighSignal.result = "No high/medium detector finding. Four low calls-loop notices are bounded by MAX_COMPONENTS=24 and invoke only exact codehash-pinned Codec or Registry readback paths; the state-changing Registry loop is nonReentrant and runs only after Validator success."
    | .focusedValidation.slitherFull = {
        detectors: 101,
        result: "No independently reproducible high/medium safety finding. Remaining reports are intentional Solidity zero-default memory initialization, the bounded <=1h internal currentness transport timestamp, bounded ERC-1271/state-verifier assembly return handling, four capped/codehash-pinned calls-loop notices, and naming style."
    }
    | .focusedValidation.coverage = [
        "evergreen Active grant succeeds years later only with fresh bounded currentness",
        "revoked/consumed grants, currentness replay and nonce replay fail atomically",
        "security/policy/review-generation drift rejects old grant even with fresh currentness",
        "global kill and terminal profile suspension/deprecation prevent revival",
        "winner key is derived from every required domain axis; identical concurrent domain has one winner",
        "sourceLaunchId, stampLaunchId and antiReplayNonce are explicitly named, pairwise distinct in the Golden, and no equality condition exists",
        "applicant/request, executable-source and carrier identities are separately grant-bound and cannot substitute for one another",
        "review rebind requires a fresh terminal nonce/key domain and old grant remains terminal",
	    "typed state mutation, verifier revert/malformed return and PoolManager mismatch fail",
	    "typed preflight distinguishes runtime/control/profile/grant/winner/vacancy/replay/receipt/index state without signing or side effects",
	    "component runtime mutation changes the ordered preflight leaf and cannot consume the durable grant",
	    "missing pre-sign simulation, service deployment identity or dual-provider quorum evidence is retryable failure and does not consume the grant",
	    "candidate currentness digest used/revoked diagnostics are distinguishable but excluded from the signed snapshot to avoid circularity",
        "ERC-1271 wrong magic, revert, short return and digest mutation fail",
        "CREATE nonce-zero and outer-CREATE/nested-CREATE2 receipt+trace contexts are exact",
        "shared component provenance/config identity cannot drift across plans",
        "finality/indexing append without rewriting immutable receipt core",
        "legacy custom-graph route cannot silently migrate"
    ]
    | .reproducibility = {
        config: "config/hookemon-compat/foundry.toml",
        configSha256: $config_sha,
        remappings: "remappings.txt",
        remappingsSha256: $remappings_sha,
        generator: "scripts/generate-hookemon-adoption-compat-artifact.sh",
        generatorSha256: $generator_sha,
        checker: "scripts/check-hookemon-adoption-compat-artifact.sh",
        checkerSha256: $checker_sha,
        artifactCheckCommand: "./scripts/generate-hookemon-adoption-compat-artifact.sh --check",
        detachedCheckoutCommand: "FOUNDRY_CONFIG=config/hookemon-compat/foundry.toml forge test --match-contract ProgrammableCompletedGraphAdoptionCompatV1Test",
        dependencyMode: "PINNED_SOLC_0.8.26_LOCAL_HOOKEMON_SOURCES_ONLY_NO_LINKED_LIBRARIES; repository remappings are hash-bound but unused",
        abiCanonicalization: "recursive JSON object-key sort via jq -cS; UTF-8 bytes; no trailing LF",
        typehashDerivation: "canonical Solidity string literals extracted by constant name and hashed with Ethereum keccak256"
    }
' "$artifact" >"$candidate"

if [ "$mode" = "--write" ]; then
    cp "$candidate" "$artifact"
    result="WRITTEN"
else
    if ! cmp -s "$candidate" "$artifact"; then
        echo "artifact mismatch: run $generator --write after source/test freeze" >&2
        diff -u "$artifact" "$candidate" >&2 || true
        exit 1
    fi
    result="PASS"
fi

artifact_sha=$(source_hash "$artifact")
printf 'artifact_check=%s artifact_sha256=%s tests=%s winner_fuzz_runs=%s registry_runtime_bytes=%s registry_initcode_bytes=%s\n' \
    "$result" "$artifact_sha" "$test_count" "$winner_fuzz_runs" "$registry_runtime_bytes" "$registry_init_bytes"
