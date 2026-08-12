import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { analyzePublicClaimSource, extractPublicClaimText, findUnsupportedPublicClaims } from "../public-claims-core.mjs";
import { inspectPublicMetadataText, publicIdentityKey } from "../metadata-core.mjs";

test("unrelated negation does not hide an unsupported provider claim", () => {
  const findings = findUnsupportedPublicClaims("Not a toy; audited by OpenZeppelin.");

  assert.deepEqual(findings, ["OpenZeppelin audit, review or certification"]);
});

test("explicit negative disclosures remain valid while later positive claims are rejected", () => {
  assert.deepEqual(
    findUnsupportedPublicClaims("This model was not audited by OpenZeppelin. Uniswap did not verify or approve it."),
    []
  );
  assert.deepEqual(
    findUnsupportedPublicClaims("Not audited by OpenZeppelin, but officially verified by Uniswap."),
    ["Uniswap verification, approval, certification or official status"]
  );
  assert.deepEqual(
    findUnsupportedPublicClaims("Not audited by OpenZeppelin, but audited by OpenZeppelin for production."),
    ["OpenZeppelin audit, review or certification"]
  );
});

test("factual Uniswap component and source provenance is not treated as endorsement", () => {
  for (const statement of [
    "This model uses the official Uniswap v4 PoolManager deployment.",
    "The PoolManager source is verified on Etherscan and comes from Uniswap v4 core.",
    "This is not Uniswap's official permissioned-pool architecture."
  ]) {
    assert.deepEqual(findUnsupportedPublicClaims(statement), [], statement);
  }
});

test("claims that Uniswap endorsed the submitted model remain rejected", () => {
  for (const statement of [
    "This model is officially verified by Uniswap.",
    "This hook is approved by Uniswap.",
    "Uniswap certified this project.",
    "Uniswap has approved this hook.",
    "This is an official Uniswap launch model.",
    "This is a Uniswap-approved hook.",
    "This hook is Uniswap approved.",
    "Our project received Uniswap approval."
  ]) {
    assert.deepEqual(
      findUnsupportedPublicClaims(statement),
      ["Uniswap verification, approval, certification or official status"],
      statement
    );
  }
});

test("Programmable endorsement claims are rejected without treating factual provenance as approval", () => {
  for (const statement of [
    "This hook is officially approved by Programmable.",
    "Programmable certified this submitted hook.",
    "This is an official Programmable hook builder.",
    "Certified by Programmable.",
    "A Programmable-approved hook."
  ]) {
    assert.deepEqual(
      findUnsupportedPublicClaims(statement),
      ["Programmable verification, approval, certification or official status"],
      statement
    );
  }
  assert.deepEqual(
    findUnsupportedPublicClaims("This package follows the Programmable public builder interface; Programmable did not approve it."),
    []
  );
});

test("unsupported audit, safety, rug-free, deployment and availability claims are rejected", () => {
  const cases = [
    ["This hook has been independently audited.", "Independent audit or certification"],
    ["This hook is guaranteed safe.", "Safety, rug-free or risk-free status"],
    ["The hook is safe.", "Safety, rug-free or risk-free status"],
    ["This hook is unruggable.", "Safety, rug-free or risk-free status"],
    ["This hook is rug-proof.", "Safety, rug-free or risk-free status"],
    ["This hook is deployed and available now.", "Deployment, launch or availability"],
    ["Our application has launched.", "Deployment, launch or availability"],
    ["The contract is deployed.", "Deployment, launch or availability"],
    ["Live on mainnet.", "Deployment, launch or availability"],
    ["Production-ready.", "Deployment, launch or availability"],
    ["Audited by Trail of Bits.", "Independent audit or certification"],
    ["The hook is audited.", "Independent audit or certification"]
  ];
  for (const [statement, label] of cases) {
    assert.deepEqual(findUnsupportedPublicClaims(statement), [label], statement);
  }
});

