import path from "node:path";
import {
  isSafeGitReference,
  isSupportedGitHubRepositoryUrl
} from "./submission-core.mjs";

export function validateInstalledProvenance(metadata, declaredName) {
  const findings = [];
  const keys = Object.keys(metadata).sort();
  const remoteRequired = ["github-path", "github-ref", "github-repo", "github-tree-sha"];
  const remoteAllowed = [...remoteRequired, "github-pinned"].sort();
  const isLocalProfile = keys.length === 1 && keys[0] === "local-path";
  const isRemoteProfile = keys.every((key) => remoteAllowed.includes(key))
    && remoteRequired.every((key) => keys.includes(key));

  if (!isLocalProfile && !isRemoteProfile) {
    findings.push(
      "SKILL.md frontmatter: installed metadata must be exactly local-path or the GitHub repository, ref, tree and path provenance fields"
    );
    return findings;
  }

  if (isLocalProfile) {
    const localPath = metadata["local-path"];
    findings.push(...validateProvenanceScalar("local-path", localPath, 4096));
    if (!path.posix.isAbsolute(localPath) && !path.win32.isAbsolute(localPath)) {
      findings.push("SKILL.md frontmatter: metadata.local-path must be an absolute filesystem path");
    }
    return findings;
  }

  for (const key of keys) {
    findings.push(...validateProvenanceScalar(key, metadata[key], key === "github-path" ? 1024 : 2048));
  }

  const githubPath = metadata["github-path"];
  const pathSegments = githubPath.split("/");
  if (
    githubPath.startsWith("/")
    || githubPath.endsWith("/")
    || githubPath.includes("\\")
    || pathSegments.some((segment) => segment === "" || segment === "." || segment === "..")
    || pathSegments.at(-1) !== declaredName
  ) {
    findings.push("SKILL.md frontmatter: metadata.github-path must be a normalized relative path ending in the skill name");
  }

  if (!isSupportedGitHubRepositoryUrl(metadata["github-repo"])) {
    findings.push("SKILL.md frontmatter: metadata.github-repo must be a canonical HTTPS GitHub repository URL");
  }
  if (!isSafeGitReference(metadata["github-ref"])) {
    findings.push("SKILL.md frontmatter: metadata.github-ref is not a bounded Git reference");
  }
  if (Object.hasOwn(metadata, "github-pinned") && !isSafeGitReference(metadata["github-pinned"])) {
    findings.push("SKILL.md frontmatter: metadata.github-pinned is not a bounded Git reference");
  }
  if (!/^[0-9a-f]{40}$/.test(metadata["github-tree-sha"])) {
    findings.push("SKILL.md frontmatter: metadata.github-tree-sha must be a lowercase 40-character Git object id");
  }

  return findings;
}

function validateProvenanceScalar(key, value, maximumBytes) {
  const findings = [];
  if (Buffer.byteLength(value, "utf8") > maximumBytes) {
    findings.push(`SKILL.md frontmatter: metadata.${key} exceeds the ${maximumBytes}-byte provenance limit`);
  }
  if (
    /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value)
    || [...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint >= 0xd800 && codePoint <= 0xdfff;
    })
  ) {
    findings.push(`SKILL.md frontmatter: metadata.${key} contains control, bidirectional or invalid Unicode characters`);
  }
  return findings;
}
