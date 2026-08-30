#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import {
  constants as fsConstants,
  link,
  lstat,
  open,
  realpath,
  stat,
  unlink,
} from "node:fs/promises";
import { createServer } from "node:http";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY,
  canonicalTargetDeploymentJson,
  loadMainTokenMigrationTargetDeployment,
  preflightMainTokenMigrationTargetDeployment,
  revalidateMainTokenMigrationTargetWalletRequest,
  sha256CanonicalTargetDeploymentJson,
  validateMainTokenMigrationTargetRecordedEnvelope,
  verifyMainTokenMigrationTargetDeploymentFinality,
} from "./main-token-migration-target-deployment-core.mjs";

const DEFAULT_DESIGN_PATH = "config/main-token-migration-target-design.v1.json";
const MAX_BODY_BYTES = 8 * 1_024;
const MAX_PROTECTED_RECORD_BYTES = 256 * 1_024;
const DEFAULT_PORT = 8_766;
const AUTHORIZED_RECOVERY_SCHEMA =
  "programmable-main-token-migration-target-authorized-recovery/v1";
const SUBMITTED_RECOVERY_SCHEMA =
  "programmable-main-token-migration-target-submitted-recovery/v1";

function fail(message) {
  throw new Error(`Migration target operator rejected: ${message}`);
}

function takeValue(argv, index, option) {
  if (index + 1 >= argv.length || argv[index + 1].startsWith("--")) {
    fail(`${option} requires a value`);
  }
  return argv[index + 1];
}

export function parseMainTokenMigrationTargetOperatorArguments(
  argv,
  environment = process.env,
) {
  const parsed = {
    write: false,
    port: DEFAULT_PORT,
    designPath: environment.MAIN_TOKEN_MIGRATION_TARGET_DESIGN_PATH,
    owner: environment.ROBINHOOD_MIGRATION_DEPLOYMENT_OWNER,
    sourceDeadlineTimestampExclusive:
      environment.MAIN_TOKEN_MIGRATION_SOURCE_DEADLINE_TIMESTAMP_EXCLUSIVE,
    sealAuthority: environment.MAIN_TOKEN_MIGRATION_SEAL_AUTHORITY,
    remainderRecipient: environment.MAIN_TOKEN_MIGRATION_REMAINDER_RECIPIENT,
    maximumFeePerGasWei:
      environment.ROBINHOOD_MIGRATION_MAXIMUM_FEE_PER_GAS_WEI,
    maximumPriorityFeePerGasWei:
      environment.ROBINHOOD_MIGRATION_MAXIMUM_PRIORITY_FEE_PER_GAS_WEI,
    maximumGasCostWei:
      environment.ROBINHOOD_MIGRATION_MAXIMUM_GAS_COST_WEI,
    receiptPath: environment.MAIN_TOKEN_MIGRATION_TARGET_RECEIPT_PATH,
    ethereumPostingBlock:
      environment.MAIN_TOKEN_MIGRATION_ETHEREUM_POSTING_BLOCK,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--write") {
      parsed.write = true;
      continue;
    }
    if (option === "--help" || option === "-h") return { help: true };
    const value = takeValue(argv, index, option);
    index += 1;
    if (option === "--port") parsed.port = Number(value);
    else if (option === "--design") parsed.designPath = value;
    else if (option === "--owner") parsed.owner = value;
    else if (option === "--deadline") {
      parsed.sourceDeadlineTimestampExclusive = value;
    } else if (option === "--seal-authority") parsed.sealAuthority = value;
    else if (option === "--remainder-recipient") {
      parsed.remainderRecipient = value;
    } else if (option === "--max-fee-per-gas-wei") {
      parsed.maximumFeePerGasWei = value;
    } else if (option === "--max-priority-fee-per-gas-wei") {
      parsed.maximumPriorityFeePerGasWei = value;
    } else if (option === "--max-gas-cost-wei") {
      parsed.maximumGasCostWei = value;
    } else if (option === "--receipt") parsed.receiptPath = value;
    else if (option === "--ethereum-posting-block") {
      parsed.ethereumPostingBlock = value;
    } else fail(`unknown option ${option}`);
  }
  if (
    !Number.isSafeInteger(parsed.port) ||
    parsed.port < 1_024 ||
    parsed.port > 65_535
  ) {
    fail("port must be between 1024 and 65535");
  }
  for (const [key, value] of Object.entries({
    owner: parsed.owner,
    sourceDeadlineTimestampExclusive:
      parsed.sourceDeadlineTimestampExclusive,
    sealAuthority: parsed.sealAuthority,
    remainderRecipient: parsed.remainderRecipient,
    maximumFeePerGasWei: parsed.maximumFeePerGasWei,
    maximumPriorityFeePerGasWei: parsed.maximumPriorityFeePerGasWei,
    maximumGasCostWei: parsed.maximumGasCostWei,
  })) {
    if (typeof value !== "string" || value.length === 0) {
      fail(`${key} is required`);
    }
  }
  if (parsed.write && !parsed.receiptPath) {
    fail("--write requires an absolute protected --receipt path");
  }
  return parsed;
}