test("semantic equivalents of forbidden public claims remain rejected", () => {
  const cases = [
    ["This hook cannot rug users.", "Safety, rug-free or risk-free status"],
    ["There is no way to rug users.", "Safety, rug-free or risk-free status"],
    ["This hook is immune to rug pulls.", "Safety, rug-free or risk-free status"],
    ["Uniswap recommends this hook.", "Uniswap verification, approval, certification or official status"],
    ["Uniswap validated this hook.", "Uniswap verification, approval, certification or official status"],
    ["This project is officially recognized by Uniswap.", "Uniswap verification, approval, certification or official status"],
    ["This hook passed a Trail of Bits review.", "Independent audit or certification"],
    ["This hook passed security review.", "Independent audit or certification"],
    ["This contract has no vulnerabilities.", "Safety, rug-free or risk-free status"],
    ["The contract is active on Ethereum mainnet.", "Deployment, launch or availability"],
    ["You can trade it now.", "Deployment, launch or availability"],
    ["The project is mainnet-ready.", "Deployment, launch or availability"]
  ];
  for (const [statement, label] of cases) {
    assert.deepEqual(findUnsupportedPublicClaims(statement), [label], statement);
  }
});

test("common cross-script confusables cannot hide protected claims", () => {
  for (const statement of [
    "This hook is approv\u0435d by Uniswap.",
    "This hook is approved by Un\u0456swap.",
    "This hook is s\u0430fe.",
    "This hook is unrugga\u042cle."
  ]) {
    assert.ok(findUnsupportedPublicClaims(statement).length > 0, statement);
  }
});

test("honest public-beta negations and factual evidence statuses remain valid", () => {
  for (const statement of [
    "This hook is not audited, is not guaranteed safe, and is not deployed.",
    "No Uniswap approval is claimed. No Programmable certification is claimed.",
    "Audit status: not-run. Deployment status: blocked.",
    "Builder unit-test evidence status: passed for the exact source revision.",
    "This evidence does not constitute an audit, launch, or availability claim.",
    "Do not call this hook unruggable.",
    "The word ‘rug-free’ is forbidden in marketing.",
    "A malicious UI could label it rug-free; reviewers must reject that.",
    "The threat model explicitly does not promise a rug-proof design."
  ]) {
    assert.deepEqual(findUnsupportedPublicClaims(statement), [], statement);
  }
});

test("Markdown styling and compatibility Unicode cannot hide an unsupported claim", () => {
  for (const statement of [
    "This hook is **approved** by [Uniswap](https://uniswap.org).",
    "This hook is officially approved\nby Uniswap.",
    "This hook is ｏｆｆｉｃｉａｌｌｙ approved by Ｐｒｏｇｒａｍｍａｂｌｅ.",
    "This hook is officially ap\u200bproved by Uniswap.",
    "This hook is `unruggable`.",
    "This hook is _deployed_ and available now.",
    "This contract is deployed and available now.",
    "This hook passed an independent security audit."
  ]) {
    assert.ok(findUnsupportedPublicClaims(statement).length > 0, statement);
  }
});

test("JavaScript and JSX extraction keeps public strings while ignoring comments", () => {
  const source = `
    // This hook is approved by Uniswap.
    /* This hook is unruggable. */
    export const badge = "This hook is guaranteed safe.";
    export const View = () => <p>This project is live on mainnet.</p>;
  `;
  const publicText = extractPublicClaimText(source, ".tsx");

  assert.doesNotMatch(publicText, /approved by Uniswap/);
  assert.doesNotMatch(publicText, /unruggable/);
  assert.match(publicText, /guaranteed safe/);
  assert.match(publicText, /live on mainnet/);
  assert.deepEqual(findUnsupportedPublicClaims(publicText), [
    "Safety, rug-free or risk-free status",
    "Deployment, launch or availability"
  ]);
});

