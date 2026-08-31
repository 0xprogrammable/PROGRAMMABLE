#!/usr/bin/env python3
"""Fixed-recipient relay for one existing API key. It never mints or installs a key."""

import base64
import contextlib
import ctypes
import ctypes.util
import datetime as dt
import email.utils
import http.client
import json
import os
from pathlib import Path
import re
import resource
import signal
import ssl
import stat
import subprocess
import sys

SOURCE_REPOSITORY = "programmablehq/PROGRAMMABLE"
SOURCE_REPOSITORY_ID = 1314365508
SOURCE_SECRET = "PROGRAMMABLE_CUSTOM_LAUNCH_V3_CANARY_API_KEY"
WORKFLOW = ".github/workflows/relay-existing-custom-launch-key.yml"
REF = "refs/heads/production"
DESTINATION = {
    "repository": "programmablehq/programmable-open-hook-v2-internal",
    "repositoryId": 1318883798,
    "environment": "production",
    "secret": "PROGRAMMABLE_CUSTOM_LAUNCH_RELEASE_API_KEY",
    "keyId": "3380204578043523366",
    "publicKey": "7j6iPfRTa5ETitsDNswaAh7jDj/+ecHFnaw9G0C/o1c=",
}
API_HOST = "programmable-custom-launch-api.fly.dev"
OUTPUT_NAME = "existing-custom-launch-key-relay.json"
SHA = re.compile(r"[0-9a-f]{40}\Z")
API_KEY = re.compile(r"pm_(?:live|partner|partner_root)_[A-Za-z0-9_-]{22}_[A-Za-z0-9_-]{43}\Z")


class RelayRejected(Exception):
    pass


def require(condition):
    if not condition:
        raise RelayRejected()


def exact_keys(value, names):
    require(isinstance(value, dict) and set(value) == set(names))


def strict_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result)
        result[key] = value
    return result


def strict_json(raw):
    def invalid_constant(_value):
        raise RelayRejected()

    return json.loads(
        raw.decode("utf-8"),
        object_pairs_hook=strict_object,
        parse_constant=invalid_constant,
    )


@contextlib.contextmanager
def deadline(seconds):
    def expired(_signum, _frame):
        raise RelayRejected()

    previous = signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)


def request_json(host, route, headers, expected_status, method="GET", body=None, maximum=1048576):
    # A direct fixed-host TLS connection cannot follow redirects or inherit proxy configuration.
    require(host in ("api.github.com", API_HOST))
    connection = http.client.HTTPSConnection(
        host, timeout=15, context=ssl.create_default_context()
    )
    try:
        with deadline(15):
            connection.request(
                method,
                route,
                body=body,
                headers={
                    "Accept": "application/json",
                    "Cache-Control": "no-cache",
                    "User-Agent": "programmable-existing-key-relay",
                    **headers,
                },
            )
            response = connection.getresponse()
            require(response.status == expected_status)
            require(not response.headers.get_all("Location"))
            content_types = response.headers.get_all("Content-Type", [])
            require(
                len(content_types) == 1
                and re.fullmatch(
                    r"application/json(?:;\s*charset=utf-8)?",
                    content_types[0],
                    re.I,
                )
            )
            require(not response.headers.get_all("Content-Encoding"))
            dates = response.headers.get_all("Date", [])
            require(len(dates) == 1)
            timestamp = email.utils.parsedate_to_datetime(dates[0])
            require(
                timestamp.tzinfo is not None
                and abs(
                    (dt.datetime.now(dt.timezone.utc) - timestamp).total_seconds()
                )
                <= 30
            )
            sizes = response.headers.get_all("Content-Length", [])
            require(
                len(sizes) <= 1
                and (not sizes or re.fullmatch(r"[0-9]+", sizes[0]))
            )
            require(not sizes or int(sizes[0]) <= maximum)
            raw = response.read(maximum + 1)
            require(2 <= len(raw) <= maximum)
            require(not sizes or len(raw) == int(sizes[0]))
            return strict_json(raw)
    finally:
        connection.close()


