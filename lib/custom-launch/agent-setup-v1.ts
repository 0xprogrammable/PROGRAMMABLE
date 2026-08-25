export const PROGRAMMABLE_AGENT_SETUP_LINKS_V1 = Object.freeze({
  cli: "https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v1.0.1/programmable-launch-1.0.1.tgz",
  guide: "https://programmable.market/docs/developers/custom-launch",
  openApi: "https://programmable.market/openapi/custom-launch-v1.json",
  openApiV2ReleaseCandidate:
    "https://programmable.market/openapi/custom-launch-v2.json",
  cliV2ReleaseCandidate:
    "https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v2.0.0-rc.1/programmable-launch-2.0.0-rc.1.tgz",
});

export const PROGRAMMABLE_AGENT_SETUP_TEXT_V1 = Object.freeze([
  "Programmable Custom Launch agent setup",
  "",
  "Use the preconfigured $PROGRAMMABLE_API_KEY from encrypted secrets or the environment. Never paste the key into chat, a prompt, source code, or command history.",
  "",
  `Install: npm install --global ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.cli}`,
  "CLI: programmable-launch --help",
  `Release asset: ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.cli}`,
  `Guide: ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.guide}`,
  `Stable V1 OpenAPI: ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.openApi}`,
  `Held V2 RC OpenAPI: ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.openApiV2ReleaseCandidate}`,
  `Held V2 RC package: ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.cliV2ReleaseCandidate}`,
  "V2 is held for private canary. Its contract and package support offline integration only and do not authorize public submit, wallet signing, or broadcast.",
].join("\n"));
