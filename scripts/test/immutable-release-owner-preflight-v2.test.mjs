import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildImmutableReleaseOwnerPreflightRecord,
  captureImmutableReleaseOwnerPreflight,
  parseIncludedGitHubResponse,
} from "../capture-immutable-release-owner-preflight.mjs";
import {
  canonicalImmutableReleaseOwnerPreflightBytes,
  IMMUTABLE_RELEASE_PREFLIGHT_ALLOWED_SIGNERS,
  IMMUTABLE_RELEASE_PREFLIGHT_NAMESPACE,
  IMMUTABLE_RELEASE_PREFLIGHT_PUBLIC_KEY_BASE64,
  IMMUTABLE_RELEASE_PREFLIGHT_SIGNER,
  IMMUTABLE_RELEASE_PREFLIGHT_SIGNING_KEY_FINGERPRINT,
  IMMUTABLE_RELEASE_PREFLIGHT_TRUST_POLICY,
  verifyImmutableReleaseOwnerPreflight,
} from "../verify-immutable-release-owner-preflight.mjs";
import { assertOwnerBoundProgrammableLaunchTagRuleset } from "../verify-programmable-launch-tag-ruleset.mjs";

const SSH_KEYGEN = "/usr/bin/ssh-keygen";
const REVISION = "1".repeat(40);
const OTHER_REVISION = "2".repeat(40);
const DATE = "Sat, 29 Aug 2026 12:00:00 GMT";
const REQUEST_ID = "ABCD:EF01:2345:6789:ABCD";
const NOW = new Date("2026-08-29T12:09:59Z");
const PRODUCTION_ALLOWED_SIGNERS = new URL(
  "../../.github/release-trust/programmable-launch-immutable-release-owner.allowed_signers",
  import.meta.url,
);

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function keyFingerprint(publicKeyBase64) {
  return `SHA256:${createHash("sha256")
    .update(Buffer.from(publicKeyBase64, "base64"))
    .digest("base64")
    .replace(/=+$/u, "")}`;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    input: options.input,
    maxBuffer: options.maximumBytes ?? 1024 * 1024,
    shell: false,
    windowsHide: true,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr?.toString("utf8"));
  return result.stdout;
}

function makeKey(t, name = "signer") {
  const directory = mkdtempSync(join(tmpdir(), `programmable-preflight-${name}-`));
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  const privateKeyPath = join(directory, "id_ed25519");
  run(SSH_KEYGEN, ["-q", "-t", "ed25519", "-N", "", "-f", privateKeyPath]);
  const publicLine = readFileSync(`${privateKeyPath}.pub`, "utf8").trim();
  const [keyType, publicKeyBase64] = publicLine.split(" ");
  assert.equal(keyType, "ssh-ed25519");
  return { directory, privateKeyPath, publicKeyBase64 };
}

function makeTrust(t, { principal = "test-owner@programmable.xyz", namespace = IMMUTABLE_RELEASE_PREFLIGHT_NAMESPACE } = {}) {
  const key = makeKey(t);
  const allowedSigners =
    `${principal} namespaces="${namespace}" ssh-ed25519 ${key.publicKeyBase64}\n`;
  const allowedSignersPath = join(key.directory, "allowed_signers");
  writeFileSync(allowedSignersPath, allowedSigners, { mode: 0o600 });
  return {
    ...key,
    allowedSignersPath,
    policy: Object.freeze({
      allowedSigners,
      keyFingerprint: keyFingerprint(key.publicKeyBase64),
      namespace,
      principal,
      publicKeyBase64: key.publicKeyBase64,
    }),
  };
}

function endpointBody(enforcedByOwner = false) {
  return Buffer.from(
    `{"enabled":true,"enforced_by_owner":${enforcedByOwner ? "true" : "false"}}`,
    "utf8",
  );
}

