import { createHash } from "node:crypto";

import { keccak256 } from "viem";

export const UNISWAP_PINNED_COMMIT = "4cfc406c8e34da3ce04e60657a7825075b64fd22";
export const UNISWAP_PINNED_URL = `https://raw.githubusercontent.com/Uniswap/contracts/${UNISWAP_PINNED_COMMIT}/deployments/json/4663.json`;
export const UNISWAP_CURRENT_URL =
  "https://raw.githubusercontent.com/Uniswap/contracts/main/deployments/json/4663.json";
export const SAFE_DEPLOYMENTS_PINNED_COMMIT =
  "0974182c16c57ca6fe2b9bba8cffb8a7e55fb83c";
export const SAFE_DEPLOYMENTS_BASE_URL = `https://raw.githubusercontent.com/safe-global/safe-deployments/${SAFE_DEPLOYMENTS_PINNED_COMMIT}/src/assets/v1.4.1`;
export const SAFE_DEPLOYMENTS_CURRENT_BASE_URL =
  "https://raw.githubusercontent.com/safe-global/safe-deployments/main/src/assets/v1.4.1";

const UNISWAP_KEYS = Object.freeze({
  poolManager: "PoolManager",
  positionManager: "PositionManager",
  v4Quoter: "V4Quoter",
  stateView: "StateView",
  permit2: "Permit2",
  universalRouter: "UniversalRouter",
});

