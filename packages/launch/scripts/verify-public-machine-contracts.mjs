#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseStrictJson } from "../src/canonical-json.mjs";
import { PACKAGE_VERSION } from "../src/constants.mjs";

const packageRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const repositoryRoot = path.resolve(packageRoot, "../..");
const documentPaths = Object.freeze({
  "custom-launch-v1.json": path.join(repositoryRoot, "public/openapi/custom-launch-v1.json"),
  "custom-launch-v2.json": path.join(repositoryRoot, "public/openapi/custom-launch-v2.json"),
  "custom-launch-v3.json": path.join(repositoryRoot, "public/openapi/custom-launch-v3.json"),
});
const HTTP_METHODS = Object.freeze([
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
]);
const API_SERVER_BY_DOCUMENT = Object.freeze({
  "custom-launch-v1.json": "https://api.programmable.market",
  "custom-launch-v2.json": "https://api.programmable.market",
  "custom-launch-v3.json": "https://api.programmable.market",
});

const documents = new Map();
for (const [name, filePath] of Object.entries(documentPaths)) {
  const source = await readFile(filePath, "utf8");
  documents.set(name, parseStrictJson(source, { maximumBytes: 10_000_000, maximumDepth: 256 }));
}

for (const [name, document] of documents) {
  assert.equal(document.openapi, "3.1.0", `${name} must use OpenAPI 3.1.0`);
  assertPlainObject(document.info, `${name} info`);
  assertPlainObject(document.paths, `${name} paths`);
  assertPlainObject(document.components, `${name} components`);
  verifyOpenApiOperations(name, document);
  verifyReferences(name, document);
}

const v3 = documents.get("custom-launch-v3.json");
assert.equal(v3.info.version, PACKAGE_VERSION, "V3 OpenAPI and CLI versions must match");
assertJsonEqual(v3.security, [{ CustomLaunchApiKey: [] }], "V3 root security");
assertJsonEqual(v3.paths["/v3/capabilities"].get.security, [], "capabilities security");
assertJsonEqual(
  v3.paths["/v3/finalized-custom-launches"].get.security,
  [],
  "finalized metadata security",
);
assertJsonEqual(
  v3.paths["/v3/custom-launches/preflight"].post.security,
  [{ CustomLaunchApiKey: [] }],
  "preflight security",
);
for (const [pathName, method] of [
  ["/v3/custom-launches", "post"],
  ["/v3/custom-launches", "get"],
  ["/v3/custom-launches/{launchId}", "get"],
]) {
  assertPlainObject(v3.paths[pathName]?.[method], `V3 operation ${method.toUpperCase()} ${pathName}`);
}
assertJsonEqual(
  v3.components.securitySchemes.CustomLaunchApiKey,
  {
    type: "http",
    scheme: "bearer",
    bearerFormat: "pm_live_<22-char-key-id>_<43-char-secret>",
    description: v3.components.securitySchemes.CustomLaunchApiKey.description,
  },
  "API-key security scheme",
);

const publicSchemaPath = path.join(
  repositoryRoot,
  "public/schemas/custom-launch/v3/pack-config.json",
);
const packageSchemaPath = path.join(
  packageRoot,
  "schemas/programmable-launch-pack-config-v3.json",
);
const [publicSchemaBytes, packageSchemaBytes] = await Promise.all([
  readFile(publicSchemaPath),
  readFile(packageSchemaPath),
]);
assert.deepEqual(
  publicSchemaBytes,
  packageSchemaBytes,
  "Public and packaged V3 pack-config schemas must be byte-identical",
);
parseStrictJson(publicSchemaBytes.toString("utf8"), {
  maximumBytes: 10_000_000,
  maximumDepth: 256,
});

const [packageManifestSource, shrinkwrapSource, licenseSource] = await Promise.all([
  readFile(path.join(packageRoot, "package.json"), "utf8"),
  readFile(path.join(packageRoot, "npm-shrinkwrap.json"), "utf8"),
  readFile(path.join(packageRoot, "LICENSE"), "utf8"),
]);
const packageManifest = parseStrictJson(packageManifestSource);
const shrinkwrap = parseStrictJson(shrinkwrapSource, { maximumBytes: 5_000_000 });
assert.equal(packageManifest.version, PACKAGE_VERSION, "package version must match CLI version");
assert.equal(packageManifest.license, "MIT", "public CLI package must declare MIT");
assert.ok(
  Array.isArray(packageManifest.files) && packageManifest.files.includes("npm-shrinkwrap.json"),
  "package must ship npm-shrinkwrap.json",
);
assert.equal(typeof packageManifest.scripts?.sbom, "string", "package must expose an SBOM command");
assert.equal(shrinkwrap.version, PACKAGE_VERSION, "shrinkwrap version must match CLI version");
assert.equal(shrinkwrap.packages?.[""]?.license, packageManifest.license, "shrinkwrap license drift");
assertJsonEqual(
  shrinkwrap.packages?.[""]?.dependencies,
  packageManifest.dependencies,
  "shrinkwrap runtime dependencies",
);
assert.match(licenseSource, /^MIT License\n/u, "CLI license file must contain the MIT grant");

