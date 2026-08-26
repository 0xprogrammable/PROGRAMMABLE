import { lstat, readFile } from "node:fs/promises";
import { isIP } from "node:net";

import { canonicalizeJson } from "./canonical-json.mjs";
import {
  PROJECT_METADATA_HASH_DOMAIN,
  PROJECT_METADATA_INPUT_SCHEMA,
  PROJECT_METADATA_SCHEMA,
  PROJECT_TOKEN_METADATA_BINDING_SCHEMA,
} from "./constants.mjs";
import {
  assertExactKeys,
  canonicalRelativePath,
  compareUtf8,
  resolveInside,
  sha256Digest,
} from "./io.mjs";

const PROJECT_NAME_MAX_CHARACTERS = 64;
const PROJECT_NAME_MAX_BYTES = 64;
const PROJECT_SYMBOL_MAX_CHARACTERS = 16;
const PROJECT_SYMBOL_MAX_BYTES = 16;
const DESCRIPTION_MAX_BYTES = 4_096;
const URL_MAX_BYTES = 2_048;
const IMAGE_MAX_BYTES = 20 * 1_024 * 1_024;
const IMAGE_MAX_DIMENSION = 8_192;
const MAX_LINKS = 32;
const UNSAFE_PUBLIC_TEXT = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;
const UNSAFE_DESCRIPTION_TEXT = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;
const IPFS_CID = /^(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|[bB][a-zA-Z2-7]{31,127})$/u;
const ARWEAVE_TRANSACTION_ID = /^[A-Za-z0-9_-]{43}$/u;
const SENSITIVE_QUERY_KEY = /(?:api[-_]?key|access[-_]?token|auth(?:orization)?|bearer|password|secret|signature|sig)/iu;
const SECRET_PATTERNS = Object.freeze([
  /PROGRAMMABLE_API_KEY\s*=/iu,
  /(?:^|[^A-Za-z0-9_-])pm_live_[A-Za-z0-9_-]{22}_[A-Za-z0-9_-]{43}(?=$|[^A-Za-z0-9_-])/u,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/iu,
  /\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\b/u,
  /\b(?:sk|rk|pk)-(?:live|test)?[_-]?[A-Za-z0-9_-]{20,}\b/iu,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u,
  /\b(?:api[_-]?key|access[_-]?token|authorization|password|passwd|secret|private[_-]?key)\b\s*[:=]\s*["']?[^\s"']{8,}/iu,
]);
const LINK_KINDS = new Set([
  "website",
  "documentation",
  "x",
  "telegram",
  "discord",
  "github",
  "other",
]);
const STATIC_SOURCES = new Set([
  "constructor-argument",
  "initializer-argument",
  "not-deterministically-extractable",
]);
const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

export async function buildProjectMetadata(input, { sourceRoot, tokenTarget }) {
  assertExactKeys(input, ["schemaVersion", "token", "presentation"], "projectMetadata input");
  if (input.schemaVersion !== PROJECT_METADATA_INPUT_SCHEMA) {
    throw new TypeError(`projectMetadata.schemaVersion must be ${PROJECT_METADATA_INPUT_SCHEMA}`);
  }
  assertExactKeys(input.token, ["name", "symbol"], "projectMetadata.token");
  const token = {
    name: canonicalProjectText(input.token.name, "projectMetadata.token.name", {
      maximumCharacters: PROJECT_NAME_MAX_CHARACTERS,
      maximumBytes: PROJECT_NAME_MAX_BYTES,
      whitespace: "allow",
      exact: true,
    }),
    symbol: canonicalProjectText(input.token.symbol, "projectMetadata.token.symbol", {
      maximumCharacters: PROJECT_SYMBOL_MAX_CHARACTERS,
      maximumBytes: PROJECT_SYMBOL_MAX_BYTES,
      whitespace: "forbid",
      exact: true,
    }),
  };
  const presentation = await buildPresentation(input.presentation, sourceRoot);
  const tokenMetadataBinding = buildTokenMetadataBinding(token, tokenTarget);
  const projectMetadata = validateProjectMetadata({
    schemaVersion: PROJECT_METADATA_SCHEMA,
    token,
    presentation,
    tokenMetadataBinding,
  });
  return {
    projectMetadata,
    projectMetadataHash: hashProjectMetadata(projectMetadata),
    imageSourcePath: input.presentation.image?.sourcePath ?? null,
  };
}

export function validateProjectMetadata(value) {
  assertExactKeys(
    value,
    ["schemaVersion", "token", "presentation", "tokenMetadataBinding"],
    "projectMetadata",
  );
  if (value.schemaVersion !== PROJECT_METADATA_SCHEMA) {
    throw new TypeError(`projectMetadata.schemaVersion must be ${PROJECT_METADATA_SCHEMA}`);
  }
  assertExactKeys(value.token, ["name", "symbol"], "projectMetadata.token");
  const token = {
    name: canonicalProjectText(value.token.name, "projectMetadata.token.name", {
      maximumCharacters: PROJECT_NAME_MAX_CHARACTERS,
      maximumBytes: PROJECT_NAME_MAX_BYTES,
      whitespace: "allow",
      exact: true,
    }),
    symbol: canonicalProjectText(value.token.symbol, "projectMetadata.token.symbol", {
      maximumCharacters: PROJECT_SYMBOL_MAX_CHARACTERS,
      maximumBytes: PROJECT_SYMBOL_MAX_BYTES,
      whitespace: "forbid",
      exact: true,
    }),
  };
  const presentation = validatePresentation(value.presentation);
  const tokenMetadataBinding = validateTokenMetadataBinding(value.tokenMetadataBinding);
  return {
    schemaVersion: PROJECT_METADATA_SCHEMA,
    token,
    presentation,
    tokenMetadataBinding,
  };
}

export function hashProjectMetadata(value) {
  const normalized = validateProjectMetadata(value);
  return sha256Digest(Buffer.concat([
    Buffer.from(PROJECT_METADATA_HASH_DOMAIN, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalizeJson(normalized), "utf8"),
  ]));
}

async function buildPresentation(value, sourceRoot) {
  assertExactKeys(value, ["description", "image", "links"], "projectMetadata.presentation");
  const description = canonicalDescription(value.description, { exact: true });
  const links = canonicalLinks(value.links, { exactUris: true });
  if (value.image === null) {
    return {
      schemaVersion: "programmable.launch-presentation-draft.v1",
      description,
      image: null,
      links,
    };
  }
  assertExactKeys(value.image, ["sourcePath", "uri"], "projectMetadata.presentation.image");
  const sourcePath = canonicalRelativePath(
    value.image.sourcePath,
    "projectMetadata.presentation.image.sourcePath",
  );
  const absolutePath = resolveInside(
    sourceRoot,
    sourcePath,
    "projectMetadata.presentation.image.sourcePath",
  );
  const info = await lstat(absolutePath);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new TypeError("projectMetadata presentation image must be a regular source file");
  }
  if (!Number.isSafeInteger(info.size) || info.size < 1 || info.size > IMAGE_MAX_BYTES) {
    throw new TypeError(`projectMetadata presentation image must contain 1..${IMAGE_MAX_BYTES} bytes`);
  }
  const bytes = await readFile(absolutePath);
  if (bytes.byteLength === 0 || bytes.byteLength > IMAGE_MAX_BYTES) {
    throw new TypeError(`projectMetadata presentation image must contain 1..${IMAGE_MAX_BYTES} bytes`);
  }
  const dimensions = inspectImage(bytes);
  return {
    schemaVersion: "programmable.launch-presentation-draft.v1",
    description,
    image: {
      uri: canonicalPresentationImageUri(value.image.uri, { exact: true }),
      contentSha256: sha256Digest(bytes),
      mediaType: dimensions.mediaType,
      byteLength: bytes.byteLength,
      width: dimensions.width,
      height: dimensions.height,
    },
    links,
  };
}