function tagRuleset() {
  return {
    id: 21679403, name: "Protect Programmable Launch CLI release tags", target: "tag",
    enforcement: "active", bypass_actors: [],
    conditions: { ref_name: { include: ["refs/tags/programmable-launch-v*"], exclude: [] } },
    rules: [{ type: "update" }, { type: "deletion" }],
    updated_at: "2026-08-27T20:27:05.716Z",
  };
}

function record({
  revision = REVISION,
  bodyBytes = endpointBody(false),
  date = DATE,
  enforcedByOwner = false,
  requestId = REQUEST_ID,
} = {}) {
  return buildImmutableReleaseOwnerPreflightRecord({
    revision,
    bodyBytes,
    date,
    enforcedByOwner,
    requestId,
    tagRuleset: { bodyBytes: Buffer.from(JSON.stringify(tagRuleset())), date, requestId },
  });
}

function sign(bytes, keyPath, namespace = IMMUTABLE_RELEASE_PREFLIGHT_NAMESPACE) {
  return run(SSH_KEYGEN, ["-Y", "sign", "-f", keyPath, "-n", namespace], { input: bytes });
}

function verificationInput(trust, value = record(), options = {}) {
  const recordBytes = options.recordBytes ?? canonicalImmutableReleaseOwnerPreflightBytes(value);
  const signatureBytes = options.signatureBytes ?? sign(
    recordBytes,
    options.keyPath ?? trust.privateKeyPath,
    options.namespace ?? trust.policy.namespace,
  );
  return {
    actorId: "258789013",
    actorLogin: "hazarxyz",
    allowedSignersPath: options.allowedSignersPath ?? trust.allowedSignersPath,
    environment: "production",
    now: options.now ?? NOW,
    recordBase64: options.recordBase64 ?? recordBytes.toString("base64"),
    repository: "programmablehq/PROGRAMMABLE",
    repositoryId: "1314365508",
    revision: options.revision ?? REVISION,
    signatureBase64: options.signatureBase64 ?? signatureBytes.toString("base64"),
    trustPolicy: options.trustPolicy ?? trust.policy,
  };
}

function includedResponse(body, {
  date = DATE,
  requestId = REQUEST_ID,
  status = "HTTP/2.0 200 OK",
  extraHeaders = "",
} = {}) {
  return Buffer.from(
    `${status}\r\n` +
    `Date: ${date}\r\n` +
    `X-GitHub-Request-Id: ${requestId}\r\n` +
    "Content-Type: application/json; charset=utf-8\r\n" +
    extraHeaders +
    `\r\n${body}`,
    "utf8",
  );
}

test("production trust root is one exact namespace-restricted owner key", () => {
  const bytes = readFileSync(PRODUCTION_ALLOWED_SIGNERS);
  assert.equal(bytes.toString("utf8"), IMMUTABLE_RELEASE_PREFLIGHT_ALLOWED_SIGNERS);
  assert.equal(bytes.toString("utf8").split("\n").filter(Boolean).length, 1);
  assert.equal(bytes.includes(Buffer.from("cert-authority")), false);
  assert.equal(bytes.includes(Buffer.from("PRIVATE KEY")), false);
  assert.equal(IMMUTABLE_RELEASE_PREFLIGHT_TRUST_POLICY.principal, IMMUTABLE_RELEASE_PREFLIGHT_SIGNER);
  assert.equal(
    keyFingerprint(IMMUTABLE_RELEASE_PREFLIGHT_PUBLIC_KEY_BASE64),
    IMMUTABLE_RELEASE_PREFLIGHT_SIGNING_KEY_FINGERPRINT,
  );
});

test("real OpenSSH signatures verify for both exact enforced_by_owner booleans and expire", (t) => {
  const trust = makeTrust(t);
  for (const enforcedByOwner of [false, true]) {
    const value = record({
      bodyBytes: endpointBody(enforcedByOwner),
      enforcedByOwner,
    });
    const input = verificationInput(trust, value);
    const verified = verifyImmutableReleaseOwnerPreflight(input);
    assert.equal(verified.namespace, IMMUTABLE_RELEASE_PREFLIGHT_NAMESPACE);
    assert.equal(verified.revision, REVISION);
    assert.doesNotThrow(() => verifyImmutableReleaseOwnerPreflight(input));
    assert.throws(
      () => verifyImmutableReleaseOwnerPreflight({
        ...input,
        now: new Date("2026-08-29T12:10:01Z"),
      }),
      /stale or differs/u,
    );
  }
});

