import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DEVELOPERS_SOURCE = Object.freeze({
  repository: "programmablehq/Developers",
  commit: "5641d2c75d58239864f4827c9bb054abc170af18",
  entrypoint: "openapi/programmable-v2.yaml",
  entrypointSha256:
    "b7925914d450d0a10cc73cd85fcc36418ac0238b9f3d9f46a15499d5483a405e",
  strictGraphDocumentCount: 21,
  strictGraphReferenceDocumentCount: 20,
});

export const GITBOOK_ENTRYPOINT =
  "docs/public/.gitbook/assets/programmable-v2.yaml";
export const GITBOOK_RECEIPT =
  "docs/public/.gitbook/assets/programmable-v2.source.json";
export const GITBOOK_SCHEMA_ROOT = "docs/public/.gitbook/schemas/v2";

const ALLOWED_EXTERNAL_REFERENCES = Object.freeze([
  "https://programmable.market/openapi/custom-launch-v3.json#/components/schemas/FinalizedCustomLaunchMetadataListV1",
]);

const PINNED_DOCUMENTS = Object.freeze(
  [
    [
      "openapi/programmable-v2.yaml",
      40_803,
      "b7925914d450d0a10cc73cd85fcc36418ac0238b9f3d9f46a15499d5483a405e",
    ],
    [
      "schemas/v2/common.schema.json",
      2_359,
      "a83a76f27403ff038b3f108615daef95fa46b8c32b01da5f4845b4c7146ae6f9",
    ],
    [
      "schemas/v2/custom-fee-enforced-launch-profile-v2.schema.json",
      14_915,
      "1b91510ff39a1e49b24c2f096912b03f4c83189f2623e31bb572ef811df3b175",
    ],
    [
      "schemas/v2/custom-launch-chain-deployment-v4.schema.json",
      38_718,
      "6969a26df1aadc0fd9ed5eeafbc40b9f45a45284af804adc738ba122d69d7fb1",
    ],
    [
      "schemas/v2/custom-launch-registry-record-v3.schema.json",
      47_665,
      "a12b1b0f5c69a9e743120224383fbfa31054d31ab3a7c47ee686f08ae6bcf3d5",
    ],
    [
      "schemas/v2/custom-launch-registry-record-v4.schema.json",
      64_170,
      "207c5d1100f8153be7b4833457ffe2f4e665e658ce10b40d0a1434031304aa32",
    ],
    [
      "schemas/v2/custom-launch-source-verification-v4.schema.json",
      7_084,
      "fd9e7eb9583157079bba35a898307940a69195d55e15316a979085e38a96dc2d",
    ],
    [
      "schemas/v2/direct-native-hook-graph-profile-discovery-v1.schema.json",
      17_616,
      "1b55c779a2d47b91feeb9a617a7659cc55984aef015b50efde7caf1d180fc77a",
    ],
    [
      "schemas/v2/direct-native-hook-graph-profile-discovery-v2.schema.json",
      20_981,
      "79c5c3374adb54076c87ca115ffcd7b2582ee2823a017331251263bdc6b25dc7",
    ],
    [
      "schemas/v2/direct-native-hook-graph-profile-discovery-v3.schema.json",
      22_721,
      "450c9badb1fed0abef929cfae4dbdf31019c6af656ffc37cc27ff00b7b04efae",
    ],
    [
      "schemas/v2/launch-feed.schema.json",
      5_239,
      "3c2f745a4a53ccc3b63c349be76633412d2ccc1f84d13a73dac6ddd3784ada01",
    ],
    [
      "schemas/v2/launch-partner-attribution-v1.schema.json",
      1_799,
      "e2be19c239a7ebf683b3bfa25918b7cdd9025d4f3daae349d4f5cc4adc80747e",
    ],
    [
      "schemas/v2/launch.schema.json",
      100_637,
      "d47618dbe35ded3ee00517e47988a712faf6927790d72ea4b20a5fd26bd3e59b",
    ],
    [
      "schemas/v2/manifest.schema.json",
      86_885,
      "54d9cb891dfb2cfe6963b18ea4c3e67f8786b2a87b2c01d970777a79423298a3",
    ],
    [
      "schemas/v2/problem.schema.json",
      1_164,
      "c465eb8194652c211533d884cfe8e64aa67440d52d6ffa8661c36ac70591a80a",
    ],
    [
      "schemas/v2/robinhood-custom-launch-binding.schema.json",
      18_480,
      "3aef9c6a23706a7ab9ee06c61d2f479ff5badf215c3c617b7c389ecb35a64dd2",
    ],
    [
      "schemas/v2/status.schema.json",
      14_480,
      "445458dbdadbc12b308b01440b67b7b51ce9893a56f7f98cc5c8e8a103d855e7",
    ],
    [
      "schemas/v2/token-list.schema.json",
      3_453,
      "3fbd507bab47492c92c4d2d748ac9195695122c0c2b171b08a92a737af897623",
    ],
  ].map(([sourcePath, bytes, sha256]) =>
    Object.freeze({ sourcePath, bytes, sha256 }),
  ),
);

