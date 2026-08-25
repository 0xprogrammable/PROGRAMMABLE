export const PROGRAMMABLE_AGENT_SETUP_LINKS_V1 = Object.freeze({
  cli: "https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v1.0.0/programmable-launch-1.0.0.tgz",
  guide: "https://programmable.market/docs/developers/custom-launch",
  openApi: "https://programmable.market/openapi/custom-launch-v1.json",
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
  `OpenAPI: ${PROGRAMMABLE_AGENT_SETUP_LINKS_V1.openApi}`,
].join("\n"));
