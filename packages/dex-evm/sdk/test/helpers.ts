import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const PROTOCOL_SNAPSHOT = resolve(
  process.cwd(),
  "../binding/vectors/portable/334bb26703a4dab18ce0fca8485c6275a879933a",
);

export const BINDING_VECTORS = resolve(process.cwd(), "../binding/vectors");

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

export function sha256File(path: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}
