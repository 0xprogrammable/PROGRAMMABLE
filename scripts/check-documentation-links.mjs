#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const excludedDirectories = new Set([".git", "cache", "lib", "node_modules", "out"]);

export function collectDocumentationLinkErrors(rootDirectory = defaultRoot) {
  const root = path.resolve(rootDirectory);
  const errors = [];
  for (const documentPath of findMarkdown(root)) {
    const source = sourceOutsideCode(fs.readFileSync(documentPath, "utf8"));
    const targets = [
      ...source.matchAll(/!?\[[^\]]*]\(([^)]+)\)/g),
      ...source.matchAll(/\b(?:href|src)="([^"]+)"/g)
    ].map((match) => match[1].trim());

    for (const target of targets) {
      if (
        target.length === 0 ||
        target.startsWith("#") ||
        target.startsWith("http://") ||
        target.startsWith("https://") ||
        target.startsWith("mailto:")
      ) {
        continue;
      }

      const pathOnly = target.split("#", 1)[0].split("?", 1)[0];
      let decodedPath;
      try {
        decodedPath = decodeURIComponent(pathOnly);
      } catch {
        errors.push(`${relative(documentPath, root)}: invalid encoded path ${target}`);
        continue;
      }

      const absoluteTarget = path.resolve(path.dirname(documentPath), decodedPath);
      if (
        (absoluteTarget !== root && !absoluteTarget.startsWith(`${root}${path.sep}`)) ||
        !fs.existsSync(absoluteTarget)
      ) {
        errors.push(`${relative(documentPath, root)}: missing ${target}`);
      }
    }
  }
  return errors;
}

export function sourceOutsideCode(source) {
  let fence = null;
  const outsideFences = source.replace(/[^\r\n]*(?:\r\n|\n|\r|$)/g, (lineWithEnding) => {
    if (lineWithEnding.length === 0) return "";
    const line = lineWithEnding.replace(/[\r\n]+$/, "");
    const lineEnding = lineWithEnding.slice(line.length);
    if (fence) {
      const closing = new RegExp(`^ {0,3}${escapeRegularExpression(fence.marker)}{${fence.length},}[ \\t]*$`);
      if (closing.test(line)) fence = null;
      return lineEnding;
    }

    const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!opening || (opening[1][0] === "`" && opening[2].includes("`"))) return lineWithEnding;
    fence = { marker: opening[1][0], length: opening[1].length };
    return lineEnding;
  });
  return sourceOutsideInlineCodeSpans(outsideFences);
}

function sourceOutsideInlineCodeSpans(source) {
  let cursor = 0;
  let searchFrom = 0;
  let output = "";
  while (searchFrom < source.length) {
    const openingStart = source.indexOf("`", searchFrom);
    if (openingStart === -1) break;
    const openingEnd = endOfBacktickRun(source, openingStart);
    const delimiterLength = openingEnd - openingStart;
    let closingStart = openingEnd;
    while (closingStart < source.length) {
      closingStart = source.indexOf("`", closingStart);
      if (closingStart === -1) break;
      const closingEnd = endOfBacktickRun(source, closingStart);
      if (closingEnd - closingStart === delimiterLength) {
        output += source.slice(cursor, openingStart);
        output += preserveLineEndings(source.slice(openingStart, closingEnd));
        cursor = closingEnd;
        searchFrom = closingEnd;
        break;
      }
      closingStart = closingEnd;
    }
    if (closingStart === -1 || closingStart >= source.length) {
      searchFrom = openingEnd;
    }
  }
  return `${output}${source.slice(cursor)}`;
}

function findMarkdown(directory) {
  const documents = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) {
        documents.push(...findMarkdown(path.join(directory, entry.name)));
      }
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      documents.push(path.join(directory, entry.name));
    }
  }
  return documents;
}

function relative(absolutePath, root) {
  return path.relative(root, absolutePath).replaceAll(path.sep, "/");
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function endOfBacktickRun(source, start) {
  let end = start;
  while (source[end] === "`") end += 1;
  return end;
}

function preserveLineEndings(value) {
  return value.replace(/[^\r\n]/g, " ");
}

function main() {
  const errors = collectDocumentationLinkErrors();
  if (errors.length > 0) {
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log("Verified repository-relative documentation links.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