test("signature, key, principal, namespace, and trust-root substitutions fail closed", (t) => {
  const trust = makeTrust(t);
  const wrongKey = makeKey(t, "wrong-key");
  const value = record();
  const bytes = canonicalImmutableReleaseOwnerPreflightBytes(value);
  const validSignature = sign(bytes, trust.privateKeyPath, trust.policy.namespace);
  const tamperedSignature = Buffer.from(validSignature);
  tamperedSignature[tamperedSignature.indexOf(0x0a) + 5] ^= 1;

  assert.throws(
    () => verifyImmutableReleaseOwnerPreflight(verificationInput(trust, value, {
      recordBytes: bytes,
      signatureBytes: tamperedSignature,
    })),
    /signature/u,
  );
  assert.throws(
    () => verifyImmutableReleaseOwnerPreflight(verificationInput(trust, value, {
      keyPath: wrongKey.privateKeyPath,
    })),
    /signature/u,
  );
  assert.throws(
    () => verifyImmutableReleaseOwnerPreflight(verificationInput(trust, value, {
      namespace: "wrong-preflight@programmable.xyz",
    })),
    /signature/u,
  );

  const wrongPrincipal = `${trust.policy.principal}-wrong`;
  const wrongPrincipalPolicy = {
    ...trust.policy,
    principal: wrongPrincipal,
  };
  assert.throws(
    () => verifyImmutableReleaseOwnerPreflight(verificationInput(trust, value, {
      trustPolicy: wrongPrincipalPolicy,
    })),
    /trust policy/u,
  );

  const wrongAllowedSignersPath = join(trust.directory, "wrong_allowed_signers");
  writeFileSync(
    wrongAllowedSignersPath,
    `${wrongPrincipal} namespaces="${trust.policy.namespace}" ssh-ed25519 ${trust.publicKeyBase64}\n`,
  );
  assert.throws(
    () => verifyImmutableReleaseOwnerPreflight(verificationInput(trust, value, {
      allowedSignersPath: wrongAllowedSignersPath,
    })),
    /trust root differs/u,
  );

  const symlinkedAllowedSignersPath = join(trust.directory, "symlinked_allowed_signers");
  symlinkSync(trust.allowedSignersPath, symlinkedAllowedSignersPath);
  assert.throws(
    () => verifyImmutableReleaseOwnerPreflight(verificationInput(trust, value, {
      allowedSignersPath: symlinkedAllowedSignersPath,
    })),
    /allowed-signers file is invalid/u,
  );
});

test("record and signature transports require canonical bounded base64", (t) => {
  const trust = makeTrust(t);
  const input = verificationInput(trust);
  assert.throws(
    () => verifyImmutableReleaseOwnerPreflight({ ...input, recordBase64: `${input.recordBase64}\n` }),
    /canonical base64/u,
  );
  assert.throws(
    () => verifyImmutableReleaseOwnerPreflight({
      ...input,
      signatureBase64: `${input.signatureBase64} `,
    }),
    /canonical base64/u,
  );
  assert.throws(
    () => verifyImmutableReleaseOwnerPreflight({
      ...input,
      signatureBase64: Buffer.alloc(4_097, 0x41).toString("base64"),
    }),
    /canonical base64/u,
  );
});