function validatePresentation(value) {
  assertExactKeys(
    value,
    ["schemaVersion", "description", "image", "links"],
    "projectMetadata.presentation",
  );
  if (value.schemaVersion !== "programmable.launch-presentation-draft.v1") {
    throw new TypeError("projectMetadata.presentation schemaVersion is invalid");
  }
  const description = canonicalDescription(value.description, { exact: true });
  const links = canonicalLinks(value.links, { exact: true });
  let image = null;
  if (value.image !== null) {
    assertExactKeys(
      value.image,
      ["uri", "contentSha256", "mediaType", "byteLength", "width", "height"],
      "projectMetadata.presentation.image",
    );
    if (!/^sha256:[0-9a-f]{64}$/.test(value.image.contentSha256)
      || !new Set(["image/png", "image/jpeg", "image/webp", "image/gif"])
        .has(value.image.mediaType)
      || !boundedInteger(value.image.byteLength, 1, IMAGE_MAX_BYTES)
      || !boundedInteger(value.image.width, 1, IMAGE_MAX_DIMENSION)
      || !boundedInteger(value.image.height, 1, IMAGE_MAX_DIMENSION)) {
      throw new TypeError("projectMetadata.presentation.image is invalid");
    }
    image = {
      uri: canonicalPresentationImageUri(value.image.uri, { exact: true }),
      contentSha256: value.image.contentSha256,
      mediaType: value.image.mediaType,
      byteLength: value.image.byteLength,
      width: value.image.width,
      height: value.image.height,
    };
  }
  return {
    schemaVersion: "programmable.launch-presentation-draft.v1",
    description,
    image,
    links,
  };
}

