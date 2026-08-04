import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import {
  decodeCaveat,
  decodeDelegations,
} from "@metamask/smart-accounts-kit/utils";
import { getSmartAccountsEnvironment } from "@metamask/smart-accounts-kit";
import {
  encodeDeployData,
  getAddress,
  getContractAddress,
  isAddressEqual,
  isHex,
  keccak256,
} from "viem";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PROTOCOL_REVENUE_V2_ACTIVATION_PORT ?? 4192);
const RPC_URL = process.env.ETHEREUM_RPC_URL ??
  "https://ethereum-rpc.publicnode.com";
const DEPLOYER = getAddress("0x2Bb333d48DFAF1596D9036671d2E43168994249E");
const REVENUE_AUTHORITY = getAddress("0x4957f49620AFf3Adbbe8195a4f633E49cc93376c");
const KEEPER = getAddress("0xD00fDE8d640E20542a323302537FdCD8CB14cc08");
const STARTING_NONCE = 190n;
const COORDINATOR = getContractAddress({ from: DEPLOYER, nonce: STARTING_NONCE });
const VAULT = getContractAddress({ from: DEPLOYER, nonce: STARTING_NONCE + 1n });
const COORDINATOR_RUNTIME_CODE_HASH =
  "0x964700ee05f1a6dadee5e1fe241b8e5ac6e141e51c69357eba14eae3a0263d39";
const VAULT_RUNTIME_CODE_HASH =
  "0x55ef6e1f4735086f17d65d122e422469d3fdc2f6ff6cddbec3c21ed5d436417c";
const SMART_ACCOUNTS_ENVIRONMENT = getSmartAccountsEnvironment(1);
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const permissionPath = path.resolve(
  process.env.PROTOCOL_REVENUE_V2_PERMISSION_PATH ??
    "/private/tmp/programmable-protocol-revenue-v2-permission.json",
);
const bundlePath = "/private/tmp/programmable-protocol-revenue-v2-activation.js";

async function rpc(method, params = []) {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(`Ethereum RPC ${method} failed`);
  }
  return payload.result;
}

async function artifact(contractName) {
  const filename = path.join(
    repositoryRoot,
    "contracts/out",
    `${contractName}.sol`,
    `${contractName}.json`,
  );
  return JSON.parse(await readFile(filename, "utf8"));
}

async function reviewedDeployData() {
  const [coordinatorArtifact, vaultArtifact] = await Promise.all([
    artifact("ProtocolRevenueClaimCoordinatorV2"),
    artifact("ProtocolRevenueVaultV2"),
  ]);
  return {
    coordinatorData: encodeDeployData({
      abi: coordinatorArtifact.abi,
      bytecode: coordinatorArtifact.bytecode.object,
      args: [KEEPER],
    }),
    vaultData: encodeDeployData({
      abi: vaultArtifact.abi,
      bytecode: vaultArtifact.bytecode.object,
      args: [KEEPER],
    }),
    // Exact Mainnet runtime commitments include constructor-patched immutables.
    coordinatorRuntimeCodeHash: COORDINATOR_RUNTIME_CODE_HASH,
    vaultRuntimeCodeHash: VAULT_RUNTIME_CODE_HASH,
  };
}

