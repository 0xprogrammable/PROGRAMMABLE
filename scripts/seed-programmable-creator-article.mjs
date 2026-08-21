import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const address = "0x7987f03462200b3D8A072E02C89A8A41dCB124EE";
const path = new URL("../config/creator-article-programmable-example.v1.json", import.meta.url);
const draft = JSON.parse(await readFile(path, "utf8"));
const canonical = canonicalize(draft);
const contentSha256 = `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
const write = process.argv.includes("--write");

if (!write) {
  console.log(JSON.stringify({
    mode: "dry-run",
    identity: "official-main-token",
    tokenAddress: address,
    contentSha256,
    externalWrite: false,
  }));
  process.exit(0);
}

const origin = required("CREATOR_ARTICLE_ORIGIN");
const accessToken = required("CREATOR_ARTICLE_ACCESS_TOKEN");
const identityToken = required("CREATOR_ARTICLE_IDENTITY_TOKEN");
const expectedEtag = required("CREATOR_ARTICLE_EXPECTED_ETAG");
const target = new URL(`/api/profile/projects/${address}/article`, origin);
if (target.protocol !== "https:" || target.username || target.password) {
  throw new Error("CREATOR_ARTICLE_ORIGIN must be a clean HTTPS origin");
}

const authHeaders = {
  Authorization: `Bearer ${accessToken}`,
  "X-Privy-Identity-Token": identityToken,
};
const response = await fetch(target, {
  method: "PUT",
  headers: {
    ...authHeaders,
    "Content-Type": "application/json",
    ...(expectedEtag === "*"
      ? { "If-None-Match": "*" }
      : { "If-Match": expectedEtag }),
  },
  body: JSON.stringify(draft),
});
const body = await response.json().catch(() => null);
if (!response.ok) throw new Error(`Seed rejected with HTTP ${response.status}`);
const etag = response.headers.get("etag");
if (!etag || body?.article?.tokenAddress !== address) {
  throw new Error("Seed publication receipt is invalid");
}

const readback = await fetch(target, {
  headers: { ...authHeaders, Accept: "application/json" },
});
const readbackBody = await readback.json().catch(() => null);
if (!readback.ok
  || readback.headers.get("etag") !== etag
  || readbackBody?.article?.tokenAddress !== address
  || readbackBody?.article?.title !== draft.title) {
  throw new Error("Seed publication readback did not bind the exact article");
}

console.log(JSON.stringify({
  mode: "write",
  identity: "official-main-token",
  tokenAddress: address,
  revision: readbackBody.article.revision,
  etag,
  contentSha256,
  readback: "verified",
}));

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function canonicalize(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean"
    || typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  throw new Error("Example article is not canonical JSON");
}
