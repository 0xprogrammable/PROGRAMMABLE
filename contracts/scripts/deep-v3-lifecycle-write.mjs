import {
  access as nodeAccess,
  rename as nodeRename,
  writeFile as nodeWriteFile,
} from "node:fs/promises";

async function atomicWrite(target, contents, fs) {
  const temporary = `${target}.tmp`;
  await fs.writeFile(temporary, contents, { mode: 0o600 });
  await fs.rename(temporary, target);
}

export async function writeDeepV3LifecycleFiles({
  evidencePath,
  manifestPath,
  evidenceOutput,
  manifestOutput,
  fs = {
    access: nodeAccess,
    rename: nodeRename,
    writeFile: nodeWriteFile,
  },
}) {
  try {
    await fs.access(evidencePath);
    throw new Error(
      "Deep V3 lifecycle evidence already exists; overwrite is not permitted",
    );
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await atomicWrite(evidencePath, evidenceOutput, fs);
  try {
    await atomicWrite(manifestPath, manifestOutput, fs);
  } catch (error) {
    const uncommittedEvidence = `${evidencePath}.uncommitted`;
    await fs.rename(evidencePath, uncommittedEvidence);
    throw new Error(
      `Manifest update failed; evidence was preserved at ${uncommittedEvidence}: ${error.message}`,
    );
  }
}