def context_from_environment(environment):
    expected = {
        "GITHUB_ACTIONS": "true",
        "GITHUB_REPOSITORY": SOURCE_REPOSITORY,
        "GITHUB_REPOSITORY_ID": str(SOURCE_REPOSITORY_ID),
        "GITHUB_EVENT_NAME": "workflow_dispatch",
        "GITHUB_REF": REF,
        "GITHUB_REF_TYPE": "branch",
        "GITHUB_REF_PROTECTED": "true",
        "GITHUB_RUN_ATTEMPT": "1",
        "GITHUB_SERVER_URL": "https://github.com",
        "GITHUB_API_URL": "https://api.github.com",
        "RUNNER_OS": "Linux",
        "RUNNER_ARCH": "X64",
        "RUNNER_ENVIRONMENT": "github-hosted",
    }
    require(all(environment.get(key) == value for key, value in expected.items()))
    require(environment.get("RUNNER_DEBUG", "") not in ("1", "true"))
    require(environment.get("ACTIONS_STEP_DEBUG", "").lower() != "true")
    require(environment.get("ACTIONS_RUNNER_DEBUG", "").lower() != "true")
    commit = environment.get("GITHUB_SHA", "")
    require(SHA.fullmatch(commit) and commit != "0" * 40)
    require(environment.get("GITHUB_WORKFLOW_SHA") == commit)
    require(
        environment.get("GITHUB_WORKFLOW_REF")
        == f"{SOURCE_REPOSITORY}/{WORKFLOW}@{REF}"
    )
    actor = environment.get("GITHUB_ACTOR", "")
    require(actor == "hazarxyz")
    require(environment.get("GITHUB_TRIGGERING_ACTOR") == "hazarxyz")
    require(environment.get("GITHUB_ACTOR_ID") == "258789013")
    require(
        re.fullmatch(r"[1-9][0-9]{0,19}", environment.get("GITHUB_RUN_ID", ""))
    )
    return {
        "repository": SOURCE_REPOSITORY,
        "repositoryId": SOURCE_REPOSITORY_ID,
        "environment": "production",
        "secret": SOURCE_SECRET,
        "ref": REF,
        "commit": commit,
        "workflow": WORKFLOW,
        "workflowCommit": commit,
        "runId": environment["GITHUB_RUN_ID"],
        "runAttempt": 1,
        "actor": actor,
        "actorId": environment["GITHUB_ACTOR_ID"],
    }