test("JSX static string expressions are reconstructed with surrounding copy in source order", () => {
  const cases = [
    ["This hook is {'safe'}.", "Safety, rug-free or risk-free status"],
    ["This hook is {'audited'}.", "Independent audit or certification"],
    ["This hook is {'deployed'}.", "Deployment, launch or availability"],
    ["This hook is {'approved by Uniswap'}.", "Uniswap verification, approval, certification or official status"],
    ["This hook is {'live on mainnet'}.", "Deployment, launch or availability"],
    ["This hook is {'approved'} by {'Uniswap'}.", "Uniswap verification, approval, certification or official status"],
    ["This hook is {'live'} on {'mainnet'}.", "Deployment, launch or availability"]
  ];

  for (const [jsxCopy, label] of cases) {
    const publicText = extractPublicClaimText(`export const View = () => <p>${jsxCopy}</p>;`, ".tsx");
    assert.equal(publicText.replace(/\s+/gu, " ").trim(), jsxCopy.replace(/[{}']/gu, ""), jsxCopy);
    assert.deepEqual(findUnsupportedPublicClaims(publicText), [label], jsxCopy);
  }
});

test("JSX reconstruction preserves legitimate negations split across static expressions", () => {
  const publicText = extractPublicClaimText(`
    // This hook is {'approved by Uniswap'}.
    /* This hook is {'live on mainnet'}. */
    export const View = () => <>
      <p>This hook is {'not'} safe.</p>
      <p>This hook is not {'audited'}.</p>
      <p>This hook is {'not'} deployed.</p>
    </>;
  `, ".tsx");

  assert.doesNotMatch(publicText, /approved by Uniswap/u);
  assert.doesNotMatch(publicText, /live on mainnet/u);
  assert.match(publicText.replace(/\s+/gu, " "), /This hook is not safe\./u);
  assert.match(publicText.replace(/\s+/gu, " "), /This hook is not audited\./u);
  assert.match(publicText.replace(/\s+/gu, " "), /This hook is not deployed\./u);
  assert.deepEqual(findUnsupportedPublicClaims(publicText), []);
});

test("HTML and component extraction checks visible copy and accessible labels", () => {
  const html = `
    <!-- This hook is approved by Uniswap. -->
    <main><h1>This hook is unruggable.</h1><img alt="Production-ready hook"></main>
    <script>const fixture = "Audited by Trail of Bits.";</script>
  `;
  const visible = extractPublicClaimText(html, ".html");

  assert.doesNotMatch(visible, /approved by Uniswap/);
  assert.doesNotMatch(visible, /Trail of Bits/);
  assert.match(visible, /unruggable/);
  assert.match(visible, /Production-ready/);
});

test("HTML raw-text filtering handles browser-tolerated closing tags without exposing hidden code", () => {
  const html = `
    <main>İstanbul hosts a local prototype.</main>
    <ScRiPt data-label=">">const hidden = "This hook is approved by Uniswap.";</sCrIpT\t\n ignored>
    <style>.fixture::after { content: "This hook is unruggable."; }</style\r data-extra>
  `;
  const visible = extractPublicClaimText(html, ".html");

  assert.match(visible, /İstanbul hosts a local prototype/u);
  assert.doesNotMatch(visible, /approved by Uniswap/u);
  assert.doesNotMatch(visible, /unruggable/u);
  assert.deepEqual(findUnsupportedPublicClaims(visible), []);
});

test("component script analysis preserves code behind browser-tolerated closing tags", () => {
  for (const extension of [".vue", ".svelte"]) {
    const analysis = analyzePublicClaimSource(`
      <script lang="ts">export const badge = "This hook is approved by Uniswap.";</script\t\n ignored>
      <main>Prototype only.</main>
    `, extension);

    assert.equal(analysis.analysisComplete, true, extension);
    assert.deepEqual(findUnsupportedPublicClaims(analysis.text), [
      "Uniswap verification, approval, certification or official status"
    ], extension);
  }
});

test("HTML entity extraction decodes exactly once", () => {
  const visible = extractPublicClaimText(`
    <p title="&amp;lt;script&amp;gt;">&amp;quot;not approved&amp;quot; &lt;prototype&gt; &#39;local&#39;</p>
  `, ".html");

  assert.match(visible, /&lt;script&gt;/u);
  assert.match(visible, /&quot;not approved&quot;/u);
  assert.match(visible, /<prototype>/u);
  assert.match(visible, /'local'/u);
  assert.equal(visible.toLowerCase().includes("<script>"), false);
  assert.doesNotMatch(visible, /"not approved"/u);
});

test("declared JSON and YAML locale values expose public claims without treating keys or comments as copy", () => {
  const jsonText = extractPublicClaimText(JSON.stringify({
    "This hook is unruggable.": "Internal translation key only",
    hero: { title: "This hook is approved by Uniswap." }
  }), ".json");
  assert.doesNotMatch(jsonText, /unruggable/);
  assert.deepEqual(findUnsupportedPublicClaims(jsonText), [
    "Uniswap verification, approval, certification or official status"
  ]);

  const yamlText = extractPublicClaimText(`
    # This hook is approved by Programmable.
    hero:
      title: "This hook is independently audited."
      details: |
        Prototype evidence is shown here.
        The project is live on mainnet.
  `, ".yml");
  assert.doesNotMatch(yamlText, /approved by Programmable/);
  assert.deepEqual(findUnsupportedPublicClaims(yamlText), [
    "Independent audit or certification",
    "Deployment, launch or availability"
  ]);
});

test("shipped Markdown checks visible content while ignoring examples, comments and MDX imports", () => {
  const markdownText = extractPublicClaimText(`---
title: Prototype status
---
<!-- This hook is approved by Uniswap. -->
import Fixture from "./fixture";

\`\`\`text
This hook is unruggable.
\`\`\`

# Current status

The submitted project is production-ready.
`, ".mdx");
  assert.doesNotMatch(markdownText, /approved by Uniswap/);
  assert.doesNotMatch(markdownText, /unruggable/);
  assert.deepEqual(findUnsupportedPublicClaims(markdownText), ["Deployment, launch or availability"]);
});

test("honest structured content and unknown provider review copy do not become false blockers", () => {
  for (const [extension, contents] of [
    [".json", JSON.stringify({ unsafeExample: "This hook is not audited and is not deployed." })],
    [".yaml", "# This hook is guaranteed safe.\nstatus: No Uniswap approval is claimed.\n"],
    [".md", "`This hook is unruggable.`\n\nNebulaRoute support requires provider review; no approval is claimed.\n"]
  ]) {
    assert.deepEqual(findUnsupportedPublicClaims(extractPublicClaimText(contents, extension)), [], extension);
  }
});

test("metadata identity inspection preserves legitimate Unicode while surfacing confusables", () => {
  const japanese = inspectPublicMetadataText("東京トークン");
  assert.equal(japanese.hasConfusableCharacters, false);
  assert.equal(japanese.hasInvisibleOrBidi, false);

  const cyrillic = inspectPublicMetadataText("Москва Токен");
  assert.equal(cyrillic.hasConfusableCharacters, false);

  const impersonation = inspectPublicMetadataText("Un\u0456swap");
  assert.equal(impersonation.hasConfusableCharacters, true);
  assert.equal(publicIdentityKey("Un\u0456swap"), "uniswap");

  const hidden = inspectPublicMetadataText("UNI\u202eP");
  assert.equal(hidden.hasInvisibleOrBidi, true);
});

test("escaped JavaScript strings cannot hide public claims", () => {
  const publicText = extractPublicClaimText(
    String.raw`export const copy = "This hook is \u0061pproved by Un\u0069swap.";`,
    ".ts"
  );
  assert.deepEqual(findUnsupportedPublicClaims(publicText), [
    "Uniswap verification, approval, certification or official status"
  ]);
});

test("JavaScript line continuations cannot split a forbidden public claim", () => {
  for (const lineTerminator of ["\n", "\r", "\r\n", "\u2028", "\u2029"]) {
    const source = `export const copy = "This hook is un\\${lineTerminator}ruggable.";`;
    const analysis = analyzePublicClaimSource(source, ".js");

    assert.equal(analysis.analysisComplete, true, JSON.stringify(lineTerminator));
    assert.match(analysis.text, /This hook is unruggable\./u, JSON.stringify(lineTerminator));
    assert.deepEqual(
      findUnsupportedPublicClaims(analysis.text),
      ["Safety, rug-free or risk-free status"],
      JSON.stringify(lineTerminator)
    );
  }
});

test("literal-only JavaScript composition cannot split a forbidden public claim", () => {
  const cases = [
    `export const badge = ["This hook is un", "ruggable."].join("");`,
    `export const badge = "This hook is un" + "ruggable.";`,
    "export const badge = `This hook is unruggable.`;",
    "export const badge = `This hook is ${[\"un\", \"ruggable\"].join(\"\")}.`;",
    `export const badge = (["This hook ", "is "].join("") + ("approved by " + "Uniswap."));`
  ];

  for (const source of cases) {
    const publicText = extractPublicClaimText(source, ".tsx");
    assert.ok(findUnsupportedPublicClaims(publicText).length > 0, source);
  }
});

test("oversized static joins are bounded before materialization and return an incomplete analysis", () => {
  const items = Array.from({ length: 27_000 }, () => `""`).join(",");
  const separator = "x".repeat(20_000);
  const source = `export const copy = [${items}].join(${JSON.stringify(separator)});`;

  const analysis = analyzePublicClaimSource(source, ".js");

  assert.equal(analysis.analysisComplete, false);
  assert.deepEqual(analysis.analysisIssues, ["STATIC_JAVASCRIPT_RESOURCE_LIMIT"]);
  assert.equal(analysis.text, separator);
});

test("static JavaScript token overflow is explicit and cannot hide a later composed claim", () => {
  const source = `${";".repeat(100_001)}export const copy = ["This hook is un", "ruggable."].join("");`;

  const analysis = analyzePublicClaimSource(source, ".js");

  assert.equal(analysis.analysisComplete, false);
  assert.deepEqual(analysis.analysisIssues, ["STATIC_JAVASCRIPT_RESOURCE_LIMIT"]);
  assert.deepEqual(findUnsupportedPublicClaims(analysis.text), []);
});

test("static JavaScript evaluator failures return an explicit incomplete result instead of throwing", () => {
  let analysis;
  assert.doesNotThrow(() => {
    analysis = analyzePublicClaimSource(`export const matcher = /unterminated`, ".js");
  });
  assert.equal(analysis.analysisComplete, false);
  assert.deepEqual(analysis.analysisIssues, ["STATIC_JAVASCRIPT_ANALYSIS_FAILED"]);
});

test("only the selected branch of an exact boolean-literal conditional contributes public claim text", () => {
  const forbiddenComposition = `["This hook is un", "ruggable."].join("")`;
  const forbiddenLiteral = `"This hook is unruggable."`;
  const cases = [
    [`false ? ${forbiddenComposition} : "Prototype only."`, false],
    [`true ? "Prototype only." : ${forbiddenComposition}`, false],
    [`true ? ${forbiddenComposition} : "Prototype only."`, true],
    [`false ? "Prototype only." : ${forbiddenComposition}`, true],
    [`enabled ? "Prototype only." : ${forbiddenComposition}`, true],
    [`false ? ${forbiddenLiteral} : "Prototype only."`, false],
    [`true ? "Prototype only." : ${forbiddenLiteral}`, false],
    [`true ? ${forbiddenLiteral} : "Prototype only."`, true],
    [`false ? "Prototype only." : ${forbiddenLiteral}`, true],
    [`enabled ? "Prototype only." : ${forbiddenLiteral}`, true]
  ];

  for (const [expression, forbidden] of cases) {
    const analysis = analyzePublicClaimSource(`export const copy = ${expression};`, ".js");
    assert.equal(analysis.analysisComplete, true, expression);
    assert.equal(findUnsupportedPublicClaims(analysis.text).length > 0, forbidden, expression);
  }
});

test("static composition preserves negative disclosures and ignores non-final or regex lookalikes", () => {
  for (const source of [
    `export const status = ["This hook is not ", "audited."].join("");`,
    `export const label = ["Nebula", "Route"].join("");`,
    `export const transformed = ["This hook is un", "ruggable."].join("").replace("un", "");`,
    String.raw`export const fixture = /["This hook is un","ruggable."].join\(""\)/;`
  ]) {
    const publicText = extractPublicClaimText(source, ".tsx");
    assert.deepEqual(findUnsupportedPublicClaims(publicText), [], source);
  }
});

test("static composition analysis does not execute candidate code, read secrets, or write files", (t) => {
  const environmentName = `PROGRAMMABLE_PUBLIC_CLAIMS_SECRET_${process.pid}`;
  const secret = "private-runtime-value-that-must-not-be-read";
  const marker = path.join(os.tmpdir(), `programmable-public-claims-no-write-${process.pid}-${Date.now()}`);
  process.env[environmentName] = secret;
  t.after(() => {
    delete process.env[environmentName];
    fs.rmSync(marker, { force: true });
  });

  const source = `
    const runtimeSecret = process.env[${JSON.stringify(environmentName)}];
    globalThis.require?.("node:fs").writeFileSync(${JSON.stringify(marker)}, runtimeSecret);
    export const badge = ["This hook is un", "ruggable."].join("");
  `;
  const publicText = extractPublicClaimText(source, ".tsx");
  const findings = findUnsupportedPublicClaims(publicText);

  assert.deepEqual(findings, ["Safety, rug-free or risk-free status"]);
  assert.equal(publicText.includes(secret), false);
  assert.equal(JSON.stringify(findings).includes(secret), false);
  assert.equal(fs.existsSync(marker), false);
});