test("signed owner tag policy proves an omitted list only while live protection is unchanged", (t) => {
  const trust = makeTrust(t);
  const verified = verifyImmutableReleaseOwnerPreflight(verificationInput(trust));
  const live = tagRuleset();
  delete live.bypass_actors;
  assert.doesNotThrow(() => assertOwnerBoundProgrammableLaunchTagRuleset(live, verified.tagRuleset));
  assert.doesNotThrow(() => assertOwnerBoundProgrammableLaunchTagRuleset({
    ...live, updated_at: "2026-08-27T22:27:05.716+02:00",
  }, verified.tagRuleset));
  for (const changed of [
    { ...live, updated_at: "2026-08-29T12:00:00Z" },
    { ...live, updated_at: undefined },
    { ...live, enforcement: "disabled" },
    { ...live, rules: [{ type: "update" }] },
    { ...live, bypass_actors: null },
    { ...live, bypass_actors: [{ actor_type: "OrganizationAdmin" }] },
  ]) assert.throws(() => assertOwnerBoundProgrammableLaunchTagRuleset(changed, verified.tagRuleset));
  assert.throws(() => assertOwnerBoundProgrammableLaunchTagRuleset(live, live));
});

test("owner tag proof rejects signed missing permissions, bypass actors, stale provenance and substitution", (t) => {
  const trust = makeTrust(t);
  const base = record();
  for (const mutate of [
    value => { delete value.tagRuleset; },
    value => { value.schemaVersion = "programmable.github-immutable-release-owner-preflight.v2"; },
    value => { value.tagRuleset.url += "0"; },
    value => { value.tagRuleset.response.bodySha256 = `sha256:${"0".repeat(64)}`; },
    value => { value.tagRuleset.response.date = "Sat, 29 Aug 2026 11:59:00 GMT"; },
    value => { value.tagRuleset.response.requestId = "missing"; },
    value => { value.tagRuleset.response.status = 404; },
    ...[undefined, [{ actor_type: "OrganizationAdmin" }]].map(actors => value => {
      const rules = tagRuleset();
      if (actors === undefined) delete rules.bypass_actors;
      else rules.bypass_actors = actors;
      const bytes = Buffer.from(JSON.stringify(rules));
      value.tagRuleset.response.bodyBase64 = bytes.toString("base64");
      value.tagRuleset.response.bodySha256 = sha256(bytes);
    }),
  ]) {
    const value = structuredClone(base);
    mutate(value);
    assert.throws(() => verifyImmutableReleaseOwnerPreflight(verificationInput(trust, value)));
  }
  const signed = verificationInput(trust, base);
  const changed = structuredClone(base);
  changed.tagRuleset.response.requestId = "ABCD:EF01:2345:6789:EEEE";
  assert.throws(() => verifyImmutableReleaseOwnerPreflight({
    ...signed, recordBase64: canonicalImmutableReleaseOwnerPreflightBytes(changed).toString("base64"),
  }), /signature/u);
});

test("the signature covers exact canonical JSON plus one LF", (t) => {
  const trust = makeTrust(t);
  const value = record();
  const canonical = canonicalImmutableReleaseOwnerPreflightBytes(value);
  const tamperedValue = { ...value, revision: OTHER_REVISION };
  const tamperedBytes = canonicalImmutableReleaseOwnerPreflightBytes(tamperedValue);
  const originalSignature = sign(canonical, trust.privateKeyPath, trust.policy.namespace);
  assert.throws(
    () => verifyImmutableReleaseOwnerPreflight(verificationInput(trust, tamperedValue, {
      recordBytes: tamperedBytes,
      signatureBytes: originalSignature,
      revision: OTHER_REVISION,
    })),
    /signature/u,
  );

  for (const noncanonical of [
    Buffer.from(JSON.stringify(value), "utf8"),
    Buffer.from(`${JSON.stringify(value)}\n\n`, "utf8"),
    Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"),
  ]) {
    assert.throws(
      () => verifyImmutableReleaseOwnerPreflight(verificationInput(trust, value, {
        recordBytes: noncanonical,
      })),
      /trailing LF|not canonical/u,
    );
  }
});

