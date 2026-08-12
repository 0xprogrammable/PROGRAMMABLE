import fs from "node:fs";
import path from "node:path";

const PROPOSAL_PLACEHOLDER_PATTERN = /^(?:unresolved|unknown|tbd|todo|to be determined|not decided)(?:\s*[:.!-].*)?$/iu;
const PROPOSAL_INSTRUCTION_PATTERN = /^describe\b/iu;
const PROPOSAL_DOCUMENTS = ["PROPOSAL.md", "THREAT_MODEL.md", "TEST_PLAN.md", "EVIDENCE.md"];
const PROPOSAL_PLACEHOLDER_SENTINELS = [
  "Describe the model in one concrete sentence before implementation begins.",
  "| Outcome | What a creator launches and what traders and LPs experience |",
  "| Authorities | Every mutable capability and controller |",
  "| Failure | Revert, retry, fallback, unwind, migration, or retirement |",
  "Explain why the project uses Uniswap v4. State `hook.used` explicitly."
];

export function createProposalReadinessValidator({ skillRoot, submissionTemplate }) {
  function proposalReadinessErrors({ submission: value, packageRoot: root }) {
    const readinessErrors = [];
    const add = (message) => readinessErrors.push(`proposal readiness: ${message}`);

    if (![value.model?.summary, value.model?.userOutcome, value.model?.whyV4]
      .every((entry) => concreteProposalNarrative(entry, { minimumLength: 24, rejectInstruction: true }))) {
      add("replace the scaffold idea with project-specific model.summary, model.userOutcome and model.whyV4 statements");
    }

    const architectureReady = [value.pool?.currency0, value.pool?.currency1]
      .every(concreteProposalLabel)
      && typeof value.pool?.canonical === "boolean"
      && Number.isInteger(value.pool?.tickSpacing)
      && ["static", "dynamic"].includes(value.pool?.lpFee?.mode)
      && typeof value.hook?.used === "boolean";
    if (!architectureReady) {
      add("fix the base architecture before applying: name both pool assets, the canonical-pool policy, tick spacing, LP-fee mode and whether a custom hook is used");
    }

    if (!completeProposalLifecycle(value.launchLifecycle)) {
      add("complete every lifecycle phase with actor, value flow, custody, failure and event, or a concrete not-applicable reason");
    }

    if (!completeProposalValueFlows(value.valueFlows)) {
      add("document at least one complete value flow with its action, asset, source, destination, amount rule, settlement and failure behavior");
    }

    if (!completeProposalAuthorities(value)) {
      add("list every authority with its controller, capabilities, mutability, delay and user-exit impact, or explicitly document why the design has no mutable authority");
    }

    if (!concreteProposalNarrative(value.operations?.incidentResponse, { minimumLength: 24 })) {
      add("state a concrete incident and failure response instead of leaving the recovery path open");
    }

    if (!specificOpenArchitectureQuestions(value.unresolved)) {
      add("replace scaffold open decisions with specific named architecture questions ending in '?', or use an empty list when none remain");
    }

    for (const documentName of PROPOSAL_DOCUMENTS) {
      const documentPath = path.join(root, documentName);
      if (!fs.existsSync(documentPath) || !fs.statSync(documentPath).isFile()) continue;
      const contents = fs.readFileSync(documentPath, "utf8");
      const template = renderedProposalTemplate(documentName, value.model);
      if (substantiallyMatchesScaffold(contents, template)) {
        add(`${documentName} is still substantially the generated scaffold; replace its instructions with project-specific content`);
        continue;
      }
      if (documentName === "PROPOSAL.md" && PROPOSAL_PLACEHOLDER_SENTINELS.some((sentinel) => contents.includes(sentinel))) {
        add("PROPOSAL.md still contains generated design-card or architecture placeholders");
      }
    }

    return [...new Set(readinessErrors)];
  }

  function completeProposalLifecycle(lifecycle) {
    const phases = Object.values(lifecycle ?? {});
    if (phases.length === 0) return false;
    return phases.every((phase) => {
      if (phase?.applicable === true) {
        return [phase.actor, phase.valueFlow, phase.custody, phase.failure, phase.event]
          .every((entry) => concreteProposalNarrative(entry));
      }
      if (phase?.applicable === false) {
        return concreteProposalNarrative(phase.notApplicableReason);
      }
      return false;
    });
  }

  function completeProposalValueFlows(valueFlows) {
    if (!Array.isArray(valueFlows) || valueFlows.length === 0) return false;
    return valueFlows.every((flow) => [flow?.id, flow?.action, flow?.asset, flow?.from, flow?.to]
      .every(concreteProposalLabel)
      && [flow?.amountRule, flow?.settlement, flow?.failure]
        .every((entry) => concreteProposalNarrative(entry)));
  }

  function completeProposalAuthorities(value) {
    const authorities = Array.isArray(value.authorities) ? value.authorities : [];
    if (authorities.length > 0) {
      return authorities.every((authority) => concreteProposalLabel(authority?.role)
        && concreteProposalLabel(authority?.controller)
        && Array.isArray(authority?.capabilities)
        && authority.capabilities.length > 0
        && authority.capabilities.every(concreteProposalLabel)
        && typeof authority?.mutable === "boolean"
        && concreteProposalLabel(authority?.delay)
        && concreteProposalNarrative(authority?.userExitImpact));
    }

    const noAuthorityEvidence = [
      value.risk?.rationales?.upgradeability,
      value.risk?.rationales?.autonomy,
      value.operations?.incidentResponse,
      ...(Array.isArray(value.disclosures) ? value.disclosures : [])
    ];
    return noAuthorityEvidence.some((entry) => concreteProposalNarrative(entry)
      && explicitNoAuthorityStatement(entry));
  }

  function explicitNoAuthorityStatement(value) {
    const normalized = value.trim();
    return /\b(?:no|without)\b.{0,120}\b(?:admin(?:istrator)?|authorit(?:y|ies)|controller|governance|keeper|multisig|operator|oracle|owner|pause|privileged role|proxy|redirect|rescue|signer|upgrade)\b/iu.test(normalized)
      || /\bimmutable\b.{0,120}\b(?:admin(?:istrator)?|authorit(?:y|ies)|controller|governance|keeper|multisig|operator|oracle|owner|pause|privileged role|proxy|redirect|rescue|signer|upgrade)\b/iu.test(normalized);
  }

  function specificOpenArchitectureQuestions(unresolved) {
    if (!Array.isArray(unresolved)) return false;
    const scaffoldQuestions = new Set((submissionTemplate.unresolved ?? []).map(normalizeProposalText));
    return unresolved.every((entry) => concreteProposalNarrative(entry, { minimumLength: 24 })
      && entry.trim().endsWith("?")
      && !scaffoldQuestions.has(normalizeProposalText(entry)));
  }

  function concreteProposalLabel(value) {
    return typeof value === "string"
      && value.trim().length > 0
      && !PROPOSAL_PLACEHOLDER_PATTERN.test(value);
  }

  function concreteProposalNarrative(value, { minimumLength = 12, rejectInstruction = false } = {}) {
    if (typeof value !== "string") return false;
    const normalized = value.trim();
    if (normalized.length < minimumLength || PROPOSAL_PLACEHOLDER_PATTERN.test(normalized)) return false;
    return !rejectInstruction || !PROPOSAL_INSTRUCTION_PATTERN.test(normalized);
  }

  function renderedProposalTemplate(documentName, model = {}) {
    return fs.readFileSync(path.join(skillRoot, "assets", "templates", documentName), "utf8")
      .replaceAll("{{MODEL_ID}}", model.id ?? "")
      .replaceAll("{{MODEL_NAME}}", model.name ?? "")
      .replaceAll("{{MODEL_SUMMARY}}", "Describe the model in one concrete sentence before implementation begins.");
  }

  function substantiallyMatchesScaffold(contents, template) {
    if (normalizeProposalText(contents) === normalizeProposalText(template)) return true;
    const templateLines = significantProposalLines(template);
    if (templateLines.length === 0) return false;
    const contentLines = new Set(significantProposalLines(contents));
    const retained = templateLines.filter((line) => contentLines.has(line)).length;
    return retained / templateLines.length >= 0.65;
  }

  function significantProposalLines(value) {
    return [...new Set(value.split(/\r?\n/u)
      .map((line) => normalizeProposalText(line))
      .filter((line) => line.length >= 32 && !/^[-|: ]+$/u.test(line)))];
  }

  function normalizeProposalText(value) {
    return String(value).trim().replace(/\s+/gu, " ").toLowerCase();
  }


  return proposalReadinessErrors;
}
