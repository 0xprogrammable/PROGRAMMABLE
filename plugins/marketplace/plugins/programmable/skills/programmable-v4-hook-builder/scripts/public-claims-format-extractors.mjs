import { parseBoundedStrictJson } from "./strict-json-core.mjs";

export function extractJsonPublicText(source) {
  let value;
  try {
    value = parseBoundedStrictJson(source);
  } catch {
    return "";
  }
  const strings = [];
  const pending = [value];
  while (pending.length > 0) {
    const entry = pending.pop();
    if (typeof entry === "string") {
      strings.push(entry);
      continue;
    }
    if (Array.isArray(entry)) {
      for (let index = entry.length - 1; index >= 0; index -= 1) pending.push(entry[index]);
    } else if (entry && typeof entry === "object") {
      const items = Object.values(entry);
      for (let index = items.length - 1; index >= 0; index -= 1) pending.push(items[index]);
    }
  }
  return strings.join("\n");
}

export function extractYamlPublicText(source) {
  const lines = source.split(/\r?\n/u);
  const values = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#") || /^(?:---|\.\.\.)$/u.test(trimmed)) continue;

    const separator = yamlMappingSeparator(line);
    let scalar = separator === -1 ? trimmed.replace(/^-\s+/u, "") : line.slice(separator + 1).trim();
    if (/^[>|][+-]?[0-9]?$/u.test(scalar)) {
      const indentation = leadingWhitespace(line);
      const block = [];
      while (index + 1 < lines.length) {
        const next = lines[index + 1];
        if (next.trim().length > 0 && leadingWhitespace(next) <= indentation) break;
        index += 1;
        if (next.trim().length > 0) block.push(next.trim());
      }
      if (block.length > 0) values.push(block.join(" "));
      continue;
    }
    scalar = stripYamlComment(scalar).trim();
    if (scalar.length === 0 || scalar === "{}" || scalar === "[]") continue;
    values.push(decodeYamlScalar(scalar));
  }
  return values.join("\n");
}

export function extractMarkdownPublicText(source) {
  const frontmatterMatch = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/u);
  const frontmatter = frontmatterMatch ? extractYamlPublicText(frontmatterMatch[1]) : "";
  const body = (frontmatterMatch ? source.slice(frontmatterMatch[0].length) : source)
    .replace(/<!--[^]*?-->/gu, " ")
    .replace(/\{\/\*[^]*?\*\/\}/gu, " ")
    .replace(/^(?: {0,3})(`{3,}|~{3,})[^\n]*\n[^]*?^ {0,3}\1\s*$/gmu, " ")
    .replace(/^ {4}.*$/gmu, " ")
    .replace(/^(?:import|export)\s+[^\n]*$/gmu, " ")
    .replace(/`[^`\n]*`/gu, " ");
  return [frontmatter, body].filter(Boolean).join("\n");
}

export function yamlMappingSeparator(line) {
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote) {
      if (character === quote) {
        if (quote === "'" && line[index + 1] === "'") index += 1;
        else quote = null;
      } else if (quote === '"' && character === "\\") index += 1;
      continue;
    }
    if (character === "'" || character === '"') quote = character;
    else if (character === ":") return index;
  }
  return -1;
}

export function stripYamlComment(value) {
  let quote = null;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote) {
        if (quote === "'" && value[index + 1] === "'") index += 1;
        else quote = null;
      } else if (quote === '"' && character === "\\") index += 1;
      continue;
    }
    if (character === "'" || character === '"') quote = character;
    else if (character === "#" && (index === 0 || /\s/u.test(value[index - 1]))) return value.slice(0, index);
  }
  return value;
}

export function decodeYamlScalar(value) {
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/gu, "'");
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}

export function leadingWhitespace(value) {
  return value.match(/^\s*/u)?.[0].length ?? 0;
}

const RAW_TEXT_TAGS = new Set(["script", "style"]);
const MAX_HTML_TAG_LENGTH = 16 * 1024;
const COMMON_HTML_ENTITIES = Object.freeze({
  "#39": "'",
  amp: "&",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"'
});

function isHtmlSpace(character) {
  return character === " " || character === "\t" || character === "\n" || character === "\f" || character === "\r";
}

function isHtmlNameCharacter(character) {
  if (character === undefined) return false;
  const code = character.charCodeAt(0);
  return (code >= 48 && code <= 57)
    || (code >= 65 && code <= 90)
    || (code >= 97 && code <= 122)
    || character === ":"
    || character === "-";
}