function buildTokenMetadataBinding(token, target) {
  if (!target || target.componentKind !== "token") {
    throw new TypeError("projectMetadata token target is absent or not the selected token");
  }
  const name = staticallyBindTokenField("name", token.name, target);
  const symbol = staticallyBindTokenField("symbol", token.symbol, target);
  return validateTokenMetadataBinding({
    schemaVersion: PROJECT_TOKEN_METADATA_BINDING_SCHEMA,
    tokenTargetId: target.targetId,
    declarationBinding: "request-and-launch-id",
    standardReadModel: {
      name: hasStringGetter(target.abi, "name"),
      symbol: hasStringGetter(target.abi, "symbol"),
    },
    name,
    symbol,
    postDeploymentReadback: "required",
  });
}

function staticallyBindTokenField(field, declaration, target) {
  const candidates = [];
  const constructor = target.abi.find((entry) => entry?.type === "constructor") ?? {
    inputs: [],
  };
  collectStaticCandidates(
    candidates,
    field,
    "constructor-argument",
    constructor.inputs ?? [],
    target.constructorArguments,
  );
  if (target.initializer !== null) {
    const initializers = target.abi.filter((entry) => entry?.type === "function"
      && entry.name === target.initializer.function);
    if (initializers.length === 1) {
      collectStaticCandidates(
        candidates,
        field,
        "initializer-argument",
        initializers[0].inputs ?? [],
        target.initializer.arguments,
      );
    }
  }
  if (candidates.length !== 1 || typeof candidates[0].value !== "string") {
    return {
      staticSource: "not-deterministically-extractable",
      argumentIndex: null,
      argumentName: null,
    };
  }
  const candidate = candidates[0];
  if (candidate.value !== declaration) {
    throw new TypeError(
      `projectMetadata.token.${field} does not match ${candidate.source} ${candidate.argumentName}`,
    );
  }
  return {
    staticSource: candidate.source,
    argumentIndex: candidate.argumentIndex,
    argumentName: candidate.argumentName,
  };
}

function collectStaticCandidates(output, field, source, inputs, values) {
  if (!Array.isArray(inputs) || !Array.isArray(values) || inputs.length !== values.length) return;
  for (const [argumentIndex, input] of inputs.entries()) {
    if (input?.type !== "string" || !isTokenMetadataArgumentName(field, input.name)) continue;
    output.push({
      source,
      argumentIndex,
      argumentName: input.name,
      value: values[argumentIndex],
    });
  }
}

