# Programmable agent skills

Programmable publishes one canonical Agent Skills package for designing and reviewing open-ended Uniswap v4 projects. The
package follows the open [Agent Skills specification](https://agentskills.io/specification), so compatible agents can
load the same instructions, references, templates, and validation tools without separate prompts for each product.

## Available skill

### Programmable v4 Builder

[`programmable-v4-hook-builder`](programmable-v4-hook-builder/SKILL.md) helps a builder move from an idea or partial
prototype to a review-ready Programmable submission. It supports standard-fee-hook launches, custom hooks, games,
interfaces, services, keepers, indexers and unfamiliar architectures. A no-hook idea remains proposal-eligible but
cannot claim launch readiness until the mandatory fee is integrated. It runs compatibility
preflight before implementation, makes trust and value flow explicit, derives hook permissions only when a hook is
actually needed, and defines the evidence expected for the project's risk level. The package identifier keeps its
original name for installation compatibility; the product name is Programmable v4 Builder.

The skill can prepare and validate a public proposal or prototype. It cannot assign candidate status, approve a model,
perform an audit, obtain routing support or make a model available on Programmable. It does not authorize external
actions. Opening a pull request, signing or deploying a transaction, and publishing a release require separate,
explicit authorization and the applicable release gates. Maintainers may select an exact reviewed prototype as a
candidate.

Read the [builder guide](../docs/builder/AGENT_SKILL.md) before using it on production code.

## Quick install

Install interactively with one command:

```bash
gh skill install 0xprogrammable/programmable
```

To preselect the Builder while keeping the agent setup interactive:

```bash
gh skill install 0xprogrammable/programmable programmable-v4-hook-builder
```

Without a version argument, `gh skill` selects the repository's latest tagged release. Use the protected-release
instructions below only when a review or organization policy requires an exact version pin.

## Install an exact protected Builder release

Inspect the skill before installing it. The release tag below is protected against update and deletion. A full reviewed
commit SHA remains an equivalent pin when an organization requires commit-only policy.

```bash
gh skill preview 0xprogrammable/programmable \
  programmable-v4-hook-builder@programmable-v4-builder-v0.2.0
```

Install the same revision for one supported host:

```bash
# Codex
gh skill install 0xprogrammable/programmable \
  skills/programmable-v4-hook-builder \
  --agent codex \
  --scope user \
  --pin programmable-v4-builder-v0.2.0

# Claude Code
gh skill install 0xprogrammable/programmable \
  skills/programmable-v4-hook-builder \
  --agent claude-code \
  --scope user \
  --pin programmable-v4-builder-v0.2.0

# GitHub Copilot
gh skill install 0xprogrammable/programmable \
  skills/programmable-v4-hook-builder \
  --agent github-copilot \
  --scope user \
  --pin programmable-v4-builder-v0.2.0
```

The `gh skill` command chooses the host-specific destination. Its skill commands are currently a preview feature, and
host behavior still depends on each agent's sandbox, tool permissions, and Agent Skills implementation. Installation
does not grant wallet access, deployment authority, review approval, or permission to publish external changes.

Builder `v0.1.1` remains available only to reproduce legacy review records. Use `v0.2.0` for new launch applications;
it adds the mandatory Programmable fee policy and evidence gates.

For repository-scoped use, change `--scope user` to `--scope project` only when the generated `.agents/` directory is
intentionally committed or excluded from Git; otherwise it makes the project worktree dirty and blocks `prepare-pr`.
To test an unpublished local checkout, run:

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
