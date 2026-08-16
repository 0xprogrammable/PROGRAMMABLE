import fs from "node:fs";
import path from "node:path";

export function createPortableFilesystem(skillRoot) {
  function relative(target) {
    return path.relative(skillRoot, target).replaceAll(path.sep, "/");
  }

  function read(relativePath) {
    return fs.readFileSync(path.join(skillRoot, relativePath), "utf8");
  }

  function walk(directory) {
    const directoryStat = lstatOrNull(directory);
    if (!directoryStat || !directoryStat.isDirectory() || directoryStat.isSymbolicLink()) return [];
    const entries = [];
    for (const name of fs.readdirSync(directory)) {
      const target = path.join(directory, name);
      const stat = fs.lstatSync(target);
      entries.push({ path: target, stat });
      if (
        stat.isDirectory()
        && !stat.isSymbolicLink()
        && !isForbiddenPortableDirectory(relative(target))
      ) entries.push(...walk(target));
    }
    return entries;
  }

  return { read, relative, walk };
}

export function isForbiddenPortableDirectory(relativePath) {
  const fixedNames = new Set([".git", "node_modules", "out", "cache", "broadcast", "coverage"]);
  const segment = relativePath.split("/").at(-1);
  return fixedNames.has(segment) || /^\.[A-Za-z0-9._-]+\.(?:stage|tmp)-[0-9]+$/.test(segment);
}

export function resolveSkillRootWithoutSymlinks(requestedRoot) {
  const trustedContainerInput = path.dirname(path.dirname(requestedRoot));
  const trustedContainerStat = lstatOrNull(trustedContainerInput);
  if (!trustedContainerStat?.isDirectory() || trustedContainerStat.isSymbolicLink()) {
    throw new Error(`skill root container is not a real directory: ${trustedContainerInput}`);
  }
  const trustedContainer = fs.realpathSync(trustedContainerInput);
  const relativeRoot = path.relative(trustedContainerInput, requestedRoot);
  if (
    relativeRoot === ""
    || relativeRoot === ".."
    || relativeRoot.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativeRoot)
  ) {
    throw new Error(`skill root is not inside its trusted container: ${requestedRoot}`);
  }

  const segments = relativeRoot.split(path.sep);
  let current = trustedContainer;
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    const stat = lstatOrNull(current);
    const displayPath = segments.slice(0, index + 1).join("/");
    if (!stat) throw new Error(`skill root is not a directory: ${requestedRoot}`);
    if (stat.isSymbolicLink()) {
      if (index === segments.length - 1) throw new Error(`skill root may not be a symbolic link: ${requestedRoot}`);
      throw new Error(`skill root path contains a symbolic link: ${displayPath}`);
    }
    if (!stat.isDirectory()) throw new Error(`skill root path component is not a directory: ${displayPath}`);
  }
  return current;
}

export function isInside(parent, child) {
  const result = path.relative(parent, child);
  return result === ""
    || (result !== ".." && !result.startsWith(`..${path.sep}`) && !path.isAbsolute(result));
}

function lstatOrNull(target) {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
    throw error;
  }
}
