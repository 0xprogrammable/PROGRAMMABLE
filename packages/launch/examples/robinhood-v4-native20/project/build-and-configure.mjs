#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import solc from "solc";

if (process.argv.includes("--help")) {
  process.stdout.write("Native20 no-broadcast build: node build-and-configure.mjs --input native20-input.json\nInput requires launchWallet, nonce, publicOrigin, projectMetadata, checkedAt, minimumTokensOut and an explicit fundingPlan.\nOptional PROGRAMMABLE_LAUNCH_MODULE_PATH points to an extracted CLI 4.1 src/index.mjs.\nBuild-only remains local pack/preflight; zero launch ETH still requires gas for a live launch.\n");
  process.exit(0);
}
if (process.argv.length !== 4 || process.argv[2] !== "--input") throw new TypeError("required: --input native20-input.json");
if (Object.hasOwn(process.env, "PROGRAMMABLE_API_KEY")) throw new TypeError("this unauthenticated builder refuses PROGRAMMABLE_API_KEY");
const moduleUrl = process.env.PROGRAMMABLE_LAUNCH_MODULE_PATH
  ? pathToFileURL(path.resolve(process.env.PROGRAMMABLE_LAUNCH_MODULE_PATH)).href
  : new URL("../../../src/index.mjs", import.meta.url).href;
const launch = await import(moduleUrl);
if (typeof launch.buildRobinhoodNative20ExampleV41 !== "function") throw new TypeError("use the verified CLI 4.1 source package");
const input = JSON.parse(await readFile(path.resolve(process.argv[3]), "utf8"));
const [capabilitiesResult, initialBuyQuote] = await Promise.all([
  launch.getLaunchCapabilities({ apiVersion: 4, chainId: "4663" }), launch.getRobinhoodInitialBuyQuoteV1(),
]);
const capabilities = capabilitiesResult.resource;
launch.assertInitialBuyWithinServerReferenceV1(input.fundingPlan, initialBuyQuote);
const [rpcChainId, block] = await Promise.all([
  rpc("eth_chainId", []), rpc("eth_getBlockByNumber", ["finalized", false]),
]);
const quantity = /^0x(?:0|[1-9a-f][0-9a-f]*)$/u;
const now = BigInt(Math.floor(Date.parse(capabilities.serverTime) / 1000));
if (!quantity.test(rpcChainId ?? "") || BigInt(rpcChainId) !== 4663n
  || !quantity.test(block?.number ?? "") || !quantity.test(block?.timestamp ?? "")
  || !/^0x[0-9a-f]{64}$/u.test(block?.hash ?? "")) throw new TypeError("a Robinhood finalized checkpoint is required");
const timestamp = BigInt(block.timestamp);
const validAfter = timestamp - 60n;
const deadline = validAfter + 3600n;
if (timestamp > now || validAfter < now - 3600n || deadline < now + 300n) throw new TypeError("finalized checkpoint cannot provide a fresh permit window");
const result = await launch.buildRobinhoodNative20ExampleV41({ projectRoot: process.cwd(), capabilities,
  input, permitWindow: { validAfter: validAfter.toString(), deadline: deadline.toString() }, solc });
process.stdout.write(`${JSON.stringify({ configPath: result.configPath, profile: result.config.profile,
  launchMode: result.config.fundingPlan.launchMode, launchValueWei: result.config.funding.valueWei, initialBuyQuote, minimumTokensOut: input.minimumTokensOut, maxGasCostWei: result.config.fundingPlan.maxGasCostWei,
  launchIntentHash: result.built.launchIntentHash, signing: false, broadcast: false }, null, 2)}\n`);

async function rpc(method, params) {
  const response = await fetch("https://rpc.mainnet.chain.robinhood.com", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    redirect: "error", signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new TypeError(`Robinhood checkpoint unavailable: HTTP ${response.status}`);
  const body = await response.json();
  if (body.jsonrpc !== "2.0" || body.id !== 1 || body.error || body.result == null) throw new TypeError("invalid Robinhood checkpoint RPC response");
  return body.result;
}