const forbiddenOriginFlag = "--api-origin";
for (const relativePath of [
  "src/cli.mjs",
  "README.md",
  "examples/direct-native-v3-no-broadcast/project/submit-unsigned-challenge.mjs",
]) {
  const source = await readFile(path.join(packageRoot, relativePath), "utf8");
  assert.equal(
    source.includes(forbiddenOriginFlag),
    false,
    `${relativePath} must not expose an authenticated API-origin override`,
  );
}

process.stdout.write(`${JSON.stringify({
  schemaVersion: "programmable.public-machine-contract-verification.v1",
  cliVersion: PACKAGE_VERSION,
  openApiDocuments: [...documents.keys()],
  result: "verified",
})}\n`);

function verifyReferences(currentName, root) {
  visit(root, (reference) => {
    const separator = reference.indexOf("#");
    const documentPart = separator === -1 ? reference : reference.slice(0, separator);
    const fragment = separator === -1 ? "" : reference.slice(separator + 1);
    assert.ok(
      documentPart.length === 0 || /^\.\/custom-launch-v[123]\.json$/u.test(documentPart),
      `${currentName} contains unsupported external reference ${reference}`,
    );
    const targetName = documentPart.length === 0 ? currentName : documentPart.slice(2);
    const target = documents.get(targetName);
    assert.ok(target, `${currentName} contains unsupported external reference ${reference}`);
    assert.ok(fragment.startsWith("/"), `${currentName} reference must use a JSON Pointer: ${reference}`);
    let value = target;
    for (const encodedSegment of fragment.slice(1).split("/")) {
      const segment = encodedSegment.replaceAll("~1", "/").replaceAll("~0", "~");
      assert.ok(
        value !== null && typeof value === "object" && Object.hasOwn(value, segment),
        `${currentName} contains unresolved reference ${reference}`,
      );
      value = value[segment];
    }
  });
}

function verifyOpenApiOperations(name, document) {
  assert.ok(
    Array.isArray(document.servers)
      && document.servers.length === 1
      && document.servers[0]?.url === API_SERVER_BY_DOCUMENT[name],
    `${name} must declare only its canonical production server`,
  );
  const operationIds = new Set();
  for (const [pathName, pathItem] of Object.entries(document.paths)) {
    assert.ok(pathName.startsWith("/"), `${name} path must begin with /: ${pathName}`);
    assertPlainObject(pathItem, `${name} path item ${pathName}`);
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (operation === undefined) continue;
      assertPlainObject(operation, `${name} ${method.toUpperCase()} ${pathName}`);
      assert.ok(
        typeof operation.operationId === "string" && operation.operationId.length > 0,
        `${name} ${method.toUpperCase()} ${pathName} must have operationId`,
      );
      assert.equal(
        operationIds.has(operation.operationId),
        false,
        `${name} contains duplicate operationId ${operation.operationId}`,
      );
      operationIds.add(operation.operationId);
      assertPlainObject(operation.responses, `${name} ${operation.operationId} responses`);
      const responseStatuses = Object.keys(operation.responses);
      assert.ok(responseStatuses.length > 0, `${name} ${operation.operationId} must declare responses`);
      assert.ok(
        responseStatuses.every((status) => status === "default" || /^[1-5][0-9]{2}$/u.test(status)),
        `${name} ${operation.operationId} contains an invalid response status`,
      );
    }
  }
  assert.ok(operationIds.size > 0, `${name} must declare at least one operation`);
}

function visit(value, onReference) {
  if (Array.isArray(value)) {
    value.forEach((entry) => visit(entry, onReference));
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (typeof value.$ref === "string") onReference(value.$ref);
  Object.values(value).forEach((entry) => visit(entry, onReference));
}

function assertPlainObject(value, label) {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), `${label} is missing`);
}

function assertJsonEqual(actual, expected, label) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), `${label} does not match`);
}