async function deploymentState(reviewed) {
  const [chainId, confirmedNonce, pendingNonce, coordinatorCode, vaultCode] =
    await Promise.all([
      rpc("eth_chainId"),
      rpc("eth_getTransactionCount", [DEPLOYER, "latest"]),
      rpc("eth_getTransactionCount", [DEPLOYER, "pending"]),
      rpc("eth_getCode", [COORDINATOR, "latest"]),
      rpc("eth_getCode", [VAULT, "latest"]),
    ]);
  if (chainId !== "0x1") throw new Error("RPC is not Ethereum Mainnet");
  const coordinatorDeployed = coordinatorCode !== "0x";
  const vaultDeployed = vaultCode !== "0x";
  const coordinatorCodeHash = coordinatorDeployed
    ? keccak256(coordinatorCode)
    : null;
  const vaultCodeHash = vaultDeployed ? keccak256(vaultCode) : null;
  if (
    (coordinatorDeployed &&
      coordinatorCodeHash !== reviewed.coordinatorRuntimeCodeHash) ||
    (vaultDeployed && vaultCodeHash !== reviewed.vaultRuntimeCodeHash)
  ) {
    throw new Error("Deployed runtime code differs from the reviewed artifacts");
  }
  const expectedNonce = STARTING_NONCE +
    BigInt(coordinatorDeployed ? 1 : 0) +
    BigInt(vaultDeployed ? 1 : 0);
  const confirmed = BigInt(confirmedNonce);
  const pending = BigInt(pendingNonce);
  const deploymentComplete = coordinatorDeployed && vaultDeployed;
  const nonceInvalid = deploymentComplete
    ? confirmed < expectedNonce || pending < confirmed
    : confirmed !== expectedNonce || pending !== expectedNonce;
  if (nonceInvalid) {
    throw new Error("Deployment wallet nonce differs from the reviewed two-transaction plan");
  }
  let permissionSaved = false;
  try {
    const permission = JSON.parse(await readFile(permissionPath, "utf8"));
    permissionSaved = isHex(permission.context) &&
      isAddressEqual(permission.delegationManager, SMART_ACCOUNTS_ENVIRONMENT.DelegationManager);
  } catch {
    permissionSaved = false;
  }
  return {
    coordinatorDeployed,
    vaultDeployed,
    coordinatorCodeHash,
    vaultCodeHash,
    permissionSaved,
  };
}

function validatePermission(payload) {
  if (
    payload.chainId !== 1 ||
    !isAddressEqual(payload.from, REVENUE_AUTHORITY) ||
    !isAddressEqual(payload.to, KEEPER) ||
    payload.type !== "native-token-periodic" ||
    payload.periodAmount !== "5000000000000000000" ||
    payload.periodDuration !== 86_400 ||
    !isHex(payload.context) ||
    !isAddressEqual(payload.delegationManager, SMART_ACCOUNTS_ENVIRONMENT.DelegationManager)
  ) {
    throw new Error("Permission metadata differs from the reviewed policy");
  }
  const delegation = decodeDelegations(payload.context)[0];
  if (
    !delegation ||
    !isAddressEqual(delegation.delegator, REVENUE_AUTHORITY) ||
    !isAddressEqual(delegation.delegate, KEEPER)
  ) {
    throw new Error("Permission delegation binding differs from the reviewed policy");
  }
  const caveats = delegation.caveats.map((caveat) =>
    decodeCaveat({ caveat, environment: SMART_ACCOUNTS_ENVIRONMENT })
  );
  const period = caveats.find((caveat) => caveat.type === "nativeTokenPeriodTransfer");
  const calldata = caveats.find((caveat) => caveat.type === "exactCalldata");
  const redeemer = caveats.find((caveat) => caveat.type === "redeemer");
  const target = caveats.find((caveat) => caveat.type === "allowedTargets");
  const payment = caveats.find((caveat) => caveat.type === "nativeTokenPayment");
  const expiry = caveats.find((caveat) => caveat.type === "timestamp");
  const payeeBound =
    (target?.type === "allowedTargets" && target.targets.length === 1 && isAddressEqual(target.targets[0], VAULT)) ||
    (payment?.type === "nativeTokenPayment" && isAddressEqual(payment.recipient, VAULT));
  if (
    period?.type !== "nativeTokenPeriodTransfer" ||
    period.periodAmount !== 5n * 10n ** 18n ||
    period.periodDuration !== 86_400 ||
    calldata?.type !== "exactCalldata" ||
    calldata.calldata !== "0x" ||
    redeemer?.type !== "redeemer" ||
    redeemer.redeemers.length !== 1 ||
    !isAddressEqual(redeemer.redeemers[0], KEEPER) ||
    expiry?.type !== "timestamp" ||
    expiry.beforeThreshold <= Math.floor(Date.now() / 1_000) ||
    !caveats.some((caveat) => caveat.type === "nonce") ||
    !payeeBound
  ) {
    throw new Error("Permission caveats differ from the reviewed policy");
  }
  return {
    version: 2,
    savedAt: new Date().toISOString(),
    context: payload.context,
    delegationManager: getAddress(payload.delegationManager),
    expiry: payload.expiry,
  };
}