const SAFE_KEYS = Object.freeze({
  safeSingleton: "safe.json",
  safeL2Singleton: "safe_l2.json",
  safeProxyFactory: "safe_proxy_factory.json",
  compatibilityFallbackHandler: "compatibility_fallback_handler.json",
  multiSend: "multi_send.json",
  multiSendCallOnly: "multi_send_call_only.json",
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeAddress(value, label) {
  assert(/^0x[0-9a-f]{40}$/iu.test(value ?? ""), `${label} is not an address`);
  return value.toLowerCase();
}

export function sha256Hex(value) {
  return `0x${createHash("sha256").update(value).digest("hex")}`;
}

export function verifyUniswapRegistry({ registry, expectedBindings }) {
  assert(
    String(registry?.chainId) === "4663",
    "Uniswap registry is not chain 4663",
  );
  assert(
    registry.latest && typeof registry.latest === "object",
    "Uniswap latest deployment map is missing",
  );

  for (const [bindingKey, registryKey] of Object.entries(UNISWAP_KEYS)) {
    const expected = expectedBindings?.[bindingKey];
    const official = registry.latest?.[registryKey];
    assert(expected, `Expected Uniswap binding ${bindingKey} is missing`);
    assert(official, `Official Uniswap binding ${registryKey} is missing`);
    assert(
      normalizeAddress(official.address, `Uniswap ${registryKey}`) ===
        normalizeAddress(expected.address, `expected ${bindingKey}`),
      `Uniswap registry drift for ${bindingKey}: expected ${expected.address}, received ${official.address}`,
    );
  }

  const currentUniversalRouter = normalizeAddress(
    registry.latest.UniversalRouter.address,
    "Uniswap UniversalRouter",
  );
  assert(
    currentUniversalRouter !== "0x8876789976decbfcbbbe364623c63652db8c0904",
    "Orphaned Robinhood Universal Router must never become the current binding",
  );

  return { verifiedCount: Object.keys(UNISWAP_KEYS).length };
}

export function verifySafeDeploymentRecord({
  record,
  chainId = "4663",
  expectedAddress,
  label,
}) {
  assert(record?.version === "1.4.1", `${label} is not Safe 1.4.1`);
  const deploymentKey = record?.networkAddresses?.[chainId];
  const deploymentNames = Array.isArray(deploymentKey)
    ? deploymentKey
    : [deploymentKey];
  assert(
    deploymentNames.includes("canonical"),
    `${label} has no canonical chain ${chainId} deployment`,
  );
  const actual = record?.deployments?.canonical?.address;
  assert(
    normalizeAddress(actual, `${label} canonical address`) ===
      normalizeAddress(expectedAddress, `${label} expected address`),
    `Safe deployment registry drift for ${label}: expected ${expectedAddress}, received ${actual}`,
  );
  return { address: actual };
}

export function verifySafeRegistries({ records, expectedBindings }) {
  for (const [bindingKey, file] of Object.entries(SAFE_KEYS)) {
    const expected = expectedBindings?.[bindingKey];
    assert(expected, `Expected Safe binding ${bindingKey} is missing`);
    verifySafeDeploymentRecord({
      record: records?.[file],
      expectedAddress: expected.address,
      label: bindingKey,
    });
  }
  return { verifiedCount: Object.keys(SAFE_KEYS).length };
}

async function rpcRequest({ rpcUrl, fetchImpl, method, params, id }) {
  const response = await fetchImpl(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  assert(response.ok, `Robinhood RPC returned HTTP ${response.status}`);
  const payload = await response.json();
  assert(
    !payload.error,
    `Robinhood RPC ${method} failed: ${payload.error?.message ?? "unknown error"}`,
  );
  assert(
    payload.result !== undefined,
    `Robinhood RPC ${method} returned no result`,
  );
  return payload.result;
}

export async function fetchRobinhoodRuntimeSnapshot({
  rpcUrl,
  bindings,
  blockTag = "latest",
  fetchImpl = fetch,
}) {
  const chainIdHex = await rpcRequest({
    rpcUrl,
    fetchImpl,
    method: "eth_chainId",
    params: [],
    id: 1,
  });
  const chainId = Number.parseInt(chainIdHex, 16);
  assert(chainId === 4663, `RPC chain ID ${chainId} is not Robinhood Mainnet`);

  const block = await rpcRequest({
    rpcUrl,
    fetchImpl,
    method: "eth_getBlockByNumber",
    params: [blockTag, false],
    id: 2,
  });
  assert(
    block?.number && block?.hash && block?.timestamp,
    "Robinhood block identity is incomplete",
  );

  const entries = await Promise.all(
    Object.entries(bindings).map(async ([key, binding], index) => {
      const code = await rpcRequest({
        rpcUrl,
        fetchImpl,
        method: "eth_getCode",
        params: [binding.address, block.number],
        id: index + 3,
      });
      assert(
        /^0x[0-9a-f]*$/iu.test(code),
        `${key} returned invalid runtime code`,
      );
      return [
        key,
        { code, runtimeCodeHash: code === "0x" ? null : keccak256(code) },
      ];
    }),
  );

  return {
    chainId,
    blockNumber: Number.parseInt(block.number, 16),
    blockHash: block.hash,
    blockTimestamp: Number.parseInt(block.timestamp, 16),
    contracts: Object.fromEntries(entries),
  };
}

export function verifyRuntimeSnapshot({
  snapshot,
  expectedBindings,
  expectVacant = false,
}) {
  let verifiedCount = 0;
  for (const [key, binding] of Object.entries(expectedBindings)) {
    const observed = snapshot?.contracts?.[key];
    assert(observed, `Runtime snapshot is missing ${key}`);
    if (expectVacant) {
      assert(
        observed.code === "0x",
        `${key} predicted address is no longer vacant`,
      );
    } else {
      assert(observed.code !== "0x", `${key} has no runtime code`);
      assert(
        observed.runtimeCodeHash?.toLowerCase() ===
          binding.runtimeCodeHash?.toLowerCase(),
        `${key} runtime hash drift: expected ${binding.runtimeCodeHash}, received ${observed.runtimeCodeHash}`,
      );
    }
    verifiedCount += 1;
  }
  return { verifiedCount };
}

export async function fetchJsonText(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    headers: { accept: "application/json" },
  });
  assert(response.ok, `${url} returned HTTP ${response.status}`);
  const text = await response.text();
  return { text, json: JSON.parse(text) };
}

export async function fetchSafeRegistrySet(baseUrl, fetchImpl = fetch) {
  return Object.fromEntries(
    await Promise.all(
      Object.values(SAFE_KEYS).map(async (file) => {
        const { json } = await fetchJsonText(`${baseUrl}/${file}`, fetchImpl);
        return [file, json];
      }),
    ),
  );
}