const USAGE = `Usage:
  node scripts/serve-main-token-migration-target-deployment.mjs [options]

Read-only is the default. Add --write only after reviewing the exact plan.

Required owner-bound options (or matching environment variables):
  --owner <address>
  --deadline <unix-seconds>
  --seal-authority <address>
  --remainder-recipient <address>
  --max-fee-per-gas-wei <decimal>
  --max-priority-fee-per-gas-wei <decimal>
  --max-gas-cost-wei <decimal>

Write-only options:
  --write
  --receipt </absolute/private/path.json>
  --ethereum-posting-block <decimal>  May also be entered locally after submit.

Protected provider environment variables (never printed):
  ROBINHOOD_MIGRATION_RPC_URL_PRIMARY       QuickNode Robinhood Mainnet
  ROBINHOOD_MIGRATION_RPC_URL_SECONDARY     Alchemy Robinhood Mainnet
  ETHEREUM_MAINNET_RPC_URL_PRIMARY          dRPC Ethereum Mainnet
  ETHEREUM_MAINNET_RPC_URL_SECONDARY        QuickNode Ethereum Mainnet

The operator never accepts a private key, signs automatically, or broadcasts
without a separate wallet confirmation.`;

function providerUrls(environment = process.env) {
  const robinhood = [
    environment.ROBINHOOD_MIGRATION_RPC_URL_PRIMARY,
    environment.ROBINHOOD_MIGRATION_RPC_URL_SECONDARY,
  ];
  const ethereum = [
    environment.ETHEREUM_MAINNET_RPC_URL_PRIMARY,
    environment.ETHEREUM_MAINNET_RPC_URL_SECONDARY,
  ];
  if (robinhood.some((value) => !value) || ethereum.some((value) => !value)) {
    fail("two protected Robinhood and two protected Ethereum RPCs are required");
  }
  return { robinhood, ethereum };
}

function sendJson(response, status, value) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  response.writeHead(status, {
    "cache-control": "no-store, max-age=0",
    "content-type": "application/json; charset=utf-8",
    "content-length": bytes.length,
    "x-content-type-options": "nosniff",
  });
  response.end(bytes);
}

function safeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/https:\/\/[^\s"']+/giu, "[protected endpoint]")
    .replace(/[A-Za-z0-9_-]{32,}/gu, (value) =>
      value.startsWith("Migration") ? value : "[redacted]",
    );
}

async function readJsonBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) fail("request body is too large");
    chunks.push(chunk);
  }
  if (total === 0) fail("request body is empty");
  try {
    return JSON.parse(Buffer.concat(chunks, total).toString("utf8"));
  } catch {
    fail("request body is not JSON");
  }
}

function inside(parent, child) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