const PINNED_CLOSURE_SHA256 =
  "861b55bd07fe721ca9abbda98812a8adb5ba34191b7d1cc123a032db24cb4e79";
const PINNED_BY_SOURCE_PATH = new Map(
  PINNED_DOCUMENTS.map((document) => [document.sourcePath, document]),
);
const SCRIPT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function closureSha256(documents) {
  const vector = [...documents]
    .sort((left, right) => left.sourcePath.localeCompare(right.sourcePath))
    .map(
      ({ sourcePath, bytes, sha256: digest }) =>
        `${sourcePath}\0${bytes}\0${digest}\n`,
    )
    .join("");
  return sha256(Buffer.from(vector, "utf8"));
}

if (closureSha256(PINNED_DOCUMENTS) !== PINNED_CLOSURE_SHA256) {
  throw new Error("Pinned GitBook OpenAPI closure contract is internally inconsistent");
}

function destinationPathForSource(sourcePath) {
  if (sourcePath === DEVELOPERS_SOURCE.entrypoint) return GITBOOK_ENTRYPOINT;
  const prefix = "schemas/v2/";
  if (!sourcePath.startsWith(prefix)) {
    throw new Error(`Unsupported Developers OpenAPI source path: ${sourcePath}`);
  }
  return `${GITBOOK_SCHEMA_ROOT}/${sourcePath.slice(prefix.length)}`;
}