test("exact endpoint body accepts true and false but rejects missing, extra, and nonboolean owner state", () => {
  for (const enforcedByOwner of [false, true]) {
    const parsed = parseIncludedGitHubResponse(includedResponse(
      `{"enabled":true,"enforced_by_owner":${enforcedByOwner}}`,
    ));
    assert.equal(parsed.enforcedByOwner, enforcedByOwner);
  }
  for (const body of [
    '{"enabled":true}',
    '{"enabled":true,"enforced_by_owner":false,"extra":true}',
    '{"enabled":true,"enforced_by_owner":"false"}',
    '{"enabled":false,"enforced_by_owner":false}',
  ]) {
    assert.throws(() => parseIncludedGitHubResponse(includedResponse(body)), /not exactly enabled/u);
  }
});

test("signed body, body hash, owner boolean, date, and revision mutations fail", (t) => {
  const trust = makeTrust(t);
  const base = record();
  const signedBodyMutation = (body, responseOverrides = {}) => {
    const bodyBytes = Buffer.from(body, "utf8");
    return {
      ...base,
      response: {
        ...base.response,
        bodyBase64: bodyBytes.toString("base64"),
        bodySha256: sha256(bodyBytes),
        ...responseOverrides,
      },
    };
  };
  const cases = [
    {
      value: {
        ...base,
        response: { ...base.response, bodySha256: `sha256:${"0".repeat(64)}` },
      },
      pattern: /stale or differs/u,
    },
    {
      value: {
        ...base,
        response: { ...base.response, enforcedByOwner: true },
      },
      pattern: /not exactly enabled/u,
    },
    {
      value: signedBodyMutation('{"enabled":true}'),
      pattern: /shape is invalid/u,
    },
    {
      value: signedBodyMutation(
        '{"enabled":true,"enforced_by_owner":false,"extra":true}',
      ),
      pattern: /shape is invalid/u,
    },
    {
      value: signedBodyMutation(
        '{"enabled":true,"enforced_by_owner":"false"}',
      ),
      pattern: /not exactly enabled/u,
    },
    {
      value: signedBodyMutation(
        '{"enabled":false,"enforced_by_owner":false}',
      ),
      pattern: /not exactly enabled/u,
    },
    {
      value: {
        ...base,
        response: { ...base.response, enabled: false },
      },
      pattern: /not exactly enabled/u,
    },
    {
      value: {
        ...base,
        response: { ...base.response, requestId: "bad id" },
      },
      pattern: /stale or differs/u,
    },
    {
      value: { ...base, observedAt: "2026-08-29T12:00:01Z" },
      pattern: /stale or differs/u,
    },
    {
      value: {
        ...base,
        response: { ...base.response, date: "2026-08-29T12:00:00Z" },
      },
      pattern: /stale or differs/u,
    },
  ];
  for (const { value, pattern } of cases) {
    assert.throws(
      () => verifyImmutableReleaseOwnerPreflight(verificationInput(trust, value)),
      pattern,
    );
  }

  assert.throws(
    () => verifyImmutableReleaseOwnerPreflight(verificationInput(trust, base, {
      revision: OTHER_REVISION,
    })),
    /stale or differs/u,
  );
  const future = record({ date: "Sat, 29 Aug 2026 12:00:31 GMT" });
  assert.throws(
    () => verifyImmutableReleaseOwnerPreflight(verificationInput(trust, future, {
      now: new Date("2026-08-29T12:00:00Z"),
    })),
    /stale or differs/u,
  );
});

test("included GitHub response binds status, date, request id, content type, and raw body", () => {
  const parsed = parseIncludedGitHubResponse(includedResponse(
    '{"enabled":true,"enforced_by_owner":false}\n',
    { extraHeaders: "Vary: Accept\r\n" },
  ));
  assert.equal(parsed.date, DATE);
  assert.equal(parsed.requestId, REQUEST_ID);
  assert.equal(
    parsed.bodyBytes.toString("utf8"),
    '{"enabled":true,"enforced_by_owner":false}\n',
  );
  assert.throws(
    () => parseIncludedGitHubResponse(includedResponse(
      '{"enabled":true,"enforced_by_owner":false}',
      { status: "HTTP/2.0 404 Not Found" },
    )),
    /status/u,
  );
  assert.throws(
    () => parseIncludedGitHubResponse(Buffer.from(
      "HTTP/2.0 200 OK\r\nContent-Type: application/json\r\n\r\n" +
      '{"enabled":true,"enforced_by_owner":false}',
    )),
    /provenance headers/u,
  );
});