function isTokenMetadataArgumentName(field, value) {
  if (typeof value !== "string" || value.length === 0) return false;
  const normalized = value.replace(/^_+|_+$/gu, "").replaceAll("_", "").toLowerCase();
  return field === "name"
    ? normalized === "name" || normalized === "tokenname"
    : normalized === "symbol" || normalized === "tokensymbol" || normalized === "ticker";
}

function hasStringGetter(abi, name) {
  return abi.some((entry) => entry?.type === "function"
    && entry.name === name
    && (entry.inputs?.length ?? 0) === 0
    && entry.outputs?.length === 1
    && entry.outputs[0]?.type === "string");
}

function validateTokenMetadataBinding(value) {
  assertExactKeys(value, [
    "schemaVersion",
    "tokenTargetId",
    "declarationBinding",
    "standardReadModel",
    "name",
    "symbol",
    "postDeploymentReadback",
  ], "projectMetadata.tokenMetadataBinding");
  if (value.schemaVersion !== PROJECT_TOKEN_METADATA_BINDING_SCHEMA
    || typeof value.tokenTargetId !== "string"
    || !/^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,255}$/.test(value.tokenTargetId)
    || containsSecret(fullyDecode(value.tokenTargetId))
    || value.declarationBinding !== "request-and-launch-id"
    || value.postDeploymentReadback !== "required") {
    throw new TypeError("projectMetadata.tokenMetadataBinding is invalid");
  }
  assertExactKeys(
    value.standardReadModel,
    ["name", "symbol"],
    "projectMetadata.tokenMetadataBinding.standardReadModel",
  );
  if (typeof value.standardReadModel.name !== "boolean"
    || typeof value.standardReadModel.symbol !== "boolean") {
    throw new TypeError("projectMetadata token standardReadModel is invalid");
  }
  return {
    schemaVersion: PROJECT_TOKEN_METADATA_BINDING_SCHEMA,
    tokenTargetId: value.tokenTargetId,
    declarationBinding: "request-and-launch-id",
    standardReadModel: {
      name: value.standardReadModel.name,
      symbol: value.standardReadModel.symbol,
    },
    name: validateStaticBinding(value.name, "name"),
    symbol: validateStaticBinding(value.symbol, "symbol"),
    postDeploymentReadback: "required",
  };
}

function validateStaticBinding(value, field) {
  assertExactKeys(
    value,
    ["staticSource", "argumentIndex", "argumentName"],
    `projectMetadata.tokenMetadataBinding.${field}`,
  );
  if (!STATIC_SOURCES.has(value.staticSource)) {
    throw new TypeError(`projectMetadata ${field} staticSource is invalid`);
  }
  if (value.staticSource === "not-deterministically-extractable") {
    if (value.argumentIndex !== null || value.argumentName !== null) {
      throw new TypeError(`projectMetadata ${field} nondeterministic source must use null ABI leaves`);
    }
  } else if (!Number.isSafeInteger(value.argumentIndex) || value.argumentIndex < 0) {
    throw new TypeError(`projectMetadata ${field} static ABI source is invalid`);
  }
  const argumentName = value.staticSource === "not-deterministically-extractable"
    ? null
    : canonicalArgumentName(value.argumentName, field);
  return {
    staticSource: value.staticSource,
    argumentIndex: value.argumentIndex,
    argumentName,
  };
}

function canonicalArgumentName(value, field) {
  if (typeof value !== "string"
    || value.length === 0
    || value !== value.normalize("NFC")
    || value.trim() !== value
    || [...value].length > 256
    || Buffer.byteLength(value, "utf8") > 256
    || UNSAFE_PUBLIC_TEXT.test(value)
    || hasLoneSurrogate(value)
    || containsSecret(fullyDecode(value))) {
    throw new TypeError(`projectMetadata ${field} static ABI argumentName is invalid`);
  }
  return value;
}

