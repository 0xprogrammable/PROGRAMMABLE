#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const APP_IMAGE = "registry.fly.io/programmable-custom-launch-api";

function integer(value) {
  if (Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^[1-9][0-9]*$/u.test(value)) return Number(value);
  return Number.NaN;
}

function field(value, ...names) {
  for (const name of names) {
    if (value?.[name] !== undefined) return value[name];
  }
  return undefined;
}

function exactReleaseImageRef(imageRef, expectedImageTag, expectedImageDigest) {
  const tagOnly = `${APP_IMAGE}:${expectedImageTag}`;
  return imageRef === tagOnly || imageRef === `${tagOnly}@${expectedImageDigest}`;
}

export function verifyCustomLaunchApiFlyRelease(input) {
  if (!Number.isSafeInteger(input.expectedReleaseVersion)
    || !SHA256.test(input.expectedImageDigest ?? "")
    || !/^main-[0-9a-f]{12}$/u.test(input.expectedImageTag ?? "")
    || !Number.isSafeInteger(input.expectedMachineCount)) {
    throw new Error("expected Fly release identity is invalid");
  }
  const releases = Array.isArray(input.releases) ? input.releases : input.releases?.releases;
  const machines = Array.isArray(input.machines) ? input.machines : input.machines?.machines;
  const images = Array.isArray(input.images) ? input.images : input.images?.images;
  if (!Array.isArray(releases) || !Array.isArray(machines) || !Array.isArray(images)) {
    throw new Error("Fly readback JSON shape is invalid");
  }
  const release = releases.find((entry) =>
    integer(field(entry, "Version", "version")) === input.expectedReleaseVersion);
  if (release === undefined) throw new Error("expected Fly release version is not visible");
  const releaseStatus = String(field(release, "Status", "status") ?? "").toLowerCase();
  if (!new Set(["complete", "completed", "succeeded", "successful"]).has(releaseStatus)) {
    throw new Error("expected Fly release is not successful");
  }
  const releaseImage = field(release, "ImageRef", "image_ref", "image");
  if (typeof releaseImage !== "string" || !exactReleaseImageRef(
    releaseImage,
    input.expectedImageTag,
    input.expectedImageDigest,
  )) throw new Error("expected Fly release image differs from the release binding");
  if (machines.length !== input.expectedMachineCount) {
    throw new Error("Fly machine count differs from the release binding");
  }
  const machineIds = machines.map((machine) => field(machine, "id", "ID"));
  const shownImageIds = images.map((image) => field(image, "MachineID", "machine_id"));
  if (machineIds.some((id) => typeof id !== "string" || id.length < 1)
    || shownImageIds.some((id) => typeof id !== "string" || id.length < 1)
    || new Set(machineIds).size !== machineIds.length
    || new Set(shownImageIds).size !== shownImageIds.length
    || images.length !== machines.length
    || machineIds.some((id) => !shownImageIds.includes(id))) {
    throw new Error("Fly machine and image readbacks do not have the same exact identities");
  }
  const imageByMachine = new Map(images.map((image) => [
    field(image, "MachineID", "machine_id"), image,
  ]));
  const machineEvidence = machines.map((machine) => {
    const id = field(machine, "id", "ID");
    const state = String(field(machine, "state", "State") ?? "").toLowerCase();
    const region = field(machine, "region", "Region");
    const hostStatus = field(machine, "host_status", "HostStatus");
    const imageRef = field(machine, "image_ref", "ImageRef") ?? {};
    const shownImage = imageByMachine.get(id);
    const machineRegistry = field(imageRef, "registry", "Registry");
    const machineRepository = field(imageRef, "repository", "Repository");
    const machineTag = field(imageRef, "tag", "Tag");
    const machineDigest = field(imageRef, "digest", "Digest");
    const shownRegistry = field(shownImage, "Registry", "registry");
    const shownRepository = field(shownImage, "Repository", "repository");
    const shownTag = field(shownImage, "Tag", "tag");
    const shownDigest = field(shownImage, "Digest", "digest");
    if (typeof id !== "string" || id.length < 1
      || state !== "started"
      || region !== "fra"
      || (hostStatus !== undefined && hostStatus !== "ok")
      || shownImage === undefined
      || shownRegistry !== "registry.fly.io"
      || shownRepository !== "programmable-custom-launch-api"
      || shownTag !== input.expectedImageTag
      || shownDigest !== input.expectedImageDigest
      || (machineRegistry !== undefined && machineRegistry !== shownRegistry)
      || (machineRepository !== undefined && machineRepository !== shownRepository)
      || (machineTag !== undefined && machineTag !== shownTag)
      || (machineDigest !== undefined && machineDigest !== shownDigest)) {
      throw new Error("a Fly machine differs from the exact release binding");
    }
    return Object.freeze({ id, state, region, imageDigest: input.expectedImageDigest });
  });
  return Object.freeze({
    schemaVersion: "programmable.custom-launch-api-fly-readback.v1",
    status: "passed",
    app: "programmable-custom-launch-api",
    releaseVersion: input.expectedReleaseVersion,
    imageDigest: input.expectedImageDigest,
    imageTag: input.expectedImageTag,
    machines: Object.freeze(machineEvidence),
    observedAt: new Date().toISOString().replace(/\.\d{3}Z$/u, "Z"),
  });
}

