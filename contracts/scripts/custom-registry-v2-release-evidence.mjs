import { spawn } from "node:child_process";
import {
  closeSync,
  chmodSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  statSync,
} from "node:fs";
import process from "node:process";
import path from "node:path";
import os from "node:os";

export function releaseEvidenceRoot() {
  const configured = process.env.REGISTRY_RELEASE_EVIDENCE_ROOT?.trim();
  if (!configured || !path.isAbsolute(configured)) {
    throw new Error("REGISTRY_RELEASE_EVIDENCE_ROOT must be an absolute path");
  }
  mkdirSync(configured, { recursive: true, mode: 0o700 });
  const real = realpathSync(configured);
  const systemTemporaryRoot = realpathSync(os.tmpdir());
  if (
    real === "/tmp" ||
    real.startsWith("/private/tmp/") ||
    real.startsWith("/tmp/") ||
    real === "/var/tmp" ||
    real.startsWith("/var/tmp/") ||
    real === systemTemporaryRoot ||
    real.startsWith(`${systemTemporaryRoot}${path.sep}`)
  ) {
    throw new Error(
      "release evidence root must not use an OS temporary directory",
    );
  }
  const metadata = statSync(real);
  if (
    !metadata.isDirectory() ||
    (metadata.mode & 0o777) !== 0o700 ||
    metadata.uid !== process.getuid()
  ) {
    throw new Error(
      "release evidence root must be an owner-only 0700 directory",
    );
  }
  return `${real}${path.sep}`;
}

export function assertReleaseEvidencePath(
  candidate,
  { mustExist = true, mode = 0o600 } = {},
) {
  const resolved = path.resolve(candidate);
  const root = releaseEvidenceRoot();
  const parentReal = realpathSync(path.dirname(resolved));
  const canonical = path.join(parentReal, path.basename(resolved));
  if (
    !`${parentReal}${path.sep}`.startsWith(root) ||
    !canonical.startsWith(root)
  ) {
    throw new Error("release evidence path is outside the protected root");
  }
  if (mustExist) {
    const metadata = lstatSync(canonical);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      (metadata.mode & 0o777) !== mode ||
      metadata.uid !== process.getuid()
    ) {
      throw new Error(
        `release evidence file must be a regular ${mode.toString(8)} file`,
      );
    }
  }
  return canonical;
}

export function assertReleaseEvidenceOutput(candidate, { mode = 0o600 } = {}) {
  const resolved = assertReleaseEvidencePath(candidate, { mustExist: false });
  try {
    lstatSync(resolved);
    throw new Error("release evidence output already exists");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return resolved;
}

export function canonicalTransactionJournalPath({ chainId, signer, nonce }) {
  const normalizedSigner = String(signer ?? "").toLowerCase();
  const normalizedNonce = String(nonce ?? "");
  if (
    chainId !== 1 ||
    !/^0x[0-9a-f]{40}$/u.test(normalizedSigner) ||
    !/^(0|[1-9][0-9]*)$/u.test(normalizedNonce) ||
    BigInt(normalizedNonce) >= 1n << 64n
  ) {
    throw new Error("transaction journal chain, signer, or nonce is invalid");
  }
  return path.join(
    releaseEvidenceRoot(),
    `transaction-journal-${chainId}-${normalizedSigner.slice(2)}-${normalizedNonce}.jsonl`,
  );
}

export function assertCanonicalTransactionJournalPath({
  candidate,
  chainId,
  signer,
  nonce,
  mustExist,
}) {
  const actual = assertReleaseEvidencePath(candidate, { mustExist });
  const expected = canonicalTransactionJournalPath({ chainId, signer, nonce });
  if (actual !== expected) {
    throw new Error(
      "release journal must be the canonical signer-and-nonce intent tombstone",
    );
  }
  return actual;
}

export function assertNoExistingTransactionIntent({ chainId, signer, nonce }) {
  const journal = canonicalTransactionJournalPath({ chainId, signer, nonce });
  try {
    lstatSync(journal);
    throw new Error(
      "an existing durable transaction intent blocks this signer and nonce",
    );
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export async function acquireReleaseEvidenceLock(filePath) {
  const canonical = assertReleaseEvidencePath(filePath, { mustExist: false });
  const lockPath = `${canonical}.lock`;
  assertReleaseEvidencePath(lockPath, { mustExist: false });
  try {
    const metadata = lstatSync(lockPath);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.uid !== process.getuid() ||
      (metadata.mode & 0o777) !== 0o600
    ) {
      throw new Error("release evidence lock file is unsafe");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    try {
      closeSync(openSync(lockPath, "wx", 0o600));
    } catch (createError) {
      if (createError?.code !== "EEXIST") throw createError;
    }
  }
  const holderCode = `process.stdin.resume();process.stdin.once("end",()=>process.exit(0));process.stdout.write("LOCKED\\n");setInterval(()=>{},1000);`;
  const executable = process.platform === "darwin" ? "/usr/bin/lockf" : "/usr/bin/flock";
  const args =
    process.platform === "darwin"
      ? ["-t", "0", lockPath, process.execPath, "-e", holderCode]
      : ["-n", "-F", lockPath, process.execPath, "-e", holderCode];
  const attempt = () =>
    new Promise((resolve, reject) => {
      const candidate = spawn(executable, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { PATH: "/usr/bin:/bin" },
      });
      const closed = () => resolve(null);
      candidate.once("error", reject);
      candidate.once("close", closed);
      candidate.stdout.once("data", (bytes) => {
        if (bytes.toString().trim() !== "LOCKED") {
          candidate.kill("SIGTERM");
          reject(new Error("release evidence lock holder did not initialize"));
          return;
        }
        candidate.off("close", closed);
        resolve(candidate);
      });
    });
  let holder = null;
  for (let retry = 0; retry < 10 && holder === null; retry += 1) {
    holder = await attempt();
    if (holder === null && retry < 9) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  if (holder === null) {
    throw new Error("another live release process owns this evidence file");
  }
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    holder.stdin.end();
    holder.kill("SIGTERM");
  };
  process.once("exit", release);
  holder.stdout.unref();
  holder.stderr.unref();
  holder.stdin.unref();
  holder.unref();
  return release;
}
