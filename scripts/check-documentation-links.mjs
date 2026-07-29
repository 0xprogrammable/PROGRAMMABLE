#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const excludedDirectories = new Set([".git", "cache", "lib", "out"]);
const errors = [];

for (const documentPath of findMarkdown(root)) {
  const source = fs.readFileSync(documentPath, "utf8");
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
      errors.push(`${relative(documentPath)}: invalid encoded path ${target}`);
      continue;
    }

    const absoluteTarget = path.resolve(path.dirname(documentPath), decodedPath);
    if (
      (absoluteTarget !== root && !absoluteTarget.startsWith(`${root}${path.sep}`)) ||
      !fs.existsSync(absoluteTarget)
    ) {
      errors.push(`${relative(documentPath)}: missing ${target}`);
    }
  }
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Verified repository-relative documentation links.");

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

function relative(absolutePath) {
  return path.relative(root, absolutePath).replaceAll(path.sep, "/");
}
