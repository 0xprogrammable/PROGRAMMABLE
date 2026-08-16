import path from "node:path";

export function isExactInstallerProvenance(metadataFields, declaredName) {
  const keys = [...metadataFields.keys()].sort();
  const values = new Map();
  for (const [key, source] of metadataFields) {
    const parsed = parseCanonicalProvenanceScalar(source);
    if (!parsed.ok) return false;
    values.set(key, parsed.value);
  }

  if (keys.length === 1 && keys[0] === "local-path") {
    const localPath = values.get("local-path");
    return isBoundedProvenanceValue(localPath, 4096)
      && (path.posix.isAbsolute(localPath) || path.win32.isAbsolute(localPath));
  }

  const required = ["github-path", "github-ref", "github-repo", "github-tree-sha"];
  const allowed = [...required, "github-pinned"].sort();
  if (!keys.every((key) => allowed.includes(key)) || !required.every((key) => keys.includes(key))) return false;
  if (![...values].every(([key, value]) => isBoundedProvenanceValue(value, key === "github-path" ? 1024 : 2048))) return false;

  const githubPath = values.get("github-path");
  const pathSegments = githubPath.split("/");
  if (
    githubPath.startsWith("/")
    || githubPath.endsWith("/")
    || githubPath.includes("\\")
    || pathSegments.some((segment) => segment === "" || segment === "." || segment === "..")
    || pathSegments.at(-1) !== declaredName
  ) return false;

  return isSupportedGitHubRepositoryUrl(values.get("github-repo"))
    && isSafeGitReference(values.get("github-ref"))
    && (!values.has("github-pinned") || isSafeGitReference(values.get("github-pinned")))
    && /^[0-9a-f]{40}$/u.test(values.get("github-tree-sha"));
}

export function parseCanonicalProvenanceScalar(source) {
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
  if (source.startsWith("'")) {
    if (!source.endsWith("'") || source.length < 2) {
      return { ok: false, error: "contains an invalid single-quoted string" };
    }
    const inner = source.slice(1, -1);
    let value = "";
    for (let index = 0; index < inner.length; index += 1) {
      if (inner[index] !== "'") {
        value += inner[index];
      } else if (inner[index + 1] === "'") {
        value += "'";
        index += 1;
      } else {
        return { ok: false, error: "contains an invalid single-quoted string" };
      }
    }
    if (value.length === 0) return { ok: false, error: "requires a non-empty string value" };
    return { ok: true, value };
  }
  if (
    source.length === 0
    || source !== source.trim()
    || /^(?:null|true|false|yes|no|on|off|~)$/iu.test(source)
    || /^(?:[!&*|>@`]|[-?:]\s)/u.test(source)
    || /[\[\]{}]/u.test(source)
    || /(?:^|\s)#/u.test(source)
    || /:\s|:$/u.test(source)
  ) return { ok: false, error: "contains a non-canonical plain string" };
  return { ok: true, value: source };
}

function isBoundedProvenanceValue(value, maximumBytes) {
  return Buffer.byteLength(value, "utf8") <= maximumBytes
    && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value)
    && ![...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint >= 0xd800 && codePoint <= 0xdfff;
    });
}

export function isSupportedGitHubRepositoryUrl(value) {
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();
    const supportedHost = hostname === "github.com"
      || /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.ghe\.com$/u.test(hostname);
    const segments = parsed.pathname.split("/").filter(Boolean);
    return supportedHost
      && parsed.href === value
      && parsed.protocol === "https:"
      && parsed.username === ""
      && parsed.password === ""
      && parsed.port === ""
      && parsed.search === ""
      && parsed.hash === ""
      && !parsed.pathname.endsWith("/")
      && segments.length === 2
      && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?$/u.test(segments[0])
      && /^[A-Za-z0-9._-]{1,100}$/u.test(segments[1]);
  } catch {
    return false;
  }
}

export function isSafeGitReference(value) {
  if (
    value === "@"
    || value.startsWith("/")
    || value.endsWith("/")
    || value.endsWith(".")
    || value.includes("..")
    || value.includes("//")
    || value.includes("@{")
    || /[\u0000-\u0020\u007f~^:?*[\\\u202a-\u202e\u2066-\u2069]/u.test(value)
  ) return false;
  return value.split("/").every((segment) => segment !== "" && !segment.startsWith(".") && !segment.endsWith(".lock"));
}