async function resolveProtectedTargetPath(
  repositoryRoot,
  targetPath,
  { mustBeMissing },
) {
  if (!isAbsolute(targetPath)) fail("protected path must be absolute");
  const [root, parent] = await Promise.all([
    realpath(repositoryRoot),
    realpath(dirname(targetPath)),
  ]);
  const canonical = resolve(parent, basename(targetPath));
  if (inside(root, canonical)) {
    fail("protected path must stay outside the repository");
  }
  const parentMetadata = await stat(parent);
  if (
    !parentMetadata.isDirectory() ||
    (parentMetadata.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" &&
      parentMetadata.uid !== process.getuid())
  ) {
    fail("protected parent must be a private owner-controlled directory");
  }
  try {
    const metadata = await lstat(canonical);
    if (
      metadata.isSymbolicLink() ||
      !metadata.isFile() ||
      (metadata.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" && metadata.uid !== process.getuid())
    ) {
      fail("protected target is not a private owner-controlled regular file");
    }
    if (mustBeMissing) fail("protected target already exists");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    if (!mustBeMissing) return null;
  }
  return canonical;
}

export async function assertProtectedTargetReceiptPath(
  repositoryRoot,
  receiptPath,
) {
  return resolveProtectedTargetPath(repositoryRoot, receiptPath, {
    mustBeMissing: true,
  });
}

async function syncDirectory(path) {
  const handle = await open(path, fsConstants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeProtectedCanonicalJsonNoReplace({
  repositoryRoot,
  targetPath,
  value,
}) {
  const target = await resolveProtectedTargetPath(repositoryRoot, targetPath, {
    mustBeMissing: true,
  });
  const temporary = `${target}.tmp-${randomBytes(16).toString("hex")}`;
  let linked = false;
  let handle = null;
  try {
    handle = await open(
      temporary,
      fsConstants.O_WRONLY |
        fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        fsConstants.O_NOFOLLOW,
      0o600,
    );
    await handle.writeFile(`${canonicalTargetDeploymentJson(value)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await link(temporary, target);
    linked = true;
    await syncDirectory(dirname(target));
  } finally {
    if (handle) await handle.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    if (linked) await syncDirectory(dirname(target));
  }
  return target;
}

export async function writeProtectedTargetDeploymentReceipt({
  repositoryRoot,
  receiptPath,
  receipt,
}) {
  return writeProtectedCanonicalJsonNoReplace({
    repositoryRoot,
    targetPath: receiptPath,
    value: receipt,
  });
}

function recoveryPaths(receiptPath) {
  return {
    authorized: `${receiptPath}.authorized.json`,
    submitted: `${receiptPath}.submitted.json`,
  };
}

function exactKeys(value, expected, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify([...expected].sort())
  ) {
    fail(`${label} field inventory differs`);
  }
}

async function readProtectedCanonicalJson({ repositoryRoot, targetPath }) {
  const target = await resolveProtectedTargetPath(repositoryRoot, targetPath, {
    mustBeMissing: false,
  });
  if (target === null) return null;
  const handle = await open(
    target,
    fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
  );
  try {
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      metadata.size < 2 ||
      metadata.size > MAX_PROTECTED_RECORD_BYTES ||
      (metadata.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" && metadata.uid !== process.getuid())
    ) {
      fail("protected recovery record is invalid");
    }
    const bytes = await handle.readFile();
    let value;
    try {
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      fail("protected recovery record is not canonical JSON");
    }
    if (`${canonicalTargetDeploymentJson(value)}\n` !== bytes.toString("utf8")) {
      fail("protected recovery record bytes are not canonical");
    }
    return value;
  } finally {
    await handle.close();
  }
}

async function writeOrMatchProtectedRecord({
  repositoryRoot,
  targetPath,
  value,
}) {
  const existing = await readProtectedCanonicalJson({
    repositoryRoot,
    targetPath,
  });
  if (existing !== null) {
    if (
      canonicalTargetDeploymentJson(existing) !==
      canonicalTargetDeploymentJson(value)
    ) {
      fail("protected recovery record already binds a different attempt");
    }
    return targetPath;
  }
  return writeProtectedCanonicalJsonNoReplace({
    repositoryRoot,
    targetPath,
    value,
  });
}

export async function writeProtectedTargetAuthorizationCheckpoint({
  repositoryRoot,
  receiptPath,
  plan,
  envelope,
}) {
  validateMainTokenMigrationTargetRecordedEnvelope({ plan, envelope });
  const subject = {
    schema: AUTHORIZED_RECOVERY_SCHEMA,
    state: "authorized-wallet-prompt-pending-or-submitted",
    preparedDigest: plan.preparedDigest,
    envelopeDigest: envelope.envelopeDigest,
    envelope,
  };
  const checkpoint = {
    ...subject,
    checkpointSha256: sha256CanonicalTargetDeploymentJson(subject),
  };
  await writeOrMatchProtectedRecord({
    repositoryRoot,
    targetPath: recoveryPaths(receiptPath).authorized,
    value: checkpoint,
  });
  return checkpoint;
}

export async function writeProtectedTargetSubmissionCheckpoint({
  repositoryRoot,
  receiptPath,
  plan,
  envelope,
  transactionHash,
}) {
  validateMainTokenMigrationTargetRecordedEnvelope({ plan, envelope });
  const txHash = String(transactionHash ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{64}$/u.test(txHash)) {
    fail("submitted transaction hash is invalid");
  }
  const subject = {
    schema: SUBMITTED_RECOVERY_SCHEMA,
    state: "submitted-awaiting-ethereum-terminal-finality",
    preparedDigest: plan.preparedDigest,
    envelopeDigest: envelope.envelopeDigest,
    transactionHash: txHash,
  };
  const checkpoint = {
    ...subject,
    checkpointSha256: sha256CanonicalTargetDeploymentJson(subject),
  };
  await writeOrMatchProtectedRecord({
    repositoryRoot,
    targetPath: recoveryPaths(receiptPath).submitted,
    value: checkpoint,
  });
  return checkpoint;
}

export async function loadProtectedTargetDeploymentRecovery({
  repositoryRoot,
  receiptPath,
  plan,
}) {
  const paths = recoveryPaths(receiptPath);
  const [authorized, submitted] = await Promise.all([
    readProtectedCanonicalJson({
      repositoryRoot,
      targetPath: paths.authorized,
    }),
    readProtectedCanonicalJson({
      repositoryRoot,
      targetPath: paths.submitted,
    }),
  ]);
  if (submitted !== null && authorized === null) {
    fail("submitted recovery record has no authorized envelope");
  }
  if (authorized === null) return { envelope: null, transactionHash: null };
  exactKeys(
    authorized,
    [
      "schema",
      "state",
      "preparedDigest",
      "envelopeDigest",
      "envelope",
      "checkpointSha256",
    ],
    "authorized recovery record",
  );
  const {
    checkpointSha256: authorizedDigest,
    ...authorizedSubject
  } = authorized;
  if (
    authorized.schema !== AUTHORIZED_RECOVERY_SCHEMA ||
    authorized.state !== "authorized-wallet-prompt-pending-or-submitted" ||
    authorized.preparedDigest !== plan.preparedDigest ||
    authorized.envelopeDigest !== authorized.envelope?.envelopeDigest ||
    authorizedDigest !==
      sha256CanonicalTargetDeploymentJson(authorizedSubject)
  ) {
    fail("authorized recovery record does not bind the prepared deployment");
  }
  validateMainTokenMigrationTargetRecordedEnvelope({
    plan,
    envelope: authorized.envelope,
  });
  if (submitted === null) {
    return { envelope: authorized.envelope, transactionHash: null };
  }
  exactKeys(
    submitted,
    [
      "schema",
      "state",
      "preparedDigest",
      "envelopeDigest",
      "transactionHash",
      "checkpointSha256",
    ],
    "submitted recovery record",
  );
  const { checkpointSha256: submittedDigest, ...submittedSubject } = submitted;
  if (
    submitted.schema !== SUBMITTED_RECOVERY_SCHEMA ||
    submitted.state !== "submitted-awaiting-ethereum-terminal-finality" ||
    submitted.preparedDigest !== plan.preparedDigest ||
    submitted.envelopeDigest !== authorized.envelopeDigest ||
    !/^0x[0-9a-f]{64}$/u.test(submitted.transactionHash) ||
    submittedDigest !== sha256CanonicalTargetDeploymentJson(submittedSubject)
  ) {
    fail("submitted recovery record does not bind the authorized attempt");
  }
  return {
    envelope: authorized.envelope,
    transactionHash: submitted.transactionHash,
  };
}

function html({ plan, write, operatorToken, nonce, recovery }) {
  const config = JSON.stringify({
    write,
    operatorToken,
    preparedDigest: plan.preparedDigest,
    chainId: MAIN_TOKEN_MIGRATION_TARGET_DEPLOYMENT_POLICY.chainIdHex,
    owner: plan.owner,
    to: plan.to,
    value: plan.value,
    data: plan.transactionData,
    token: plan.predicted.token,
    distributor: plan.predicted.distributor,
    recoveryEnvelopeDigest: recovery.envelope?.envelopeDigest ?? null,
    recoveredTransactionHash: recovery.transactionHash,
  }).replace(/</gu, "\\u003c");
  const mode = write ? "Owner wallet mode" : "Read-only inspection";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><title>Programmable V4 migration target</title>
<style nonce="${nonce}">
:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#f7f4ed;background:#090909}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}.shell{width:min(900px,100%);border:1px solid #2b2b2b;background:#111;border-radius:24px;padding:clamp(24px,5vw,48px);box-shadow:0 28px 90px #0009}h1{font-size:clamp(30px,5vw,54px);letter-spacing:-.045em;line-height:1;margin:0 0 12px}.eyebrow{color:#ee8fbd;text-transform:uppercase;letter-spacing:.12em;font-weight:750;font-size:12px}.muted{color:#aaa;line-height:1.55}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:28px 0}.card{border:1px solid #292929;border-radius:15px;padding:16px;min-width:0}.label{display:block;color:#888;font-size:12px;margin-bottom:7px}.value{font-family:ui-monospace,SFMono-Regular,monospace;font-size:13px;overflow-wrap:anywhere}.actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}button,input{font:inherit}button{border:0;border-radius:999px;padding:12px 18px;font-weight:750;background:#f5d12b;color:#111;cursor:pointer}button:disabled{cursor:not-allowed;opacity:.38}.secondary{background:#252525;color:#fff}.notice{margin-top:18px;min-height:24px;color:#aaa}.notice.error{color:#ff9b9b}.notice.success{color:#87d59d}.posting{display:none;margin-top:18px;gap:8px}.posting.open{display:flex}.posting input{min-width:0;flex:1;border:1px solid #353535;border-radius:12px;padding:12px;background:#0a0a0a;color:#fff}@media(max-width:650px){.grid{grid-template-columns:1fr}.shell{border-radius:18px;padding:24px}}
</style></head><body><main class="shell"><p class="eyebrow">${mode}</p><h1>Robinhood V4 target deployment</h1>
<p class="muted">One deterministic zero-value deployment. The wallet remains the only signer. Production evidence is written only after Robinhood agreement and Ethereum-finalized Nitro batch inclusion.</p>
<section class="grid"><div class="card"><span class="label">Owner</span><span class="value">${plan.owner}</span></div><div class="card"><span class="label">Chain</span><span class="value">Robinhood · 4663</span></div><div class="card"><span class="label">Predicted token</span><span class="value">${plan.predicted.token}</span></div><div class="card"><span class="label">Predicted distributor</span><span class="value">${plan.predicted.distributor}</span></div><div class="card"><span class="label">Prepared digest</span><span class="value">${plan.preparedDigest}</span></div><div class="card"><span class="label">Value</span><span class="value">0 ETH</span></div></section>
<div class="actions"><button id="connect" class="secondary">Connect wallet</button><button id="send" disabled>Review exact transaction</button></div>
<div id="posting" class="posting"><input id="txHash" autocomplete="off" placeholder="Robinhood transaction hash"><input id="postingBlock" inputmode="numeric" placeholder="Ethereum posting block"><button id="verify">Verify finality</button></div><p id="notice" class="notice">${recovery.envelope ? "Protected recovery loaded. Enter the transaction hash if the wallet return was interrupted." : write ? "Connect the exact owner wallet to continue." : "Restart with --write only after the read-only plan is reviewed."}</p>
</main><script nonce="${nonce}">const config=${config};
const el={connect:document.querySelector("#connect"),send:document.querySelector("#send"),posting:document.querySelector("#posting"),txHash:document.querySelector("#txHash"),postingBlock:document.querySelector("#postingBlock"),verify:document.querySelector("#verify"),notice:document.querySelector("#notice")};let provider=null,account=null,envelope=config.recoveryEnvelopeDigest?{envelopeDigest:config.recoveryEnvelopeDigest}:null,txHash=config.recoveredTransactionHash,busy=false,submitted=Boolean(config.recoveredTransactionHash);
function notice(message,type=""){el.notice.textContent=message;el.notice.className="notice "+type}function lower(value){return String(value).toLowerCase()}function canonicalQuantity(value){return /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(String(value))}function wallet(){if(window.ethereum?.isMetaMask)return window.ethereum;return window.ethereum?.providers?.find(candidate=>candidate?.isMetaMask)||window.ethereum}
async function request(method,params=[]){return provider.request({method,params})}async function api(path,body){const response=await fetch(path,{method:body?"POST":"GET",headers:{"content-type":"application/json","x-operator-token":config.operatorToken},body:body?JSON.stringify(body):undefined,cache:"no-store"});const result=await response.json();if(!response.ok)throw new Error(result.error||"Operator request failed");return result}
function setButtons(){el.connect.disabled=busy||Boolean(config.recoveryEnvelopeDigest);el.send.disabled=busy||!config.write||!account||Boolean(config.recoveryEnvelopeDigest);el.verify.disabled=busy||!config.write||!envelope}
function assertPrepared(requestValue){const exact={chainId:config.chainId,from:config.owner,to:config.to,value:config.value,data:config.data};for(const [key,value] of Object.entries(exact)){if(lower(requestValue[key])!==lower(value))throw new Error("Prepared "+key+" differs")}for(const key of ["nonce","gas","maxFeePerGas","maxPriorityFeePerGas"]){if(!canonicalQuantity(requestValue[key]))throw new Error("Prepared "+key+" is not canonical")}if(requestValue.type!=="0x2"||BigInt(requestValue.maxPriorityFeePerGas)>BigInt(requestValue.maxFeePerGas))throw new Error("Prepared fee envelope is invalid")}
async function connect(){if(busy)return;busy=true;setButtons();try{provider=wallet();if(!provider)throw new Error("No EVM wallet is available");let accounts=await request("eth_requestAccounts");account=accounts[0];const chain=await request("eth_chainId");if(lower(chain)!==lower(config.chainId)){await request("wallet_switchEthereumChain",[{chainId:config.chainId}])}accounts=await request("eth_accounts");account=accounts[0];if(lower(account)!==lower(config.owner))throw new Error("Connect the exact deployment owner");notice(config.write?"Owner connected. The server will revalidate all fields before the wallet opens.":"Owner connected. This server is read-only.","success")}catch(error){account=null;notice(error?.message||String(error),"error")}finally{busy=false;setButtons()}}
async function send(){if(busy||!config.write||!account)return;busy=true;setButtons();try{const inspection=await api("/inspection");envelope=inspection.envelope;const chain=await request("eth_chainId");const accounts=await request("eth_accounts");if(lower(chain)!==lower(config.chainId)||lower(accounts[0])!==lower(config.owner))throw new Error("Wallet or chain changed");const authorized=await api("/authorize",{account:accounts[0],chainId:chain,envelopeDigest:envelope.envelopeDigest});envelope=authorized.envelope;assertPrepared(envelope.request);const freshChain=await request("eth_chainId");const freshAccounts=await request("eth_accounts");const walletNonce=await request("eth_getTransactionCount",[freshAccounts[0],"pending"]);const walletEstimate=await request("eth_estimateGas",[{from:envelope.request.from,to:envelope.request.to,value:envelope.request.value,data:envelope.request.data}]);if(lower(freshChain)!==lower(config.chainId)||lower(freshAccounts[0])!==lower(config.owner)||BigInt(walletNonce)!==BigInt(envelope.request.nonce)||BigInt(walletEstimate)>BigInt(envelope.request.gas))throw new Error("Wallet action-time chain, account, nonce, or gas changed");assertPrepared(envelope.request);notice("Review the exact zero-value deployment in your wallet.");txHash=await request("eth_sendTransaction",[envelope.request]);if(!/^0x[0-9a-f]{64}$/i.test(txHash))throw new Error("Wallet returned an invalid transaction hash");el.txHash.value=txHash;el.posting.classList.add("open");notice("Wallet returned the transaction hash. Securing the recovery record.");await api("/submitted",{transactionHash:txHash,envelopeDigest:envelope.envelopeDigest});submitted=true;notice("Submitted and protected for recovery. Enter the exact Ethereum SequencerInbox posting block once available.","success")}catch(error){notice(error?.message||String(error),"error")}finally{busy=false;setButtons()}}
async function verify(){if(busy||!envelope)return;busy=true;setButtons();try{txHash=el.txHash.value.trim().toLowerCase();if(!/^0x[0-9a-f]{64}$/.test(txHash))throw new Error("Enter the exact Robinhood transaction hash");const postingBlock=el.postingBlock.value.trim();if(!/^[1-9][0-9]*$/.test(postingBlock))throw new Error("Enter the exact Ethereum posting block");if(!submitted){await api("/submitted",{transactionHash:txHash,envelopeDigest:envelope.envelopeDigest});submitted=true}await api("/record",{transactionHash:txHash,envelopeDigest:envelope.envelopeDigest,ethereumPostingBlock:postingBlock});notice("Ethereum finality and the exact deployed state are verified. Protected receipt written.","success");el.posting.classList.remove("open")}catch(error){notice(error?.message||String(error),"error")}finally{busy=false;setButtons()}}
el.connect.addEventListener("click",connect);el.send.addEventListener("click",send);el.verify.addEventListener("click",verify);if(config.recoveryEnvelopeDigest){el.posting.classList.add("open");el.txHash.value=config.recoveredTransactionHash||""}setButtons();</script></body></html>`;
}

function securityHeaders(nonce) {
  return {
    "cache-control": "no-store, max-age=0",
    "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  };
}

export async function runMainTokenMigrationTargetOperator({
  argv = process.argv.slice(2),
  environment = process.env,
  repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url))),
  rpcClient,
  createHttpServer = createServer,
} = {}) {
  const options = parseMainTokenMigrationTargetOperatorArguments(
    argv,
    environment,
  );
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return null;
  }
  const endpoints = providerUrls(environment);
  const plan = await loadMainTokenMigrationTargetDeployment({
    repositoryRoot,
    targetDesignPath: resolve(
      repositoryRoot,
      options.designPath ?? DEFAULT_DESIGN_PATH,
    ),
    owner: options.owner,
    ownerFields: {
      sourceDeadlineTimestampExclusive:
        options.sourceDeadlineTimestampExclusive,
      sealAuthority: options.sealAuthority,
      remainderRecipient: options.remainderRecipient,
    },
  });
  const recovery = options.write
    ? await (async () => {
        await assertProtectedTargetReceiptPath(
          repositoryRoot,
          options.receiptPath,
        );
        return loadProtectedTargetDeploymentRecovery({
          repositoryRoot,
          receiptPath: options.receiptPath,
          plan,
        });
      })()
    : { envelope: null, transactionHash: null };
  const operatorToken = randomBytes(32).toString("hex");
  const nonce = randomBytes(18).toString("base64");
  let lastEnvelope = recovery.envelope;
  let recoveredTransactionHash = recovery.transactionHash;
  let recoveryLocked = lastEnvelope !== null;
  let finalReceipt = null;
  const preflight = () =>
    preflightMainTokenMigrationTargetDeployment({
      plan,
      rpcUrls: endpoints.robinhood,
      maximumFeePerGasWei: options.maximumFeePerGasWei,
      maximumPriorityFeePerGasWei: options.maximumPriorityFeePerGasWei,
      maximumGasCostWei: options.maximumGasCostWei,
      rpcClient,
    });
  const server = createHttpServer(async (request, response) => {
    const origin = `http://127.0.0.1:${options.port}`;
    if (
      request.headers.host !== `127.0.0.1:${options.port}` ||
      (request.method === "POST" && request.headers.origin !== origin)
    ) {
      sendJson(response, 403, { error: "Loopback origin rejected" });
      return;
    }
    try {
      if (request.method === "GET" && request.url === "/") {
        const bytes = Buffer.from(
          html({
            plan,
            write: options.write,
            operatorToken,
            nonce,
            recovery: {
              envelope: recoveryLocked ? lastEnvelope : null,
              transactionHash: recoveredTransactionHash,
            },
          }),
          "utf8",
        );
        response.writeHead(200, {
          ...securityHeaders(nonce),
          "content-type": "text/html; charset=utf-8",
          "content-length": bytes.length,
        });
        response.end(bytes);
        return;
      }
      if (request.headers["x-operator-token"] !== operatorToken) {
        sendJson(response, 403, { error: "Operator token rejected" });
        return;
      }
      if (request.method === "GET" && request.url === "/inspection") {
        if (!recoveryLocked) lastEnvelope = await preflight();
        sendJson(response, 200, { plan, envelope: lastEnvelope, write: options.write });
        return;
      }
      if (request.method === "POST" && request.url === "/authorize") {
        if (!options.write) fail("server is read-only; restart with --write");
        if (recoveryLocked) {
          fail("an authorized recovery attempt already exists for this receipt path");
        }
        const body = await readJsonBody(request);
        if (
          !lastEnvelope ||
          body.envelopeDigest !== lastEnvelope.envelopeDigest
        ) {
          fail("inspection envelope changed; refresh first");
        }
        lastEnvelope = await revalidateMainTokenMigrationTargetWalletRequest({
          plan,
          envelope: lastEnvelope,
          connectedAccount: body.account,
          walletChainId: body.chainId,
          rpcUrls: endpoints.robinhood,
          maximumFeePerGasWei: options.maximumFeePerGasWei,
          maximumPriorityFeePerGasWei: options.maximumPriorityFeePerGasWei,
          maximumGasCostWei: options.maximumGasCostWei,
          rpcClient,
        });
        await writeProtectedTargetAuthorizationCheckpoint({
          repositoryRoot,
          receiptPath: options.receiptPath,
          plan,
          envelope: lastEnvelope,
        });
        recoveryLocked = true;
        sendJson(response, 200, { envelope: lastEnvelope });
        return;
      }
      if (request.method === "POST" && request.url === "/submitted") {
        if (!options.write) fail("server is read-only; restart with --write");
        const body = await readJsonBody(request);
        if (
          !recoveryLocked ||
          !lastEnvelope ||
          body.envelopeDigest !== lastEnvelope.envelopeDigest
        ) {
          fail("submitted transaction does not bind the authorized envelope");
        }
        const checkpoint = await writeProtectedTargetSubmissionCheckpoint({
          repositoryRoot,
          receiptPath: options.receiptPath,
          plan,
          envelope: lastEnvelope,
          transactionHash: body.transactionHash,
        });
        recoveredTransactionHash = checkpoint.transactionHash;
        sendJson(response, 200, {
          state: checkpoint.state,
          transactionHash: checkpoint.transactionHash,
        });
        return;
      }
      if (request.method === "POST" && request.url === "/record") {
        if (!options.write) fail("server is read-only; restart with --write");
        if (finalReceipt) {
          sendJson(response, 200, { receipt: finalReceipt });
          return;
        }
        const body = await readJsonBody(request);
        if (
          !lastEnvelope ||
          body.envelopeDigest !== lastEnvelope.envelopeDigest ||
          String(body.transactionHash ?? "").toLowerCase() !==
            recoveredTransactionHash
        ) {
          fail("transaction does not bind the durable submitted checkpoint");
        }
        const candidateReceipt =
          await verifyMainTokenMigrationTargetDeploymentFinality({
            plan,
            envelope: lastEnvelope,
            transactionHash: body.transactionHash,
            rpcUrls: endpoints.robinhood,
            ethereumRpcUrls: endpoints.ethereum,
            ethereumPostingBlock:
              body.ethereumPostingBlock ?? options.ethereumPostingBlock,
            rpcClient,
          });
        await writeProtectedTargetDeploymentReceipt({
          repositoryRoot,
          receiptPath: options.receiptPath,
          receipt: candidateReceipt,
        });
        finalReceipt = candidateReceipt;
        sendJson(response, 200, { receipt: finalReceipt });
        return;
      }
      sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      const pending = /not finalized yet|posting block|finality/iu.test(
        error instanceof Error ? error.message : String(error),
      );
      sendJson(response, pending ? 409 : 400, { error: safeError(error) });
    }
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(options.port, "127.0.0.1", resolveListen);
  });
  process.stdout.write(
    `MIGRATION_TARGET_OPERATOR_READY http://127.0.0.1:${options.port} ${
      options.write ? "WRITE_REQUIRES_WALLET" : "READ_ONLY"
    } ${plan.preparedDigest}\n`,
  );
  return { server, plan, options };
}

const invoked = process.argv[1] ? resolve(process.argv[1]) : null;
if (invoked === fileURLToPath(import.meta.url)) {
  runMainTokenMigrationTargetOperator().catch((error) => {
    process.stderr.write(`${safeError(error)}\n`);
    process.exitCode = 1;
  });
}