function findHtmlTagEnd(source, startIndex) {
  let quote = null;
  const endLimit = Math.min(source.length, startIndex + MAX_HTML_TAG_LENGTH);
  for (let index = startIndex; index < endLimit; index += 1) {
    const character = source[index];
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') quote = character;
    else if (character === ">") return index;
  }
  return -1;
}

function parseHtmlTagAt(source, startIndex) {
  if (source[startIndex] !== "<") return null;
  let cursor = startIndex + 1;
  const closing = source[cursor] === "/";
  if (closing) cursor += 1;
  const nameStart = cursor;
  while (isHtmlNameCharacter(source[cursor])) cursor += 1;
  if (cursor === nameStart) return null;
  const boundary = source[cursor];
  if (boundary !== undefined && !isHtmlSpace(boundary) && boundary !== "/" && boundary !== ">") return null;
  const endIndex = findHtmlTagEnd(source, cursor);
  if (endIndex === -1) return null;
  let selfClosingCursor = endIndex - 1;
  while (selfClosingCursor > cursor && isHtmlSpace(source[selfClosingCursor])) selfClosingCursor -= 1;
  return Object.freeze({
    closing,
    endIndex,
    name: source.slice(nameStart, cursor).toLowerCase(),
    selfClosing: source[selfClosingCursor] === "/",
    startIndex
  });
}

function findRawTextClosingTag(source, startIndex, tagName) {
  let candidate = source.indexOf("</", startIndex);
  while (candidate !== -1) {
    const candidateName = source.slice(candidate + 2, candidate + 2 + tagName.length);
    const boundary = source[candidate + 2 + tagName.length];
    if (candidateName.toLowerCase() === tagName
      && (boundary === undefined || isHtmlSpace(boundary) || boundary === "/" || boundary === ">")) {
      const parsed = parseHtmlTagAt(source, candidate);
      if (parsed?.closing === true && parsed.name === tagName) return parsed;
    }
    candidate = source.indexOf("</", candidate + 2);
  }
  return null;
}

function partitionHtmlSource(source) {
  const markup = [];
  const scriptBodies = [];
  let cursor = 0;
  while (cursor < source.length) {
    const tagStart = source.indexOf("<", cursor);
    if (tagStart === -1) {
      markup.push(source.slice(cursor));
      break;
    }
    markup.push(source.slice(cursor, tagStart));
    if (source.startsWith("<!--", tagStart)) {
      const commentEnd = source.indexOf("-->", tagStart + 4);
      markup.push(" ");
      cursor = commentEnd === -1 ? source.length : commentEnd + 3;
      continue;
    }
    const openingTag = parseHtmlTagAt(source, tagStart);
    if (openingTag === null) {
      markup.push("<");
      cursor = tagStart + 1;
      continue;
    }
    if (!openingTag.closing && !openingTag.selfClosing && RAW_TEXT_TAGS.has(openingTag.name)) {
      const bodyStart = openingTag.endIndex + 1;
      const closingTag = findRawTextClosingTag(source, bodyStart, openingTag.name);
      const bodyEnd = closingTag?.startIndex ?? source.length;
      if (openingTag.name === "script") scriptBodies.push(source.slice(bodyStart, bodyEnd));
      markup.push(" ");
      cursor = closingTag === null ? source.length : closingTag.endIndex + 1;
      continue;
    }
    markup.push(source.slice(tagStart, openingTag.endIndex + 1));
    cursor = openingTag.endIndex + 1;
  }
  return Object.freeze({ markup: markup.join(""), scriptBodies: Object.freeze(scriptBodies) });
}

export function extractHtmlPublicParts(source) {
  const { markup: withoutCommentsOrCode, scriptBodies } = partitionHtmlSource(source);
  const attributes = [...withoutCommentsOrCode.matchAll(/\b(?:alt|aria-label|content|placeholder|title)\s*=\s*(["'])(.*?)\1/giu)]
    .map((match) => decodeCommonEntities(match[2]));
  const visible = decodeCommonEntities(withoutCommentsOrCode.replace(/<[^>]*>/gu, " "));
  return Object.freeze({ scriptBodies, text: [...attributes, visible].filter(Boolean).join("\n") });
}

export function extractHtmlPublicText(source) {
  return extractHtmlPublicParts(source).text;
}

export function decodeCommonEntities(value) {
  return value.replace(/&(?:nbsp|amp|lt|gt|quot|#39);/giu, (entity) => (
    COMMON_HTML_ENTITIES[entity.slice(1, -1).toLowerCase()]
  ));
}