export function deriveCustomLaunchApiFlyReleaseIdentity(input) {
  if (!/^main-[0-9a-f]{12}$/u.test(input.expectedImageTag ?? "")) {
    throw new Error("expected Fly image tag is invalid");
  }
  const releases = Array.isArray(input.releases) ? input.releases : input.releases?.releases;
  const machines = Array.isArray(input.machines) ? input.machines : input.machines?.machines;
  const images = Array.isArray(input.images) ? input.images : input.images?.images;
  if (!Array.isArray(releases) || !Array.isArray(machines) || !Array.isArray(images)
    || machines.length < 1 || machines.length > 8) {
    throw new Error("Fly readback JSON shape is invalid");
  }
  const versions = releases.map((release) => integer(field(release, "Version", "version")));
  if (versions.some((version) => !Number.isSafeInteger(version) || version < 1)
    || new Set(versions).size !== versions.length) {
    throw new Error("Fly release versions are invalid");
  }
  const releaseVersion = Math.max(...versions);
  const imageByMachine = new Map(images.map((image) => [
    field(image, "MachineID", "machine_id"), image,
  ]));
  const digests = new Set(machines.map((machine) => {
    const id = field(machine, "id", "ID");
    const image = imageByMachine.get(id);
    const digest = field(image, "Digest", "digest");
    const tag = field(image, "Tag", "tag");
    const registry = field(image, "Registry", "registry");
    const repository = field(image, "Repository", "repository");
    if (typeof id !== "string" || id.length < 1 || image === undefined
      || registry !== "registry.fly.io"
      || repository !== "programmable-custom-launch-api"
      || tag !== input.expectedImageTag
      || !SHA256.test(digest ?? "")) {
      throw new Error("Fly image readback cannot derive one exact release image");
    }
    return digest;
  }));
  if (digests.size !== 1) {
    throw new Error("Fly machines do not share one exact image digest");
  }
  const imageDigest = [...digests][0];
  verifyCustomLaunchApiFlyRelease({
    releases,
    machines,
    images,
    expectedReleaseVersion: releaseVersion,
    expectedImageDigest: imageDigest,
    expectedImageTag: input.expectedImageTag,
    expectedMachineCount: machines.length,
  });
  return Object.freeze({
    releaseVersion,
    imageDigest,
    imageTag: input.expectedImageTag,
    machineCount: machines.length,
  });
}

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("invalid command arguments");
    result[key.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] = value;
  }
  return result;
}

async function main(argv) {
  const args = parseArguments(argv);
  const [releases, machines, images] = await Promise.all([
    readFile(args.releases, "utf8").then(JSON.parse),
    readFile(args.machines, "utf8").then(JSON.parse),
    readFile(args.images, "utf8").then(JSON.parse),
  ]);
  const evidence = verifyCustomLaunchApiFlyRelease({
    releases,
    machines,
    images,
    expectedReleaseVersion: integer(args.expectedReleaseVersion),
    expectedImageDigest: args.expectedImageDigest,
    expectedImageTag: args.expectedImageTag,
    expectedMachineCount: integer(args.expectedMachineCount),
  });
  await writeFile(args.output, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: "utf8", flag: "wx", mode: 0o600,
  });
  process.stdout.write("CUSTOM_LAUNCH_API_FLY_RELEASE_VALID\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
