#!/bin/sh
# Deterministically verifies every artifact-listed source hash against both disk and the checked-out Git blob.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"

artifact="artifacts/hookemon-completed-graph-adoption-compat-v1.json"

for command_name in jq shasum awk git cast node; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
        echo "missing required command: $command_name" >&2
        exit 1
    fi
done

if ! jq -e . "$artifact" >/dev/null; then
    echo "invalid JSON: $artifact" >&2
    exit 1
fi

check_hash() {
    path=$1
    expected=$2
    disk=$(shasum -a 256 "$path" | awk '{print $1}')
    blob=$(git show "HEAD:$path" | shasum -a 256 | awk '{print $1}')
    if [ "$disk" != "$expected" ] || [ "$blob" != "$expected" ]; then
        echo "hash mismatch: $path expected=$expected disk=$disk blob=$blob" >&2
        exit 1
    fi
}

jq -r '.contracts[] | select(.sourceSha256 != null) | "\(.source)|\(.sourceSha256)"' "$artifact" |
    while IFS='|' read -r path expected; do
        check_hash "$path" "$expected"
    done

test_path=$(jq -r '.test.source' "$artifact")
test_hash=$(jq -r '.test.sourceSha256' "$artifact")
check_hash "$test_path" "$test_hash"

for reproducibility_key in config generator checker; do
    path=$(jq -r --arg key "$reproducibility_key" '.reproducibility[$key]' "$artifact")
    expected=$(jq -r --arg key "${reproducibility_key}Sha256" '.reproducibility[$key]' "$artifact")
    check_hash "$path" "$expected"
done

if jq -e '[paths as $path | $path[-1] | select(. == "createTransactionEvidence")] | length != 0' "$artifact" >/dev/null; then
    echo "stale legacy createTransactionEvidence key remains in artifact" >&2
    exit 1
fi

if jq -e '[paths as $path | $path[-1] | select(. == "launchId")] | length != 0' "$artifact" >/dev/null; then
    echo "ambiguous legacy launchId key remains in artifact" >&2
    exit 1
fi

if ! jq -e '
    .status == "INTERFACE_ONLY_NOT_DEPLOYED_NOT_ACTIVATED"
    and .scope.capabilitySemantics == "ADOPT"
    and .scope.execution == "UNSUPPORTED"
    and .scope.arbitraryExecution == "FORBIDDEN"
	and .dependencyRule.status == "DELEGATECALL_PROXY_REJECTED_EXTERNAL_BEHAVIOR_ATTESTATION_REQUIRED"
	and .deployment.status == "UNDEPLOYED"
	and .activation.status == "DENY"
	and .preflight.status == "IMMUTABLE_TYPED_COMPANION_UNDEPLOYED"
	and .preflight.sideEffects == false
	and .preflight.signing == false
	and .preflight.applicantTtl == false
	and .preflight.requiredRuntimeMask == 511
	and (.productionProfileSlots | length) == 6
    and ([.productionProfileSlots[]] | all(. == "NULL_DENY"))
	and (.typehashes | has("sourceCommit") and has("sourceTree") and has("stampLaunchId") and has("winnerKey") and has("creationReceiptEvidence") and has("sharedComponentIdentity") and has("preflightQuery") and has("preflightReadback") and has("preflightRuntimeAuthorityBinding"))
    and (.identitySeparation.sourceLaunchId.role == "SOURCE_DEFINED_GRAPH_IDENTITY")
    and (.identitySeparation.stampLaunchId.role == "ROUTER_REGISTRY_CANONICAL_STAMP_IDENTITY")
    and (.identitySeparation.antiReplayNonce.role == "INDEPENDENT_TERMINAL_ONE_WINNER_NONCE")
    and (.identitySeparation.hookemonExecutionEvidenceComparator.status == "EXTERNAL_UNFROZEN_NOT_CONSUMED")
    and (.typehashPreimages | keys) == (.typehashes | keys)
' "$artifact" >/dev/null; then
    echo "artifact lifecycle/surface/typehash invariants are not fail-closed" >&2
    exit 1
fi

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
if (expression === null) throw new Error(`missing ${constantName} in ${sourcePath}`);
const literals = expression[1].match(/"(?:\\.|[^"\\])*"/g) ?? [];
process.stdout.write(literals.map((literal) => JSON.parse(literal)).join(""));
NODE
}

jq -r '.typehashPreimages | to_entries[] | [.key,.value.constant,.value.preimage] | @tsv' "$artifact" |
    while IFS="$(printf '\t')" read -r key constant_name artifact_preimage; do
	    case "$constant_name" in
	        GRANT_STATE_HEAD_TYPEHASH | EIP712_DOMAIN_TYPEHASH | PREFLIGHT_AUTHORITY_ROLES_TYPEHASH | PREFLIGHT_CORE_DEPENDENCIES_TYPEHASH | PREFLIGHT_BASE_RUNTIME_BINDING_TYPEHASH | PREFLIGHT_PROFILE_RUNTIME_BINDING_TYPEHASH | PREFLIGHT_RUNTIME_AUTHORITY_BINDING_TYPEHASH)
	            source_path="src/hookemon/ProgrammableCompletedGraphAdoptionGrantRegistryV1.sol"
                ;;
            *)
                source_path="src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol"
                ;;
        esac
        source_preimage=$(extract_keccak_preimage "$source_path" "$constant_name")
        expected_hash=$(jq -r --arg key "$key" '.typehashes[$key]' "$artifact")
        actual_hash=$(cast keccak "$source_preimage")
        if [ "$artifact_preimage" != "$source_preimage" ] || [ "$expected_hash" != "$actual_hash" ]; then
            echo "typehash mismatch: $key constant=$constant_name expected=$expected_hash actual=$actual_hash" >&2
            exit 1
        fi
    done

printf 'artifact_sha256='
shasum -a 256 "$artifact" | awk '{print $1}'
