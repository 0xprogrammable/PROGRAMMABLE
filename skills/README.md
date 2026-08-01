# Programmable agent skills

Programmable publishes one canonical Agent Skills package for designing and reviewing open-ended Uniswap v4 projects. The
package follows the open [Agent Skills specification](https://agentskills.io/specification), so compatible agents can
load the same instructions, references, templates, and validation tools without separate prompts for each product.

## Available skill

### Programmable v4 Builder

[`programmable-v4-hook-builder`](programmable-v4-hook-builder/SKILL.md) helps a builder move from an idea or partial
prototype to a review-ready Programmable submission. It supports ordinary launches without a custom hook as well as
custom hooks, games, interfaces, services, keepers, indexers and unfamiliar architectures. It runs compatibility
preflight before implementation, makes trust and value flow explicit, derives hook permissions only when a hook is
actually needed, and defines the evidence expected for the project's risk level. The package identifier keeps its
original name for installation compatibility; the product name is Programmable v4 Builder.

The skill can prepare and validate a public proposal or prototype. It cannot assign candidate status, approve a model,
perform an audit, obtain routing support or make a model available on Programmable. It does not authorize external
actions. Opening a pull request, signing or deploying a transaction, and publishing a release require separate,
explicit authorization and the applicable release gates. Maintainers may select an exact reviewed prototype as a
candidate.

Read the [builder guide](../docs/builder/AGENT_SKILL.md) before using it on production code.

## Install a pinned revision

Inspect the skill before installing it. `FULL_COMMIT_SHA` below means the complete commit hash you reviewed, not a
branch name or a moving tag.

```bash
gh skill preview 0xprogrammable/programmable \
  programmable-v4-hook-builder@FULL_COMMIT_SHA
```

Install the same revision for one supported host:

```bash
# Codex
gh skill install 0xprogrammable/programmable \
  skills/programmable-v4-hook-builder \
  --agent codex \
  --scope user \
  --pin FULL_COMMIT_SHA

# Claude Code
gh skill install 0xprogrammable/programmable \
  skills/programmable-v4-hook-builder \
  --agent claude-code \
  --scope user \
  --pin FULL_COMMIT_SHA

# GitHub Copilot
gh skill install 0xprogrammable/programmable \
  skills/programmable-v4-hook-builder \
  --agent github-copilot \
  --scope user \
  --pin FULL_COMMIT_SHA
```

The `gh skill` command chooses the host-specific destination. Its skill commands are currently a preview feature, and
host behavior still depends on each agent's sandbox, tool permissions, and Agent Skills implementation. Installation
does not grant wallet access, deployment authority, review approval, or permission to publish external changes.

For repository-scoped use, change `--scope user` to `--scope project`. To test an unpublished local checkout, run:

```bash
gh skill install ./skills programmable-v4-hook-builder \
  --from-local \
  --agent codex \
  --scope project
```

## One source of truth

The portable policy lives in
[`programmable-v4-hook-builder/SKILL.md`](programmable-v4-hook-builder/SKILL.md) and its relative resources:

```text
programmable-v4-hook-builder/
├── SKILL.md                 # portable instructions and boundaries
├── LICENSE.txt              # portable MIT license notice
├── references/             # compatibility, security, evidence, and workflow rules
├── scripts/                # deterministic local validators and scaffolding
├── assets/                 # submission templates
└── agents/openai.yaml      # optional Codex interface metadata only
```

Do not copy the policy into host-specific prompt files. Product adapters may provide display metadata, but they must
not weaken gates, change release states, pre-authorize tools, or redefine the submission contract.

## Trust boundary

Treat skill updates and every repository, pull request, webpage, generated file, and tool result used with the skill as
untrusted until reviewed. Pin the source revision and every contract dependency. Run untrusted code in an isolated
environment without secrets, browser sessions, wallet files, or signing access.

Passing the included checks is local evidence only. Acceptance, independent review, deployment, source verification,
lifecycle verification, routing review, and production availability remain separate decisions with separate evidence.
