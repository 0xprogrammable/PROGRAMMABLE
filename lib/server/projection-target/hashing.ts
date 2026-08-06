import { createHash } from "node:crypto";

import { canonicalizeJson } from "./canonical-json";

export type Sha256Digest = `sha256:${string}`;

export function canonicalSha256(
  domain: string,
  value: unknown,
): Sha256Digest {
  if (!/^programmable\.[a-z0-9.-]+\.v[1-9][0-9]*$/.test(domain)) {
    throw new TypeError(
      "Hash domain must be a versioned Programmable namespace",
    );
  }

  const hash = createHash("sha256");
  hash.update(domain, "utf8");
  hash.update(Uint8Array.of(0));
  hash.update(canonicalizeJson(value), "utf8");
  return `sha256:${hash.digest("hex")}`;
}
