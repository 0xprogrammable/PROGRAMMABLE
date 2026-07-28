export function deepReleaseSourceTargets(release, deployedFields) {
  const targets = deployedFields.map((field) => ({
    field,
    address: release.addresses[field],
  }));
  if (release.lifecycleEvidence?.status === "verified-current-release") {
    targets.push({
      field: "keeperExecutor",
      address: release.lifecycleEvidence.keeperExecutor,
    });
  }
  return targets;
}