function canonicalProjectText(value, label, {
  maximumCharacters,
  maximumBytes,
  whitespace,
  exact = false,
}) {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  const normalized = value.normalize("NFC").trim();
  if ((exact && normalized !== value)
    || normalized.length === 0
    || [...normalized].length > maximumCharacters
    || Buffer.byteLength(normalized, "utf8") > maximumBytes
    || UNSAFE_PUBLIC_TEXT.test(normalized)
    || hasLoneSurrogate(normalized)
    || containsSecret(fullyDecode(normalized))
    || (whitespace === "forbid" && /\s/u.test(normalized))) {
    throw new TypeError(`${label} is not canonical public token metadata`);
  }
  return normalized;
}

function canonicalDescription(value, { exact = false } = {}) {
  if (typeof value !== "string") throw new TypeError("projectMetadata presentation description must be a string");
  const normalized = value.normalize("NFC").replace(/\r\n?/gu, "\n").trim();
  if ((exact && normalized !== value)
    || Buffer.byteLength(normalized, "utf8") > DESCRIPTION_MAX_BYTES
    || UNSAFE_DESCRIPTION_TEXT.test(normalized)
    || hasLoneSurrogate(normalized)
    || containsSecret(fullyDecode(normalized))) {
    throw new TypeError("projectMetadata presentation description is not canonical public text");
  }
  return normalized;
}

function canonicalLinks(value, { exact = false, exactUris = exact } = {}) {
  if (!Array.isArray(value) || value.length > MAX_LINKS) {
    throw new TypeError(`projectMetadata presentation links must contain at most ${MAX_LINKS} entries`);
  }
  const links = value.map((candidate, index) => {
    assertExactKeys(candidate, ["kind", "uri"], `projectMetadata presentation links[${index}]`);
    if (!LINK_KINDS.has(candidate.kind)) {
      throw new TypeError(`projectMetadata presentation links[${index}].kind is invalid`);
    }
    return {
      kind: candidate.kind,
      uri: canonicalPublicHttpsUri(
        candidate.uri,
        `projectMetadata presentation links[${index}].uri`,
        { exact: exactUris },
      ),
    };
  }).sort((left, right) => compareUtf8(
    `${left.kind}\0${left.uri}`,
    `${right.kind}\0${right.uri}`,
  ));
  const keys = links.map(({ kind, uri }) => `${kind}\0${uri}`);
  if (new Set(keys).size !== keys.length) {
    throw new TypeError("projectMetadata presentation links must be unique");
  }
  if (exact && canonicalizeJson(links) !== canonicalizeJson(value)) {
    throw new TypeError("projectMetadata presentation links are not canonically ordered");
  }
  return links;
}