def verify_source(environment):
    source = context_from_environment(environment)
    workspace = Path(environment["GITHUB_WORKSPACE"]).resolve(strict=True)

    event_path = Path(environment.get("GITHUB_EVENT_PATH", ""))
    require(event_path.is_absolute())
    event_descriptor = os.open(event_path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        event_stat = os.fstat(event_descriptor)
        require(stat.S_ISREG(event_stat.st_mode) and 2 <= event_stat.st_size <= 262144)
        with os.fdopen(event_descriptor, "rb", closefd=False) as event_file:
            event = strict_json(event_file.read(262145))
    finally:
        os.close(event_descriptor)
    require(isinstance(event, dict) and event.get("ref") == REF)
    require(event.get("inputs") in (None, {}))
    require(
        event.get("repository", {}).get("id") == SOURCE_REPOSITORY_ID
        and event.get("repository", {}).get("full_name") == SOURCE_REPOSITORY
        and event.get("sender", {}).get("login") == "hazarxyz"
        and event.get("sender", {}).get("id") == 258789013
    )

    def git(*arguments):
        result = subprocess.run(
            ["/usr/bin/git", *arguments],
            cwd=workspace,
            env={
                "PATH": "/usr/bin:/bin",
                "GIT_CONFIG_NOSYSTEM": "1",
                "GIT_CONFIG_GLOBAL": "/dev/null",
            },
            capture_output=True,
            timeout=10,
            check=True,
        )
        require(len(result.stdout) <= 65536)
        return result.stdout.decode("utf-8").strip()

    require(git("rev-parse", "HEAD^{commit}") == source["commit"])
    require(git("rev-parse", "--abbrev-ref", "HEAD") == "HEAD")
    require(
        git("remote", "get-url", "origin")
        == f"https://github.com/{SOURCE_REPOSITORY}"
    )
    require(git("status", "--porcelain=v1", "--untracked-files=all") == "")
    source["tree"] = git("rev-parse", "HEAD^{tree}")
    require(SHA.fullmatch(source["tree"]) and source["tree"] != "0" * 40)

    token = environment.get("GH_TOKEN", "")
    require(
        isinstance(token, str)
        and 1 <= len(token) <= 16384
        and all(0x21 <= ord(character) <= 0x7E for character in token)
    )
    headers = {
        "Authorization": f"Bearer {token}",
        "X-GitHub-Api-Version": "2026-03-10",
    }
    branch = request_json(
        "api.github.com",
        f"/repos/{SOURCE_REPOSITORY}/branches/production",
        headers,
        200,
    )
    require(
        branch.get("name") == "production"
        and branch.get("protected") is True
        and branch.get("commit", {}).get("sha") == source["commit"]
    )
    run = request_json(
        "api.github.com",
        f"/repos/{SOURCE_REPOSITORY}/actions/runs/{source['runId']}/attempts/1",
        headers,
        200,
    )
    require(
        run.get("id") == int(source["runId"])
        and run.get("run_attempt") == 1
        and run.get("event") == "workflow_dispatch"
        and run.get("head_branch") == "production"
        and run.get("head_sha") == source["commit"]
        # GitHub emits both the bare path and the documented @branch form.
        and run.get("path") in (WORKFLOW, f"{WORKFLOW}@production")
        and run.get("status") == "in_progress"
    )
    for name in ("repository", "head_repository"):
        require(
            run.get(name, {}).get("id") == SOURCE_REPOSITORY_ID
            and run.get(name, {}).get("full_name") == SOURCE_REPOSITORY
        )
    for name in ("actor", "triggering_actor"):
        require(
            run.get(name, {}).get("login") == source["actor"]
            and run.get(name, {}).get("id") == int(source["actorId"])
        )
    return source


def verify_existing_key_eligibility(api_key):
    require(isinstance(api_key, str) and API_KEY.fullmatch(api_key))
    headers = {"Authorization": f"Bearer {api_key}"}
    listed = request_json(
        API_HOST,
        "/v3/custom-launches?limit=1",
        headers,
        200,
        maximum=4 * 1024 * 1024,
    )
    exact_keys(listed, ("schemaVersion", "launches", "nextCursor"))
    require(
        listed["schemaVersion"] == "programmable.custom-launch-list.v3"
        and isinstance(listed["launches"], list)
        and len(listed["launches"]) <= 1
        and (
            listed["nextCursor"] is None
            or isinstance(listed["nextCursor"], str)
        )
    )
    invalid = request_json(
        API_HOST,
        "/v3/custom-launches/preflight",
        {**headers, "Content-Type": "application/json"},
        400,
        method="POST",
        body=b"{}",
        maximum=4 * 1024 * 1024,
    )
    exact_keys(invalid, ("schemaVersion", "error"))
    exact_keys(invalid["error"], ("code", "message", "requestId"))
    error = invalid["error"]
    require(
        invalid["schemaVersion"] == "programmable.api-error.v1"
        and error["code"] == "INVALID_REQUEST"
        and error["message"] == "launchProfile must be an object"
        and isinstance(error["requestId"], str)
        and re.fullmatch(
            r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
            error["requestId"],
        )
    )
    return {
        "host": API_HOST,
        "authenticatedRead": "passed",
        "createAdmissionBeforeBodyValidation": "passed",
        "launchCreated": False,
        "nonceAllocated": False,
        "signerCalled": False,
        "normalRequestBudgetConsumed": True,
        "fullFleetReadinessProven": False,
    }


def load_sodium():
    library = ctypes.util.find_library("sodium")
    require(library is not None)
    sodium = ctypes.CDLL(library)
    sodium.sodium_init.restype = ctypes.c_int
    require(sodium.sodium_init() >= 0)
    for name, expected in (
        ("crypto_box_publickeybytes", 32),
        ("crypto_box_secretkeybytes", 32),
        ("crypto_box_sealbytes", 48),
    ):
        function = getattr(sodium, name)
        function.restype = ctypes.c_size_t
        require(function() == expected)
    sodium.crypto_box_keypair.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
    sodium.crypto_box_keypair.restype = ctypes.c_int
    sodium.crypto_box_seal.argtypes = [
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_ulonglong,
        ctypes.c_void_p,
    ]
    sodium.crypto_box_seal.restype = ctypes.c_int
    sodium.crypto_box_seal_open.argtypes = [
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_ulonglong,
        ctypes.c_void_p,
        ctypes.c_void_p,
    ]
    sodium.crypto_box_seal_open.restype = ctypes.c_int
    sodium.sodium_memzero.argtypes = [ctypes.c_void_p, ctypes.c_size_t]
    sodium.sodium_memzero.restype = None
    return sodium


def self_test_sodium(sodium):
    message = b"programmable sealed-box runtime self-test"
    public_key = ctypes.create_string_buffer(32)
    secret_key = ctypes.create_string_buffer(32)
    ciphertext = ctypes.create_string_buffer(len(message) + 48)
    recovered = ctypes.create_string_buffer(len(message))
    plaintext = ctypes.create_string_buffer(message, len(message))
    try:
        require(sodium.crypto_box_keypair(public_key, secret_key) == 0)
        require(
            sodium.crypto_box_seal(
                ciphertext, plaintext, len(message), public_key
            )
            == 0
        )
        require(
            sodium.crypto_box_seal_open(
                recovered,
                ciphertext,
                len(message) + 48,
                public_key,
                secret_key,
            )
            == 0
        )
        require(recovered.raw == message)
    finally:
        for value in (secret_key, plaintext, recovered):
            sodium.sodium_memzero(value, len(value))


def seal_for_fixed_destination(sodium, api_key):
    require(isinstance(api_key, str) and API_KEY.fullmatch(api_key))
    public_key = base64.b64decode(DESTINATION["publicKey"], validate=True)
    require(
        len(public_key) == 32
        and base64.b64encode(public_key).decode("ascii")
        == DESTINATION["publicKey"]
    )
    recipient = ctypes.create_string_buffer(public_key, len(public_key))
    plaintext = ctypes.create_string_buffer(api_key.encode("ascii"))
    ciphertext = ctypes.create_string_buffer(len(api_key) + 48)
    try:
        require(
            sodium.crypto_box_seal(
                ciphertext, plaintext, len(api_key), recipient
            )
            == 0
        )
        return base64.b64encode(ciphertext.raw).decode("ascii")
    finally:
        # Best effort for this mutable copy; Python may retain immutable string/bytes copies.
        sodium.sodium_memzero(plaintext, len(plaintext))


def github_secret_put(encrypted_value):
    require(isinstance(encrypted_value, str))
    ciphertext = base64.b64decode(encrypted_value, validate=True)
    require(len(ciphertext) in (122, 125, 130))
    require(base64.b64encode(ciphertext).decode("ascii") == encrypted_value)
    return {"encrypted_value": encrypted_value, "key_id": DESTINATION["keyId"]}


def main():
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    api_key = os.environ.pop("RELEASE_RELAY_SOURCE_API_KEY", None)
    require(len(sys.argv) == 2 and sys.argv[1] in ("preflight", "seal"))
    source = verify_source(os.environ)
    sodium = load_sodium()
    if sys.argv[1] == "preflight":
        require(api_key is None)
        self_test_sodium(sodium)
        print("EXISTING_RELEASE_KEY_RELAY_PREFLIGHT_PASSED")
        return

    eligibility = verify_existing_key_eligibility(api_key)
    # Re-read the protected tip after admission checks and before producing ciphertext.
    require(verify_source(os.environ) == source)
    encrypted_value = seal_for_fixed_destination(sodium, api_key)
    api_key = None
    created = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
    artifact = {
        "schemaVersion": "programmable.existing-custom-launch-key-relay.v1",
        "source": source,
        "destination": DESTINATION,
        "eligibility": eligibility,
        "encryption": "libsodium.crypto_box_seal",
        # These are the exact GitHub PUT body field names; the URL stays fixed by destination.
        "githubSecretPut": github_secret_put(encrypted_value),
        "createdAt": created.isoformat().replace("+00:00", "Z"),
        "expiresAt": (created + dt.timedelta(minutes=15))
        .isoformat()
        .replace("+00:00", "Z"),
    }
    encoded = (
        json.dumps(artifact, sort_keys=True, separators=(",", ":")) + "\n"
    ).encode("utf-8")
    require(len(encoded) <= 8192)
    directory = Path(os.environ["RUNNER_TEMP"])
    require(
        directory.is_absolute()
        and directory.is_dir()
        and not directory.is_symlink()
    )
    require(
        directory.resolve()
        != Path(os.environ["GITHUB_WORKSPACE"]).resolve()
    )
    descriptor = os.open(
        directory / OUTPUT_NAME,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
        0o600,
    )
    with os.fdopen(descriptor, "wb") as output:
        output.write(encoded)
    print("EXISTING_RELEASE_KEY_ELIGIBILITY_PASSED_AND_SEALED")


if __name__ == "__main__":
    try:
        main()
    except BaseException:
        # No raw response, exception, credential prefix, plaintext digest, or traceback.
        sys.stderr.write("EXISTING_RELEASE_KEY_RELAY_FAILED\n")
        sys.exit(1)