function captureArgs(keyPath) {
  return [
    "--repository", "programmablehq/PROGRAMMABLE",
    "--repository-id", "1314365508",
    "--revision", REVISION,
    "--environment", "production",
    "--signing-key", keyPath,
  ];
}

function captureRunner({
  user = { id: 258789013, login: "hazarxyz" },
  ref = { object: { sha: REVISION, type: "commit" }, ref: "refs/heads/production" },
  body = '{"enabled":true,"enforced_by_owner":false}',
} = {}) {
  return (command, args, options = {}) => {
    if (command === SSH_KEYGEN) return run(command, args, options);
    assert.equal(command, "gh");
    const endpoint = args.at(-1);
    if (endpoint === "/user") return Buffer.from(JSON.stringify(user));
    if (endpoint.endsWith("/git/ref/heads/production")) {
      return Buffer.from(JSON.stringify(ref));
    }
    if (endpoint.endsWith("/immutable-releases")) return includedResponse(body);
    if (endpoint.endsWith("/rulesets/21679403")) return includedResponse(JSON.stringify(tagRuleset()));
    assert.fail(`unexpected endpoint ${endpoint}`);
  };
}

test("local capture refuses Actions and validates gh owner, production ref, and endpoint", (t) => {
  const trust = makeTrust(t);
  const args = captureArgs(trust.privateKeyPath);
  assert.throws(
    () => captureImmutableReleaseOwnerPreflight({
      argv: args,
      environment: { GITHUB_ACTIONS: "true" },
      runCommand: () => assert.fail("commands must not run in Actions"),
    }),
    /forbidden inside GitHub Actions/u,
  );
  assert.throws(
    () => captureImmutableReleaseOwnerPreflight({
      argv: args,
      environment: {},
      runCommand: captureRunner({ user: { id: 1, login: "attacker" } }),
    }),
    /exact release owner/u,
  );
  assert.throws(
    () => captureImmutableReleaseOwnerPreflight({
      argv: args,
      environment: {},
      runCommand: captureRunner({
        ref: { object: { sha: OTHER_REVISION, type: "commit" }, ref: "refs/heads/production" },
      }),
    }),
    /production ref/u,
  );
  assert.throws(
    () => captureImmutableReleaseOwnerPreflight({
      argv: args,
      environment: {},
      runCommand: captureRunner({ body: '{"enabled":false,"enforced_by_owner":false}' }),
    }),
    /not exactly enabled/u,
  );

  const captured = captureImmutableReleaseOwnerPreflight({
    allowedSignersPath: trust.allowedSignersPath,
    argv: args,
    environment: {},
    now: NOW,
    runCommand: captureRunner(),
    trustPolicy: trust.policy,
  });
  assert.equal(captured.schemaVersion, "programmable.github-immutable-release-owner-preflight-capture.v3");
  assert.equal(captured.signer, trust.policy.principal);
  assert.doesNotMatch(JSON.stringify(captured), /PRIVATE KEY|id_ed25519/u);
  assert.doesNotThrow(() => verifyImmutableReleaseOwnerPreflight({
    actorId: "258789013",
    actorLogin: "hazarxyz",
    allowedSignersPath: trust.allowedSignersPath,
    environment: "production",
    now: NOW,
    recordBase64: captured.recordBase64,
    repository: "programmablehq/PROGRAMMABLE",
    repositoryId: "1314365508",
    revision: REVISION,
    signatureBase64: captured.signatureBase64,
    trustPolicy: trust.policy,
  }));
});