function page(deployData) {
  const configuration = JSON.stringify({
    deployer: DEPLOYER,
    revenueAuthority: REVENUE_AUTHORITY,
    keeper: KEEPER,
    coordinator: COORDINATOR,
    vault: VAULT,
    coordinatorData: deployData.coordinatorData,
    vaultData: deployData.vaultData,
    startingNonce: STARTING_NONCE.toString(),
  }).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Programmable Revenue Activation</title>
  <style>
    :root { color: #19171a; background: #f7f4f6; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 32px; }
    main { width: min(680px, 100%); background: rgba(255,255,255,.94); border: 1px solid #eadfe6; border-radius: 28px; padding: 32px; box-shadow: 0 20px 80px rgba(54,35,49,.08); }
    h1 { margin: 0 0 8px; font-size: 28px; letter-spacing: -.035em; }
    p { margin: 0; color: #6b6168; line-height: 1.55; }
    .terms { margin: 28px 0; display: grid; gap: 1px; overflow: hidden; border: 1px solid #eadfe6; border-radius: 18px; background: #eadfe6; }
    .term { display: flex; justify-content: space-between; gap: 24px; padding: 14px 16px; background: white; font-size: 14px; }
    .term span:last-child { color: #6b6168; text-align: right; }
    .actions { display: grid; gap: 10px; }
    button { width: 100%; border: 0; border-radius: 14px; padding: 14px 18px; font: inherit; font-weight: 650; color: #24151f; background: #efb8d8; cursor: pointer; }
    button:disabled { cursor: default; color: #9a9096; background: #f0ecef; }
    [data-status] { min-height: 24px; margin-top: 18px; font-size: 14px; }
    [data-status][data-error="true"] { color: #a82d55; }
  </style>
</head>
<body>
  <main>
    <h1>Protocol revenue activation</h1>
    <p>Two immutable contracts and one readable MetaMask permission. Automation remains disabled after these steps.</p>
    <div class="terms">
      <div class="term"><span>Cadence</span><span>Once per 24 hours</span></div>
      <div class="term"><span>Wallet limit</span><span>Maximum 5 ETH per day</span></div>
      <div class="term"><span>Only payee</span><span>${VAULT}</span></div>
      <div class="term"><span>Split</span><span>50% treasury · 49.5% V4 · 0.5% gas</span></div>
      <div class="term"><span>Permission expiry</span><span>One year</span></div>
    </div>
    <div class="actions">
      <button data-deploy-coordinator>Deploy Claim Coordinator</button>
      <button data-deploy-vault disabled>Deploy Revenue Vault</button>
      <button data-grant-permission disabled>Grant bounded daily permission</button>
    </div>
    <p data-status>Checking reviewed deployment state</p>
  </main>
  <script>window.PROGRAMMABLE_REVENUE_ACTIVATION=${configuration};</script>
  <script src="/activation.js"></script>
</body>
</html>`;
}

await build({
  entryPoints: [path.join(repositoryRoot, "scripts/protocol-revenue-v2-activation-client.ts")],
  outfile: bundlePath,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome120"],
  minify: true,
});
const deployData = await reviewedDeployData();
await deploymentState(deployData);

const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end(page(deployData));
      return;
    }
    if (request.method === "GET" && request.url === "/activation.js") {
      const bundle = await readFile(bundlePath);
      response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
      response.end(bundle);
      return;
    }
    if (request.method === "GET" && request.url === "/state") {
      const state = await deploymentState(deployData);
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify(state));
      return;
    }
    if (request.method === "POST" && request.url === "/permission") {
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 100_000) throw new Error("Permission response is too large");
      }
      const validated = validatePermission(JSON.parse(body));
      await mkdir(path.dirname(permissionPath), { recursive: true });
      await writeFile(permissionPath, `${JSON.stringify(validated)}\n`, { mode: 0o600 });
      await chmod(permissionPath, 0o600);
      response.writeHead(204, { "cache-control": "no-store" });
      response.end();
      return;
    }
    response.writeHead(404).end();
  } catch {
    if (!response.headersSent) {
      response.writeHead(400, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify({ error: "Activation request rejected" }));
    } else {
      response.destroy();
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Protocol revenue V2 activation console: http://${HOST}:${PORT}`);
  console.log(`Coordinator: ${COORDINATOR}`);
  console.log(`Vault: ${VAULT}`);
});
