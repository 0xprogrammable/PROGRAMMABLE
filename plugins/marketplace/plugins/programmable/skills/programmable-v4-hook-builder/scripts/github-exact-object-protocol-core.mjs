import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import { GitHubPublicSourceError } from "./github-public-source-core.mjs";

const REGULAR_BLOB_MODES = new Set(["100644", "100755"]);
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true });

export function parseGitVersion(output) {
  let source;
  try {
    source = STRICT_UTF8.decode(output);
  } catch {
    return null;
  }
  const match = /^git version ([0-9]+\.[0-9]+\.[0-9]+)(?:[^0-9.]|$)/u.exec(source.trim());
  return match?.[1] ?? null;
}

export function compareNumericVersion(left, right) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}


export function enforceContentLimits(request, treeRecords, objectSizes) {
  let totalBytes = 0;
  for (const record of treeRecords.values()) {
    const header = objectSizes.get(record.objectId);
    if (header?.type !== "blob") {
      throw new GitHubPublicSourceError(
        "GITHUB_DECLARED_PATH_NOT_FOUND",
        "A declared source blob was unavailable after sparse backfill"
      );
    }
    if (header.size > request.maximumFileBytes) {
      throw new GitHubPublicSourceError(
        "GITHUB_RESPONSE_TOO_LARGE",
        "A declared source blob exceeds the bounded inert-content limit"
      );
    }
    totalBytes += header.size;
    if (totalBytes > request.maximumTotalBytes) {
      throw new GitHubPublicSourceError(
        "GITHUB_RESPONSE_TOO_LARGE",
        "Declared source blobs exceed the aggregate inert-content limit"
      );
    }
  }
}


export function buildResultRecords(treeRecords, objectSizes, objectBytes) {
  const records = new Map();
  for (const [filePath, treeRecord] of treeRecords) {
    const bytes = objectBytes.get(treeRecord.objectId)?.bytes;
    const expectedSize = objectSizes.get(treeRecord.objectId)?.size;
    if (!(bytes instanceof Buffer) || bytes.length !== expectedSize) {
      throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", "Git blob bytes did not match declared object metadata");
    }
    records.set(filePath, {
      mode: treeRecord.mode,
      objectId: treeRecord.objectId,
      bytes: Buffer.from(bytes)
    });
  }
  return records;
}

export function parseTreeRecords(output, requestedPaths) {
  const requested = new Set(requestedPaths);
  const records = new Map();
  const entries = splitNulRecords(output);
  for (const entry of entries) {
    const tab = entry.indexOf(0x09);
    if (tab < 0) protocolError("Git tree output did not contain a path separator");
    const header = entry.subarray(0, tab).toString("ascii");
    const match = header.match(/^([0-7]{6}) ([a-z]+) ([0-9a-f]{40})$/u);
    if (!match) protocolError("Git tree output contained invalid object metadata");
    let filePath;
    try {
      filePath = STRICT_UTF8.decode(entry.subarray(tab + 1));
    } catch (error) {
      throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", "Git tree output contained a non-UTF-8 path", {
        cause: error
      });
    }
    if (!requested.has(filePath) || records.has(filePath)) {
      protocolError("Git tree output did not match the exact declared paths");
    }
    if (match[2] !== "blob" || !REGULAR_BLOB_MODES.has(match[1])) {
      throw new GitHubPublicSourceError(
        "GITHUB_DECLARED_PATH_NOT_FOUND",
        "A declared source path was not found as a regular blob in the exact tree"
      );
    }
    records.set(filePath, { mode: match[1], objectId: match[3] });
  }
  if (records.size !== requested.size) {
    throw new GitHubPublicSourceError(
      "GITHUB_DECLARED_PATH_NOT_FOUND",
      "A declared source path was not found as a regular blob in the exact tree"
    );
  }
  return new Map([...records].sort(([left], [right]) => compareUtf8(left, right)));
}

export function parseBatchCheck(output, requestedObjectIds) {
  let text;
  try {
    text = STRICT_UTF8.decode(output);
  } catch (error) {
    throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", "Git object metadata was not valid UTF-8", {
      cause: error
    });
  }
  const lines = text.endsWith("\n") ? text.slice(0, -1).split("\n") : [];
  if (lines.length !== requestedObjectIds.length) {
    protocolError("Git object metadata count did not match the request");
  }
  const records = new Map();
  for (let index = 0; index < lines.length; index += 1) {
    const objectId = requestedObjectIds[index];
    const match = lines[index].match(/^([0-9a-f]{40}) ([a-z]+) (0|[1-9][0-9]*)$/u);
    if (!match || match[1] !== objectId) {
      protocolError("Git object metadata did not match the exact requested object");
    }
    const size = Number(match[3]);
    if (!Number.isSafeInteger(size)) protocolError("Git object size was outside the supported integer range");
    records.set(objectId, { type: match[2], size });
  }
  return records;
}

export function parseBatchObjects(output, requestedObjectIds) {
  const records = new Map();
  let cursor = 0;
  for (const requestedObjectId of requestedObjectIds) {
    const headerEnd = output.indexOf(0x0a, cursor);
    if (headerEnd < cursor || headerEnd - cursor > 256) {
      protocolError("Git batch output contained an invalid object header");
    }
    const header = output.subarray(cursor, headerEnd).toString("ascii");
    const match = header.match(/^([0-9a-f]{40}) ([a-z]+) (0|[1-9][0-9]*)$/u);
    if (!match || match[1] !== requestedObjectId) {
      protocolError("Git batch output did not match the exact requested object");
    }
    const size = Number(match[3]);
    if (!Number.isSafeInteger(size)) protocolError("Git object size was outside the supported integer range");
    const bodyStart = headerEnd + 1;
    const bodyEnd = bodyStart + size;
    if (bodyEnd >= output.length || output[bodyEnd] !== 0x0a) {
      protocolError("Git batch output contained truncated object bytes");
    }
    records.set(requestedObjectId, {
      type: match[2],
      bytes: Buffer.from(output.subarray(bodyStart, bodyEnd))
    });
    cursor = bodyEnd + 1;
  }
  if (cursor !== output.length) protocolError("Git batch output contained unexpected trailing bytes");
  return records;
}

function splitNulRecords(output) {
  if (output.length === 0) return [];
  if (output.at(-1) !== 0) protocolError("Git tree output was not NUL terminated");
  const records = [];
  let start = 0;
  for (let index = 0; index < output.length; index += 1) {
    if (output[index] !== 0) continue;
    if (index === start) protocolError("Git tree output contained an empty record");
    records.push(output.subarray(start, index));
    start = index + 1;
  }
  return records;
}

export function escapeSparsePattern(value) {
  return value.replace(/[\\!#*?\[\] ]/gu, (character) => `\\${character}`);
}

export function uniqueObjectIds(treeRecords) {
  return [...new Set([...treeRecords.values()].map((entry) => entry.objectId))].sort();
}

export function verifyGitObjectId(type, bytes, expectedObjectId, errorCode) {
  const observedObjectId = createHash("sha1")
    .update(`${type} ${bytes.length}\0`, "utf8")
    .update(bytes)
    .digest("hex");
  if (observedObjectId !== expectedObjectId) {
    throw new GitHubPublicSourceError(errorCode, `Git ${type} bytes did not match the exact object id`);
  }
}


function protocolError(message) {
  throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", message);
}
export function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
