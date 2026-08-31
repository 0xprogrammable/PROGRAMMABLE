#!/usr/bin/env python3

import base64
import ctypes
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch


SOURCE = Path(__file__).parents[1] / "relay-existing-custom-launch-key.py"
WORKFLOW = Path(__file__).parents[2] / ".github/workflows/relay-existing-custom-launch-key.yml"
SPEC = importlib.util.spec_from_file_location("relay_existing_key", SOURCE)
RELAY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RELAY)


class FakeSodium:
    def __init__(self):
        self.plaintext = None
        self.recipient = None
        self.length = None
        self.zeroized = []

    def crypto_box_seal(self, ciphertext, plaintext, length, recipient):
        self.length = int(length)
        self.plaintext = ctypes.string_at(plaintext, self.length)
        self.recipient = ctypes.string_at(recipient, 32)
        ctypes.memset(ciphertext, 0xA5, self.length + 48)
        return 0

    def sodium_memzero(self, value, length):
        ctypes.memset(value, 0, int(length))
        self.zeroized.append(ctypes.string_at(value, int(length)))


class FakeHeaders:
    def __init__(self, values):
        self.values = values

    def get_all(self, name, default=None):
        return self.values.get(name, default)


class FakeResponse:
    status = 200

    def __init__(self, body, declared_length):
        self.body = body
        self.headers = FakeHeaders({
            "Content-Type": ["application/json"],
            "Content-Length": [str(declared_length)],
            "Date": [RELAY.email.utils.format_datetime(
                RELAY.dt.datetime.now(RELAY.dt.timezone.utc), usegmt=True
            )],
        })

    def read(self, _maximum):
        return self.body


class FakeConnection:
    def __init__(self, response):
        self.response = response

    def request(self, *_arguments, **_keywords):
        pass

    def getresponse(self):
        return self.response

    def close(self):
        pass


