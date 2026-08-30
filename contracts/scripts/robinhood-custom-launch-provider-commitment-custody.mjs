import { constants as fsConstants } from "node:fs";
import { lstat, open, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const ROBINHOOD_PROVIDER_COMMITMENT_RECORD_BASENAMES = Object.freeze([
  "quicknode-hood-explorer-indexer-robinhood-mainnet-rpc-commitment.public-production-2fb6a4e.v1",
  "alchemy-programmable-production-3-robinhood-mainnet-rpc-commitment.public-production-2fb6a4e.v1",
]);

export const RETIRED_ROBINHOOD_QUICKNODE_COMMITMENT_RECORD_BASENAME =
  "quicknode-hood-explorer-indexer-robinhood-mainnet-rpc-commitment.v1";

const COMMITMENT_PATTERN = /^sha256:[0-9a-f]{64}$/u;

function fail(message) {
  throw new Error(message);
}

function insideOrEqual(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

async function canonicalExistingDirectory(candidate, label) {
  const resolved = path.resolve(candidate);
  const [linked, physical, metadata] = await Promise.all([
    lstat(resolved),
    realpath(resolved),
    stat(resolved),
  ]);
  if (
    physical !== resolved ||
    linked.isSymbolicLink() ||
    linked.dev !== metadata.dev ||
    linked.ino !== metadata.ino ||
    !metadata.isDirectory() ||
    metadata.nlink < 1
  ) {
    fail(`${label} must be an absolute real directory`);
  }
  return { path: physical, metadata };
}

async function canonicalTemporaryRoots() {
  const candidates = new Set([os.tmpdir(), "/tmp", "/private/tmp", "/var/tmp"]);
  return Promise.all(
    [...candidates].map(async (candidate) => {
      try {
        return await realpath(candidate);
      } catch (error) {
        if (error?.code === "ENOENT") return path.resolve(candidate);
        throw error;
      }
    }),
  );
}

async function readProtectedCommitmentRecord({ root, basename, uid }) {
  const candidate = path.join(root, basename);
  let linked;
  try {
    linked = await lstat(candidate);
  } catch (error) {
    if (
      error?.code === "ENOENT" &&
      basename === ROBINHOOD_PROVIDER_COMMITMENT_RECORD_BASENAMES[0]
    ) {
      const retiredPresent = await lstat(
        path.join(root, RETIRED_ROBINHOOD_QUICKNODE_COMMITMENT_RECORD_BASENAME),
      )
        .then(() => true)
        .catch((retiredError) => {
          if (retiredError?.code === "ENOENT") return false;
          throw retiredError;
        });
      if (retiredPresent) {
        fail("retired generic QuickNode commitment record is forbidden");
      }
    }
    throw error;
  }
  if (
    linked.isSymbolicLink() ||
    !linked.isFile() ||
    linked.nlink !== 1 ||
    linked.uid !== uid ||
    (linked.mode & 0o777) !== 0o400 ||
    linked.size !== 72
  ) {
    fail("provider commitment record must be an owner-only 0400 regular file");
  }
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  const handle = await open(candidate, fsConstants.O_RDONLY | noFollow);
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.uid !== uid ||
      (opened.mode & 0o777) !== 0o400 ||
      opened.dev !== linked.dev ||
      opened.ino !== linked.ino ||
      opened.size !== linked.size
    ) {
      fail("provider commitment record changed before protected read");
    }
    const bytes = await handle.readFile();
    const closed = await handle.stat();
    if (
      closed.dev !== opened.dev ||
      closed.ino !== opened.ino ||
      closed.size !== opened.size ||
      closed.mtimeMs !== opened.mtimeMs ||
      closed.ctimeMs !== opened.ctimeMs
    ) {
      fail("provider commitment record changed during protected read");
    }
    const text = bytes.toString("utf8");
    const value = text.slice(0, -1);
    if (
      !text.endsWith("\n") ||
      !COMMITMENT_PATTERN.test(value) ||
      bytes.byteLength !== 72
    ) {
      fail("provider commitment record is not one exact SHA-256 commitment");
    }
    return value;
  } finally {
    await handle.close();
  }
}

export async function readReviewedRobinhoodProviderCommitments({
  custodyRoot,
  repositoryRoot,
}) {
  const uid = process.getuid?.();
  if (
    typeof custodyRoot !== "string" ||
    !path.isAbsolute(custodyRoot) ||
    typeof repositoryRoot !== "string" ||
    !path.isAbsolute(repositoryRoot) ||
    !Number.isSafeInteger(uid) ||
    uid < 0
  ) {
    fail("custody root, repository root and current owner identity are required");
  }
  const [custody, repository, temporaryRoots] = await Promise.all([
    canonicalExistingDirectory(custodyRoot, "provider commitment custody root"),
    canonicalExistingDirectory(repositoryRoot, "repository root"),
    canonicalTemporaryRoots(),
  ]);
  if (
    custody.metadata.uid !== uid ||
    (custody.metadata.mode & 0o777) !== 0o700 ||
    insideOrEqual(repository.path, custody.path) ||
    temporaryRoots.some((temporaryRoot) => insideOrEqual(temporaryRoot, custody.path))
  ) {
    fail(
      "provider commitment custody root must be owner-only 0700 and outside the repository and OS temporary roots",
    );
  }
  const values = await Promise.all(
    ROBINHOOD_PROVIDER_COMMITMENT_RECORD_BASENAMES.map((basename) =>
      readProtectedCommitmentRecord({ root: custody.path, basename, uid }),
    ),
  );
  const closing = await stat(custody.path);
  if (
    !closing.isDirectory() ||
    closing.dev !== custody.metadata.dev ||
    closing.ino !== custody.metadata.ino ||
    closing.uid !== custody.metadata.uid ||
    closing.mode !== custody.metadata.mode
  ) {
    fail("provider commitment custody root changed during protected read");
  }
  if (values[0] === values[1]) {
    fail("reviewed provider commitment records must be distinct");
  }
  return Object.freeze(values);
}

export async function resolveReviewedRobinhoodProviderCommitments({
  env,
  repositoryRoot,
}) {
  const direct = [
    env.ROBINHOOD_MAINNET_RPC_COMMITMENT_PRIMARY,
    env.ROBINHOOD_MAINNET_RPC_COMMITMENT_SECONDARY,
  ];
  if (!env.ROBINHOOD_CUSTODY_ROOT) return direct;
  if (direct.some((value) => value !== undefined && value !== "")) {
    fail("custody-root and direct provider commitment inputs cannot be combined");
  }
  return readReviewedRobinhoodProviderCommitments({
    custodyRoot: env.ROBINHOOD_CUSTODY_ROOT,
    repositoryRoot,
  });
}
