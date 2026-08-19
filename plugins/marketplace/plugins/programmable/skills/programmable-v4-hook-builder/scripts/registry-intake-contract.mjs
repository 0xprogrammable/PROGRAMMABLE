export const SUBMIT_LAUNCH_INTAKE_CONTRACT = Object.freeze({
  schemaVersion: 2,
  repository: Object.freeze({
    owner: "0xprogrammable",
    name: "submit-launch",
    slug: "0xprogrammable/submit-launch",
    numericId: "1320171831",
    defaultBranch: "main",
    intakeDirectory: "submissions",
    intakeStatusPath: "docs/builder/intake-status.json",
    apiUrl: "https://api.github.com/repos/0xprogrammable/submit-launch",
    rawUrl: "https://raw.githubusercontent.com/0xprogrammable/submit-launch",
    url: "https://github.com/0xprogrammable/submit-launch"
  }),
  states: Object.freeze([
    "prelaunch",
    "open",
    "paused-new",
    "paused-all"
  ]),
  draftOnly: true,
  legacyHookbuilder: Object.freeze({
    repository: "0xprogrammable/hookbuilder",
    numericId: "1320085947",
    baseBranch: "main",
    continuingPullRequests: Object.freeze([10, 11, 12, 14, 15, 18, 19, 20])
  })
});

export const SUBMIT_LAUNCH_REPOSITORY = SUBMIT_LAUNCH_INTAKE_CONTRACT.repository.slug;
export const SUBMIT_LAUNCH_REPOSITORY_ID = SUBMIT_LAUNCH_INTAKE_CONTRACT.repository.numericId;
export const SUBMIT_LAUNCH_REPOSITORY_NAME = SUBMIT_LAUNCH_INTAKE_CONTRACT.repository.name;
export const SUBMIT_LAUNCH_REPOSITORY_OWNER = SUBMIT_LAUNCH_INTAKE_CONTRACT.repository.owner;
export const SUBMIT_LAUNCH_REPOSITORY_URL = SUBMIT_LAUNCH_INTAKE_CONTRACT.repository.url;
export const SUBMIT_LAUNCH_API_URL = SUBMIT_LAUNCH_INTAKE_CONTRACT.repository.apiUrl;
export const SUBMIT_LAUNCH_RAW_URL = SUBMIT_LAUNCH_INTAKE_CONTRACT.repository.rawUrl;
export const SUBMIT_LAUNCH_BASE_BRANCH = SUBMIT_LAUNCH_INTAKE_CONTRACT.repository.defaultBranch;
export const SUBMIT_LAUNCH_INTAKE_DIRECTORY = SUBMIT_LAUNCH_INTAKE_CONTRACT.repository.intakeDirectory;
export const SUBMIT_LAUNCH_INTAKE_STATUS_PATH = SUBMIT_LAUNCH_INTAKE_CONTRACT.repository.intakeStatusPath;
export const SUBMIT_LAUNCH_INTAKE_SCHEMA_VERSION = SUBMIT_LAUNCH_INTAKE_CONTRACT.schemaVersion;
export const SUBMIT_LAUNCH_INTAKE_STATES = SUBMIT_LAUNCH_INTAKE_CONTRACT.states;
export const HOOKBUILDER_LEGACY_APPLICANT_PULL_REQUESTS =
  SUBMIT_LAUNCH_INTAKE_CONTRACT.legacyHookbuilder.continuingPullRequests;
export const HOOKBUILDER_LEGACY_APPLICANT_BASE_BRANCH =
  SUBMIT_LAUNCH_INTAKE_CONTRACT.legacyHookbuilder.baseBranch;

// Compatibility names retained for discovery callers. The repository was
// renamed in place, so its immutable numeric identity did not change.
export const PROGRAMMABLE_REGISTRY_REPOSITORY = SUBMIT_LAUNCH_REPOSITORY;
export const PROGRAMMABLE_REGISTRY_DEFAULT_BRANCH = SUBMIT_LAUNCH_BASE_BRANCH;
export const PROGRAMMABLE_REGISTRY_INTAKE_DIRECTORY = SUBMIT_LAUNCH_INTAKE_DIRECTORY;
export const PROGRAMMABLE_REGISTRY_INTAKE_STATES = SUBMIT_LAUNCH_INTAKE_STATES;

const intakeStates = new Set(SUBMIT_LAUNCH_INTAKE_STATES);
const legacyHookbuilderPulls = new Set(HOOKBUILDER_LEGACY_APPLICANT_PULL_REQUESTS);

export function isSubmitLaunchActiveIntake(value) {
  return isActiveIntakeForRepository(value, SUBMIT_LAUNCH_REPOSITORY);
}

export function isActiveIntakeForRepository(value, repository) {
  return isPlainObject(value)
    && hasExactKeys(value, ["baseBranch", "directory", "repository", "state"])
    && value.baseBranch === SUBMIT_LAUNCH_BASE_BRANCH
    && value.directory === SUBMIT_LAUNCH_INTAKE_DIRECTORY
    && value.repository === repository
    && intakeStates.has(value.state);
}

export function isProgrammableRegistryActiveIntake(value, repository = SUBMIT_LAUNCH_REPOSITORY) {
  return isActiveIntakeForRepository(value, repository);
}

export function isSubmitLaunchIntakeStatusDocument(value) {
  return isPlainObject(value)
    && hasExactKeys(value, ["continuingPullRequests", "schemaVersion", "state"])
    && value.schemaVersion === SUBMIT_LAUNCH_INTAKE_SCHEMA_VERSION
    && intakeStates.has(value.state)
    && Array.isArray(value.continuingPullRequests)
    && value.continuingPullRequests.length <= 32;
}

export function isHookbuilderLegacyApplicantPullRequest(value) {
  return Number.isSafeInteger(value) && legacyHookbuilderPulls.has(value);
}

export function classifyHookbuilderApplicantPullRequest({ event, pullRequest, requestPaths, baseRef }) {
  if (event !== "pull_request" || !Array.isArray(requestPaths) || requestPaths.length === 0) {
    return "not-applicant-pull-request";
  }
  if (baseRef !== HOOKBUILDER_LEGACY_APPLICANT_BASE_BRANCH) {
    return "hookbuilder-base-invalid";
  }
  return isHookbuilderLegacyApplicantPullRequest(pullRequest)
    ? "legacy-continuation"
    : "submit-launch-required";
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}