function canonicalPublicHttpsUri(value, label, { forbidQuery = false, exact = false } = {}) {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value
    || unsafeUriText(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${label} is invalid`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash
    || url.hostname === "" || url.hostname === "localhost"
    || url.hostname === "localhost." || url.hostname === "local" || url.hostname === "local."
    || url.hostname.endsWith(".localhost") || url.hostname.endsWith(".localhost.")
    || url.hostname.endsWith(".local") || url.hostname.endsWith(".local.")
    || url.hostname.includes(":")
    || isIP(url.hostname) !== 0 || !/^[a-z0-9.-]+$/u.test(url.hostname)
    || (forbidQuery && url.search !== "")) {
    throw new TypeError(`${label} must be a public credential-free HTTPS URL without a fragment`);
  }
  for (const [key, entry] of url.searchParams) {
    if (SENSITIVE_QUERY_KEY.test(key) || containsSecret(fullyDecode(entry))) {
      throw new TypeError(`${label} contains a credential-like query parameter`);
    }
  }
  const canonical = url.href;
  if (Buffer.byteLength(canonical, "utf8") > URL_MAX_BYTES || (exact && canonical !== value)) {
    throw new TypeError(`${label} is not canonical`);
  }
  return canonical;
}

function canonicalPresentationImageUri(value, { exact = false } = {}) {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value
    || unsafeUriText(value)) {
    throw new TypeError("projectMetadata presentation image URI is invalid");
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("projectMetadata presentation image URI is invalid");
  }
  if (url.protocol === "https:") {
    return canonicalPublicHttpsUri(value, "projectMetadata presentation image URI", {
      forbidQuery: true,
      exact,
    });
  }
  if (url.username || url.password || url.port || url.pathname || url.search || url.hash
    || !((url.protocol === "ipfs:" && IPFS_CID.test(url.hostname))
      || (url.protocol === "ar:" && ARWEAVE_TRANSACTION_ID.test(url.hostname)))) {
    throw new TypeError("projectMetadata presentation image URI is invalid");
  }
  const canonical = url.href;
  if (Buffer.byteLength(canonical, "utf8") > URL_MAX_BYTES || (exact && canonical !== value)) {
    throw new TypeError("projectMetadata presentation image URI is not canonical");
  }
  return canonical;
}

function unsafeUriText(value) {
  const decoded = fullyDecode(value);
  return /[\u0000-\u0020\u007f-\u009f]/u.test(value)
    || /[\u0000-\u0020\u007f-\u009f]/u.test(decoded)
    || hasLoneSurrogate(value)
    || hasLoneSurrogate(decoded)
    || containsSecret(decoded);
}

function fullyDecode(value) {
  let current = value;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const next = decodeURIComponent(current);
      if (next === current) return current;
      current = next;
    } catch {
      return current;
    }
  }
  return current;
}

function containsSecret(value) {
  return SECRET_PATTERNS.some((pattern) => pattern.test(value));
}

function hasLoneSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function inspectImage(bytes) {
  const image = inspectPng(bytes) ?? inspectGif(bytes) ?? inspectJpeg(bytes) ?? inspectWebp(bytes);
  if (image === null
    || !boundedInteger(image.width, 1, IMAGE_MAX_DIMENSION)
    || !boundedInteger(image.height, 1, IMAGE_MAX_DIMENSION)) {
    throw new TypeError("projectMetadata presentation image is not a supported valid PNG, JPEG, WebP, or GIF");
  }
  return image;
}

function inspectPng(bytes) {
  if (bytes.length < 24
    || !bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
    || bytes.subarray(12, 16).toString("ascii") !== "IHDR") return null;
  return {
    mediaType: "image/png",
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

function inspectGif(bytes) {
  if (bytes.length < 10 || !new Set(["GIF87a", "GIF89a"])
    .has(bytes.subarray(0, 6).toString("ascii"))) return null;
  return {
    mediaType: "image/gif",
    width: bytes.readUInt16LE(6),
    height: bytes.readUInt16LE(8),
  };
}

function inspectJpeg(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if (JPEG_SOF_MARKERS.has(marker) && length >= 7) {
      return {
        mediaType: "image/jpeg",
        width: bytes.readUInt16BE(offset + 5),
        height: bytes.readUInt16BE(offset + 3),
      };
    }
    offset += length;
  }
  return null;
}

function inspectWebp(bytes) {
  if (bytes.length < 30 || bytes.subarray(0, 4).toString("ascii") !== "RIFF"
    || bytes.subarray(8, 12).toString("ascii") !== "WEBP") return null;
  const kind = bytes.subarray(12, 16).toString("ascii");
  if (kind === "VP8X") {
    return {
      mediaType: "image/webp",
      width: readUInt24LE(bytes, 24) + 1,
      height: readUInt24LE(bytes, 27) + 1,
    };
  }
  const dataOffset = 20;
  if (kind === "VP8 " && bytes.length >= dataOffset + 14
    && bytes[dataOffset + 3] === 0x9d
    && bytes[dataOffset + 4] === 0x01
    && bytes[dataOffset + 5] === 0x2a) {
    return {
      mediaType: "image/webp",
      width: bytes.readUInt16LE(dataOffset + 6) & 0x3fff,
      height: bytes.readUInt16LE(dataOffset + 8) & 0x3fff,
    };
  }
  if (kind === "VP8L" && bytes.length >= dataOffset + 5 && bytes[dataOffset] === 0x2f) {
    const bits = bytes.readUInt32LE(dataOffset + 1);
    return {
      mediaType: "image/webp",
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
    };
  }
  return null;
}

function readUInt24LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function boundedInteger(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}