class ExistingKeyRelayTest(unittest.TestCase):
    def test_context_is_exact_protected_attempt_one(self):
        commit = "a" * 40
        environment = {
            "GITHUB_ACTIONS": "true",
            "GITHUB_REPOSITORY": RELAY.SOURCE_REPOSITORY,
            "GITHUB_REPOSITORY_ID": str(RELAY.SOURCE_REPOSITORY_ID),
            "GITHUB_EVENT_NAME": "workflow_dispatch",
            "GITHUB_REF": RELAY.REF,
            "GITHUB_REF_TYPE": "branch",
            "GITHUB_REF_PROTECTED": "true",
            "GITHUB_RUN_ATTEMPT": "1",
            "GITHUB_SERVER_URL": "https://github.com",
            "GITHUB_API_URL": "https://api.github.com",
            "RUNNER_OS": "Linux",
            "RUNNER_ARCH": "X64",
            "RUNNER_ENVIRONMENT": "github-hosted",
            "GITHUB_SHA": commit,
            "GITHUB_WORKFLOW_SHA": commit,
            "GITHUB_WORKFLOW_REF": f"{RELAY.SOURCE_REPOSITORY}/{RELAY.WORKFLOW}@{RELAY.REF}",
            "GITHUB_ACTOR": "hazarxyz",
            "GITHUB_TRIGGERING_ACTOR": "hazarxyz",
            "GITHUB_ACTOR_ID": "258789013",
            "GITHUB_RUN_ID": "1234",
        }
        self.assertEqual(RELAY.context_from_environment(environment)["commit"], commit)
        for key, bad in (
            ("GITHUB_ACTOR", "someone-else"),
            ("GITHUB_REF_PROTECTED", "false"),
            ("GITHUB_RUN_ATTEMPT", "2"),
            ("GITHUB_TRIGGERING_ACTOR", "someone-else"),
            ("RUNNER_DEBUG", "1"),
        ):
            changed = {**environment, key: bad}
            with self.assertRaises(RELAY.RelayRejected):
                RELAY.context_from_environment(changed)

    def test_only_exact_workflow_run_path_variants_are_bound(self):
        source = SOURCE.read_text(encoding="utf-8")
        self.assertIn(
            'run.get("path") in (WORKFLOW, f"{WORKFLOW}@production")', source
        )
        self.assertNotIn("endswith(", source)

    def test_workflow_has_no_recipient_input_or_write_token(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertNotIn("inputs:", workflow)
        self.assertNotIn("${{ inputs.", workflow)
        self.assertNotIn("write", workflow.partition("concurrency:")[0])
        self.assertEqual(workflow.count(
            "secrets.PROGRAMMABLE_CUSTOM_LAUNCH_V3_CANARY_API_KEY"), 1)
        self.assertNotIn("PROGRAMMABLE_CUSTOM_LAUNCH_RELEASE_API_KEY", workflow)

    def test_accepts_only_current_backend_key_wire_shapes(self):
        valid = (
            "pm_live_" + "a" * 22 + "_" + "b" * 43,
            "pm_partner_" + "a" * 22 + "_" + "b" * 43,
            "pm_partner_root_" + "a" * 22 + "_" + "b" * 43,
        )
        for value in valid:
            self.assertIsNotNone(RELAY.API_KEY.fullmatch(value))
        for value in ("", "prog_" + "a" * 69, valid[0] + "x", valid[0] + "\n"):
            self.assertIsNone(RELAY.API_KEY.fullmatch(value))

    def test_strict_json_rejects_duplicate_keys_and_nonfinite_numbers(self):
        self.assertEqual(RELAY.strict_json(b'{"a":1}'), {"a": 1})
        with self.assertRaises(RELAY.RelayRejected):
            RELAY.strict_json(b'{"a":1,"a":2}')
        with self.assertRaises(RELAY.RelayRejected):
            RELAY.strict_json(b'{"a":NaN}')

    def test_http_response_rejects_early_eof_against_content_length(self):
        short = FakeConnection(FakeResponse(b"{}", 3))
        with patch.object(RELAY.http.client, "HTTPSConnection", return_value=short):
            with self.assertRaises(RELAY.RelayRejected):
                RELAY.request_json("api.github.com", "/fixed", {}, 200)
        exact = FakeConnection(FakeResponse(b"{}", 2))
        with patch.object(RELAY.http.client, "HTTPSConnection", return_value=exact):
            self.assertEqual(
                RELAY.request_json("api.github.com", "/fixed", {}, 200), {}
            )

    def test_eligibility_uses_only_two_fixed_requests_and_emits_no_response(self):
        key = "pm_live_" + "a" * 22 + "_" + "b" * 43
        responses = (
            {
                "schemaVersion": "programmable.custom-launch-list.v3",
                "launches": [],
                "nextCursor": None,
            },
            {
                "schemaVersion": "programmable.api-error.v1",
                "error": {
                    "code": "INVALID_REQUEST",
                    "message": "launchProfile must be an object",
                    "requestId": "00000000-0000-4000-8000-000000000000",
                },
            },
        )
        with patch.object(RELAY, "request_json", side_effect=responses) as request:
            result = RELAY.verify_existing_key_eligibility(key)
        self.assertEqual(request.call_count, 2)
        self.assertEqual(request.call_args_list[0].args[:2], (
            RELAY.API_HOST, "/v3/custom-launches?limit=1"))
        self.assertEqual(request.call_args_list[1].args[:2], (
            RELAY.API_HOST, "/v3/custom-launches/preflight"))
        self.assertEqual(request.call_args_list[1].kwargs["body"], b"{}")
        self.assertTrue(result["normalRequestBudgetConsumed"])
        self.assertFalse(result["launchCreated"])
        self.assertNotIn(key, repr(result))
        self.assertNotIn("requestId", result)

    def test_seal_uses_only_the_pinned_recipient_and_has_expected_size(self):
        key = "pm_partner_root_" + "a" * 22 + "_" + "b" * 43
        sodium = FakeSodium()
        sealed = base64.b64decode(
            RELAY.seal_for_fixed_destination(sodium, key), validate=True
        )
        self.assertEqual(len(sealed), len(key) + 48)
        self.assertEqual(sealed, b"\xA5" * (len(key) + 48))
        self.assertEqual(sodium.plaintext, key.encode("ascii"))
        self.assertEqual(sodium.length, len(key))
        self.assertEqual(
            sodium.recipient,
            base64.b64decode(RELAY.DESTINATION["publicKey"], validate=True),
        )
        self.assertEqual(sodium.zeroized, [b"\x00" * (len(key) + 1)])
        self.assertEqual(
            RELAY.github_secret_put(base64.b64encode(sealed).decode("ascii")),
            {
                "encrypted_value": base64.b64encode(sealed).decode("ascii"),
                "key_id": "3380204578043523366",
            },
        )
        self.assertEqual(
            RELAY.DESTINATION,
            {
                "repository": "programmablehq/programmable-open-hook-v2-internal",
                "repositoryId": 1318883798,
                "environment": "production",
                "secret": "PROGRAMMABLE_CUSTOM_LAUNCH_RELEASE_API_KEY",
                "keyId": "3380204578043523366",
                "publicKey": "7j6iPfRTa5ETitsDNswaAh7jDj/+ecHFnaw9G0C/o1c=",
            },
        )


if __name__ == "__main__":
    unittest.main()