function inside(root, relativePath) {
  if (path.isAbsolute(relativePath)) {
    throw new Error(`Expected a repository-relative path: ${relativePath}`);
  }
  const candidate = path.resolve(root, relativePath);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Path escapes repository root: ${relativePath}`);
  }
  return candidate;
}

async function readRegularFile(root, relativePath) {
  const absolutePath = inside(root, relativePath);
  const stat = await lstat(absolutePath).catch((error) => {
    if (error?.code === "ENOENT") {
      throw new Error(`Required GitBook OpenAPI file is missing: ${relativePath}`);
    }
    throw error;
  });
  if (!stat.isFile()) {
    throw new Error(`GitBook OpenAPI path is not a regular file: ${relativePath}`);
  }
  return readFile(absolutePath);
}

function assertPinnedBytes(document, bytes, label) {
  if (bytes.byteLength !== document.bytes) {
    throw new Error(
      `${label} byte drift: expected ${document.bytes}, received ${bytes.byteLength}`,
    );
  }
  const actualDigest = sha256(bytes);
  if (actualDigest !== document.sha256) {
    throw new Error(
      `${label} digest drift: expected sha256:${document.sha256}, received sha256:${actualDigest}`,
    );
  }
}

function visitReferences(value, callback) {
  if (Array.isArray(value)) {
    for (const item of value) visitReferences(item, callback);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (typeof value.$ref === "string") callback(value.$ref);
  for (const item of Object.values(value)) visitReferences(item, callback);
}

function extractYamlReferences(bytes) {
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const references = [];
  const pattern = /^\s*(?:-\s*)?\$ref:\s*(.*?)\s*$/gmu;
  for (const match of source.matchAll(pattern)) {
    let scalar = match[1];
    if (scalar.startsWith('"')) {
      scalar = JSON.parse(scalar);
    } else if (scalar.startsWith("'")) {
      if (!scalar.endsWith("'")) {
        throw new Error(`Invalid single-quoted YAML $ref: ${scalar}`);
      }
      scalar = scalar.slice(1, -1).replaceAll("''", "'");
    } else {
      scalar = scalar.replace(/\s+#.*$/u, "");
    }
    if (typeof scalar !== "string" || scalar.length === 0) {
      throw new Error("OpenAPI YAML contains an empty $ref");
    }
    references.push(scalar);
  }
  if (references.length === 0) {
    throw new Error("OpenAPI YAML contains no $ref entries");
  }
  return references;
}

function parseJsonDocument(bytes, label) {
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`${label} is not JSON: ${error.message}`);
  }
}

function atJsonPointer(value, fragment) {
  if (!fragment || fragment === "#") return value;
  let pointer;
  try {
    pointer = decodeURIComponent(fragment.slice(1));
  } catch {
    return undefined;
  }
  if (!pointer.startsWith("/")) return undefined;
  return pointer
    .slice(1)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce((current, segment) => current?.[segment], value);
}

function splitLocalReference(reference) {
  const separator = reference.indexOf("#");
  return separator === -1
    ? { document: reference, fragment: "" }
    : {
        document: reference.slice(0, separator),
        fragment: reference.slice(separator),
      };
}

function resolveSourceReference(sourcePath, reference) {
  const { document, fragment } = splitLocalReference(reference);
  if (!document) return { sourcePath, fragment };
  if (
    document.includes("?") ||
    document.includes("\\") ||
    path.posix.isAbsolute(document)
  ) {
    throw new Error(`${sourcePath} contains an unsupported local $ref: ${reference}`);
  }
  const target = path.posix.normalize(
    path.posix.join(path.posix.dirname(sourcePath), document),
  );
  if (target === ".." || target.startsWith("../")) {
    throw new Error(`${sourcePath} contains an escaping $ref: ${reference}`);
  }
  return { sourcePath: target, fragment };
}

async function inspectPinnedGraph({ readDocument }) {
  const cache = new Map();
  const visited = new Set();
  const externalReferences = new Set();
  let rootInternalReferenceCount = 0;

  async function load(sourcePath) {
    if (cache.has(sourcePath)) return cache.get(sourcePath);
    const pin = PINNED_BY_SOURCE_PATH.get(sourcePath);
    if (!pin) {
      throw new Error(`OpenAPI graph references an unpinned document: ${sourcePath}`);
    }
    const bytes = await readDocument(pin);
    assertPinnedBytes(pin, bytes, sourcePath);
    const json = sourcePath.endsWith(".json")
      ? parseJsonDocument(bytes, sourcePath)
      : null;
    const references = json
      ? (() => {
          const values = [];
          visitReferences(json, (reference) => values.push(reference));
          return values;
        })()
      : extractYamlReferences(bytes);
    const loaded = { bytes, json, references };
    cache.set(sourcePath, loaded);
    return loaded;
  }

  async function walk(sourcePath) {
    if (visited.has(sourcePath)) return;
    visited.add(sourcePath);
    const current = await load(sourcePath);
    for (const reference of current.references) {
      if (reference.startsWith("https://")) {
        externalReferences.add(reference);
        continue;
      }
      if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(reference)) {
        throw new Error(`${sourcePath} contains an unsupported $ref: ${reference}`);
      }
      const target = resolveSourceReference(sourcePath, reference);
      const targetDocument = await load(target.sourcePath);
      if (target.fragment) {
        if (targetDocument.json === null) {
          if (target.sourcePath !== DEVELOPERS_SOURCE.entrypoint) {
            throw new Error(
              `${sourcePath} references an unparseable YAML fragment: ${reference}`,
            );
          }
          rootInternalReferenceCount += 1;
        } else if (atJsonPointer(targetDocument.json, target.fragment) === undefined) {
          throw new Error(`${sourcePath} contains an unresolved $ref: ${reference}`);
        }
      }
      await walk(target.sourcePath);
    }
  }

  await walk(DEVELOPERS_SOURCE.entrypoint);
  const actualDocuments = [...visited].sort();
  const expectedDocuments = PINNED_DOCUMENTS.map(({ sourcePath }) =>
    sourcePath,
  ).sort();
  if (JSON.stringify(actualDocuments) !== JSON.stringify(expectedDocuments)) {
    throw new Error(
      `OpenAPI local closure drift: expected ${expectedDocuments.join(", ")}; received ${actualDocuments.join(", ")}`,
    );
  }
  const actualExternalReferences = [...externalReferences].sort();
  if (
    JSON.stringify(actualExternalReferences) !==
    JSON.stringify([...ALLOWED_EXTERNAL_REFERENCES])
  ) {
    throw new Error(
      `OpenAPI external $ref drift: expected ${ALLOWED_EXTERNAL_REFERENCES.join(", ")}; received ${actualExternalReferences.join(", ")}`,
    );
  }
  if (rootInternalReferenceCount === 0) {
    throw new Error("OpenAPI graph contains no pinned entrypoint fragment references");
  }
  return {
    documents: PINNED_DOCUMENTS,
    externalReferences: actualExternalReferences,
    localDocumentCount: actualDocuments.length,
    localReferenceDocumentCount: Math.max(0, actualDocuments.length - 1),
    rootInternalReferenceCount,
  };
}

function buildReceipt() {
  return {
    schemaVersion: "programmable.gitbook-openapi-source-receipt.v1",
    canonicalSource: {
      repository: DEVELOPERS_SOURCE.repository,
      commit: DEVELOPERS_SOURCE.commit,
      entrypoint: DEVELOPERS_SOURCE.entrypoint,
      entrypointDigest: `sha256:${DEVELOPERS_SOURCE.entrypointSha256}`,
      upstreamStrictGraph: {
        documentCount: DEVELOPERS_SOURCE.strictGraphDocumentCount,
        referenceDocumentCount:
          DEVELOPERS_SOURCE.strictGraphReferenceDocumentCount,
      },
    },
    mirror: {
      entrypoint: GITBOOK_ENTRYPOINT,
      schemaRoot: GITBOOK_SCHEMA_ROOT,
      localDocumentCount: PINNED_DOCUMENTS.length,
      localReferenceDocumentCount: PINNED_DOCUMENTS.length - 1,
      closureDigest: `sha256:${PINNED_CLOSURE_SHA256}`,
      allowedExternalReferences: [...ALLOWED_EXTERNAL_REFERENCES],
      documents: PINNED_DOCUMENTS.map((document) => ({
        sourcePath: document.sourcePath,
        destinationPath: destinationPathForSource(document.sourcePath),
        bytes: document.bytes,
        digest: `sha256:${document.sha256}`,
      })),
    },
  };
}

function receiptBytes() {
  return Buffer.from(`${JSON.stringify(buildReceipt(), null, 2)}\n`, "utf8");
}

async function listSchemaEntries(schemaRoot) {
  const entries = [];
  async function walk(directory, prefix = "") {
    const children = await readdir(directory, { withFileTypes: true }).catch(
      (error) => {
        if (error?.code === "ENOENT") return [];
        throw error;
      },
    );
    for (const child of children) {
      const relativePath = prefix ? `${prefix}/${child.name}` : child.name;
      if (child.isDirectory()) {
        entries.push(`${relativePath}/`);
        await walk(path.join(directory, child.name), relativePath);
      } else {
        entries.push(relativePath);
      }
    }
  }
  await walk(schemaRoot);
  return entries.sort();
}

async function assertExactSchemaEntries(repositoryRoot, { allowMissing = false } = {}) {
  const schemaRoot = inside(repositoryRoot, GITBOOK_SCHEMA_ROOT);
  const actual = await listSchemaEntries(schemaRoot);
  if (allowMissing && actual.length === 0) return;
  const expected = PINNED_DOCUMENTS.filter(({ sourcePath }) =>
    sourcePath.startsWith("schemas/v2/"),
  )
    .map(({ sourcePath }) => sourcePath.slice("schemas/v2/".length))
    .sort();
  const unexpected = actual.filter((entry) => !expected.includes(entry));
  if (unexpected.length > 0) {
    throw new Error(
      `Unexpected GitBook OpenAPI schema entries: ${unexpected.join(", ")}`,
    );
  }
  const missing = expected.filter((entry) => !actual.includes(entry));
  if (!allowMissing && missing.length > 0) {
    throw new Error(`Missing GitBook OpenAPI schema files: ${missing.join(", ")}`);
  }
}

async function atomicWrite(target, bytes) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o644 });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function canonicalRoot(root) {
  return realpath(path.resolve(root));
}

function readGitValue(root, args, label) {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    throw new Error(`Unable to verify Developers ${label}`);
  }
}

async function assertDevelopersIdentity(developersRoot) {
  const gitTopLevel = await canonicalRoot(
    readGitValue(developersRoot, ["rev-parse", "--show-toplevel"], "repository root"),
  );
  if (gitTopLevel !== developersRoot) {
    throw new Error(
      `Developers root drift: expected ${developersRoot}, git resolved ${gitTopLevel}`,
    );
  }
  const head = readGitValue(
    developersRoot,
    ["rev-parse", "--verify", "HEAD^{commit}"],
    "commit",
  );
  if (head !== DEVELOPERS_SOURCE.commit) {
    throw new Error(
      `Developers commit drift: expected ${DEVELOPERS_SOURCE.commit}, received ${head}`,
    );
  }
}

export async function checkGitBookOpenApiMirror({ repositoryRoot = SCRIPT_ROOT } = {}) {
  const root = await canonicalRoot(repositoryRoot);
  await assertExactSchemaEntries(root);
  const graph = await inspectPinnedGraph({
    readDocument: (document) =>
      readRegularFile(root, destinationPathForSource(document.sourcePath)),
  });
  const expectedReceipt = receiptBytes();
  const actualReceipt = await readRegularFile(root, GITBOOK_RECEIPT);
  if (!actualReceipt.equals(expectedReceipt)) {
    throw new Error(
      `GitBook OpenAPI source receipt drift: expected sha256:${sha256(expectedReceipt)}, received sha256:${sha256(actualReceipt)}`,
    );
  }
  return {
    mode: "check",
    entrypointDigest: `sha256:${DEVELOPERS_SOURCE.entrypointSha256}`,
    closureDigest: `sha256:${PINNED_CLOSURE_SHA256}`,
    receiptDigest: `sha256:${sha256(expectedReceipt)}`,
    ...graph,
  };
}

export async function syncGitBookOpenApiMirror({
  developersRoot,
  repositoryRoot = SCRIPT_ROOT,
} = {}) {
  if (!developersRoot) {
    throw new Error("--write requires --developers-root <path>");
  }
  const [sourceRoot, destinationRoot] = await Promise.all([
    canonicalRoot(developersRoot),
    canonicalRoot(repositoryRoot),
  ]);
  await assertDevelopersIdentity(sourceRoot);
  await assertExactSchemaEntries(destinationRoot, { allowMissing: true });
  const sourceBytes = new Map();
  await inspectPinnedGraph({
    readDocument: async (document) => {
      const bytes = await readRegularFile(sourceRoot, document.sourcePath);
      sourceBytes.set(document.sourcePath, bytes);
      return bytes;
    },
  });
  for (const document of PINNED_DOCUMENTS) {
    await atomicWrite(
      inside(destinationRoot, destinationPathForSource(document.sourcePath)),
      sourceBytes.get(document.sourcePath),
    );
  }
  await atomicWrite(inside(destinationRoot, GITBOOK_RECEIPT), receiptBytes());
  const result = await checkGitBookOpenApiMirror({
    repositoryRoot: destinationRoot,
  });
  return { ...result, mode: "write" };
}

function usage() {
  return [
    "Usage:",
    "  node scripts/sync-gitbook-openapi-v2.mjs --check",
    "  node scripts/sync-gitbook-openapi-v2.mjs --write --developers-root <path>",
  ].join("\n");
}

function parseArguments(argv) {
  let mode = null;
  let developersRoot = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check" || argument === "--write") {
      if (mode !== null) throw new Error("Choose exactly one of --check or --write");
      mode = argument.slice(2);
    } else if (argument === "--developers-root") {
      if (developersRoot !== null || index + 1 >= argv.length) {
        throw new Error("--developers-root requires exactly one path");
      }
      developersRoot = argv[index + 1];
      index += 1;
    } else if (argument === "--help") {
      return { help: true };
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (mode === null) throw new Error("Choose exactly one of --check or --write");
  if (mode === "check" && developersRoot !== null) {
    throw new Error("Offline --check does not accept --developers-root");
  }
  if (mode === "write" && developersRoot === null) {
    throw new Error("--write requires --developers-root <path>");
  }
  return { mode, developersRoot, help: false };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const result = options.mode === "write"
    ? await syncGitBookOpenApiMirror({ developersRoot: options.developersRoot })
    : await checkGitBookOpenApiMirror();
  process.stdout.write(
    `GitBook OpenAPI V2 ${result.mode} OK: ${result.localDocumentCount} local documents, ` +
      `${result.localReferenceDocumentCount} local referenced documents, ` +
      `${result.externalReferences.length} pinned external reference, ` +
      `${result.closureDigest}\n`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  });
}
