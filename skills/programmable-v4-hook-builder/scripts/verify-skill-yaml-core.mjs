import { parseCanonicalProvenanceScalar } from "./submission-core.mjs";

export function parseCanonicalYamlMapping(source, documentName, shape, { childIndentation = 2 } = {}) {
  const findings = [];
  const result = Object.create(null);
  const seenRootKeys = new Set();
  const seenChildKeys = new Map();
  let activeMapping = null;

  for (const [index, line] of source.split("\n").entries()) {
    const lineNumber = index + 1;
    if (line === "") continue;
    if (line.includes("\t") || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(line)) {
      findings.push(`${documentName}: line ${lineNumber} contains unsupported whitespace or control characters`);
      continue;
    }

    const indentation = line.match(/^ */)[0].length;
    if (indentation !== 0 && indentation !== childIndentation) {
      findings.push(`${documentName}: line ${lineNumber} must use zero or ${childIndentation} spaces of indentation`);
      continue;
    }
    const content = line.slice(indentation);
    const pair = content.match(/^([A-Za-z_][A-Za-z0-9_-]*):(.*)$/);
    if (!pair) {
      findings.push(`${documentName}: line ${lineNumber} is outside the supported YAML mapping subset`);
      continue;
    }

    const [, key, remainder] = pair;
    const parentShape = indentation === 0 ? shape : activeMapping?.field?.fields;
    const parentValue = indentation === 0 ? result : activeMapping?.value;
    const seenKeys = indentation === 0 ? seenRootKeys : seenChildKeys.get(activeMapping?.key);
    if (!parentShape || !parentValue || !seenKeys) {
      findings.push(`${documentName}: line ${lineNumber} has no valid parent mapping`);
      continue;
    }
    if (seenKeys.has(key)) {
      findings.push(`${documentName}: line ${lineNumber} duplicates key ${key}`);
      continue;
    }
    seenKeys.add(key);

    if (!Object.hasOwn(parentShape, key)) {
      findings.push(`${documentName}: line ${lineNumber} contains unsupported key ${key}`);
      continue;
    }
    const field = parentShape[key];

    if (field.type === "mapping") {
      if (indentation !== 0 || remainder !== "") {
        findings.push(`${documentName}: line ${lineNumber} requires ${key} to be a block mapping`);
        continue;
      }
      const value = Object.create(null);
      parentValue[key] = value;
      seenChildKeys.set(key, new Set());
      activeMapping = { key, field, value };
      continue;
    }

    if (!remainder.startsWith(" ") || remainder.length === 1 || remainder !== ` ${remainder.slice(1).trim()}`) {
      findings.push(`${documentName}: line ${lineNumber} requires one scalar value after ${key}:`);
      continue;
    }
    const scalar = parseCanonicalYamlString(remainder.slice(1), field.type);
    if (!scalar.ok) {
      findings.push(`${documentName}: line ${lineNumber} ${scalar.error}`);
      continue;
    }
    parentValue[key] = scalar.value;
    if (indentation === 0) activeMapping = null;
  }

  for (const [key, field] of Object.entries(shape)) {
    if (field.required && !Object.hasOwn(result, key)) {
      findings.push(`${documentName}: missing required key ${key}`);
    }
    if (field.type !== "mapping" || !Object.hasOwn(result, key)) continue;
    if (Object.keys(result[key]).length === 0) {
      findings.push(`${documentName}: mapping ${key} may not be empty`);
    }
    for (const [childKey, childField] of Object.entries(field.fields)) {
      if (childField.required && !Object.hasOwn(result[key], childKey)) {
        findings.push(`${documentName}: missing required key ${key}.${childKey}`);
      }
    }
  }

  return { value: result, errors: findings };
}

export function markdownHeadingAnchors(source) {
  const anchors = new Set();
  const occurrences = new Map();
  for (const line of source.split("\n")) {
    const heading = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/u.exec(line)?.[1];
    if (!heading) continue;
    const base = stripMarkdownHtmlTags(heading)
      .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
      .replace(/[`*_~]/gu, "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .trim()
      .replace(/\s+/gu, "-");
    if (!base) continue;
    const count = occurrences.get(base) ?? 0;
    occurrences.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  return anchors;
}

function stripMarkdownHtmlTags(source) {
  let output = "";
  let pendingTag = "";
  let tagDepth = 0;
  for (const character of source) {
    if (character === "<") {
      pendingTag += character;
      tagDepth += 1;
    } else if (tagDepth > 0) {
      pendingTag += character;
      if (character === ">") {
        tagDepth -= 1;
        if (tagDepth === 0) pendingTag = "";
      }
    } else {
      output += character;
    }
  }
  return tagDepth === 0 ? output : `${output}${pendingTag}`;
}

export function redactInstalledLocalPathForPortableScan(source, parsedFrontmatter) {
  if (
    !parsedFrontmatter
    || parsedFrontmatter.errors.length > 0
    || !Object.hasOwn(parsedFrontmatter.value, "metadata")
    || !Object.hasOwn(parsedFrontmatter.value.metadata, "local-path")
  ) {
    return source;
  }
  const block = source.match(/^---\n[\s\S]*?\n---\n/);
  if (!block) return source;
  const redactedBlock = block[0].replace(
    /^ {4}local-path:.*$/mu,
    "    local-path: installed-provenance"
  );
  return `${redactedBlock}${source.slice(block[0].length)}`;
}

function parseCanonicalYamlString(source, type) {
  if (type === "provenance-string") return parseCanonicalProvenanceScalar(source);
  if (source.startsWith('"')) {
    try {
      const value = JSON.parse(source);
      if (typeof value !== "string") return { ok: false, error: "requires a string value" };
      if (value.length === 0) return { ok: false, error: "requires a non-empty string value" };
      return { ok: true, value };
    } catch {
      return { ok: false, error: "contains an invalid double-quoted string" };
    }
  }
  if (type === "quoted-string") {
    return { ok: false, error: "requires a double-quoted string value" };
  }
  if (
    !/^[A-Za-z]/.test(source)
    || /^(?:null|true|false|yes|no|on|off)$/i.test(source)
    || /[\[\]{}]/.test(source)
    || /(?:^|\s)[!&*|>@`]/.test(source)
    || /(?:^|\s)#/.test(source)
    || /:\s|:$/.test(source)
  ) {
    return { ok: false, error: "contains a non-canonical plain string" };
  }
  return { ok: true, value: source };
}
