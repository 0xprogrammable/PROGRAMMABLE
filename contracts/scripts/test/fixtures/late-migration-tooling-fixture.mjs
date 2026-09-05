import { readFile } from "node:fs/promises";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionResult,
  getContractAddress,
  numberToHex,
  parseAbiItem,
} from "viem";
import {
  EXPECTED,
  sourceArtifactBytes,
  TOKEN_ABI,
} from "../../late-migration-deployment-preflight-core.mjs";
import {
  lateMigrationEndpointCommitment,
  productionProvidersFromEnvironment,
  SOURCE_ABI,
} from "../../late-migration-deployment-stages-core.mjs";
const root = new URL("../../../../", import.meta.url);
const json = async (name) =>
  JSON.parse(await readFile(new URL(name, root), "utf8"));
const [preflight, releaseActivation, inertBindings, eligibility, creation, runtime] =
  await Promise.all([
    json("config/late-migration-deployment-preflight.v1.json"),
    json("config/late-migration-intake-activation.v1.json"),
    json("tests/fixtures/late-migration-intake-inert.v1.json"),
    json("config/late-migration-eligibility.v1.json"),
    json(
      "contracts/scripts/test/fixtures/late-migration-creation-code.v1.json",
    ),
    json("contracts/scripts/test/fixtures/late-migration-runtime-code.v1.json"),
  ]);
export function inputs() {
  return structuredClone({
    preflight,
    // Keep the frozen round from the release; deployment scenarios begin
    // before source deployment even after the runtime manifest is activated.
    activation: { ...releaseActivation, ...inertBindings },
    eligibility,
    artifacts: {
      source: {
        bytecode: { object: creation.source },
        deployedBytecode: creation.deployedBytecode,
      },
    },
  });
}
export const deploymentHash = `0x${"d1".repeat(32)}`;
export const activationHash = `0x${"a1".repeat(32)}`;
export const blockHash = (n) => `0x${BigInt(n).toString(16).padStart(64, "0")}`;
const sourceAddress = getContractAddress({ from: EXPECTED.owner, nonce: 10n });
export function fixture({
  activated = false,
  mutate = (value) => value,
  nowSeconds = Math.floor(Date.now() / 1000),
} = {}) {
  const args = inputs();
  const bytes = sourceArtifactBytes(args.artifacts.source, args.preflight);
  const trace = [];
  function block(n) {
    return {
      number: numberToHex(n),
      hash: blockHash(n),
      timestamp: numberToHex(BigInt(nowSeconds - 60)),
      transactions:
        n === 900n ? [deploymentHash] : n === 950n ? [activationHash] : [],
    };
  }
  function transaction(activationTx) {
    const n = activationTx ? 950n : 900n;
    return {
      hash: activationTx ? activationHash : deploymentHash,
      type: "0x2",
      chainId: "0x1",
      from: EXPECTED.owner,
      to: activationTx ? sourceAddress : null,
      value: "0x0",
      nonce: activationTx ? "0xb" : "0xa",
      input: activationTx ? "0xe5703512" : bytes.initcode,
      blockNumber: numberToHex(n),
      blockHash: blockHash(n),
      transactionIndex: "0x0",
    };
  }
  const activatedEvent = parseAbiItem(
    "event DepositsActivated(bytes32 indexed roundId,address indexed previousAuthority,uint256 activatedAtBlock)",
  );
  function receipt(activationTx) {
    const tx = transaction(activationTx);
    return {
      transactionHash: tx.hash,
      type: "0x2",
      from: tx.from,
      to: tx.to,
      contractAddress: activationTx ? null : sourceAddress,
      status: "0x1",
      blockNumber: tx.blockNumber,
      blockHash: tx.blockHash,
      transactionIndex: "0x0",
      logs: activationTx
        ? [
            {
              address: sourceAddress,
              transactionHash: tx.hash,
              transactionIndex: "0x0",
              blockNumber: tx.blockNumber,
              blockHash: tx.blockHash,
              logIndex: "0x2",
              removed: false,
              topics: encodeEventTopics({
                abi: [activatedEvent],
                eventName: "DepositsActivated",
                args: {
                  roundId: EXPECTED.roundId,
                  previousAuthority: EXPECTED.owner,
                },
              }),
              data: encodeAbiParameters([{ type: "uint256" }], [950n]),
            },
          ]
        : [],
    };
  }
  async function request(method, params, index) {
    trace.push({ method, params, index });
    let value;
    if (method === "eth_chainId") value = "0x1";
    else if (method === "eth_blockNumber") value = "0x400";
    else if (method === "eth_getBlockByNumber")
      value = block(params[0] === "finalized" ? 1000n : BigInt(params[0]));
    else if (method === "eth_getTransactionCount") value = "0xb";
    else if (method === "eth_getCode")
      value =
        params[0].toLowerCase() === EXPECTED.oldToken.toLowerCase()
          ? runtime.oldToken
          : params[0].toLowerCase() === sourceAddress.toLowerCase()
            ? bytes.runtimeCode
            : "0x";
    else if (method === "eth_estimateGas")
      value = params[0].to ? "0x186a0" : "0x1e8480";
    else if (method === "eth_getTransactionByHash")
      value = transaction(params[0] === activationHash);
    else if (method === "eth_getTransactionReceipt")
      value = receipt(params[0] === activationHash);
    else if (method === "eth_call") {
      const old =
        params[0].to.toLowerCase() === EXPECTED.oldToken.toLowerCase();
      const abi = old ? TOKEN_ABI : SOURCE_ABI;
      const decoded = decodeFunctionData({ abi, data: params[0].data });
      const values = {
        DOMAIN_SEPARATOR: EXPECTED.oldTokenDomainSeparator,
        decimals: 18,
        totalSupply: BigInt(EXPECTED.totalSupplyRaw),
        oldToken: EXPECTED.oldToken,
        activationAuthority: activated
          ? "0x0000000000000000000000000000000000000000"
          : EXPECTED.owner,
        depositsOpen: activated,
        activatedAtBlock: activated ? 950n : 0n,
        depositedOfferCount: 0n,
        depositedGrossTotal: 0n,
        depositedPayoutTotal: 0n,
        ROUND_ID: EXPECTED.roundId,
        eligibilityRoot: EXPECTED.eligibilityRoot,
        OLD_TOKEN_RECIPIENT: EXPECTED.oldTokenRecipient,
        TARGET_CHAIN_ID: 4663n,
        TARGET_TOKEN: EXPECTED.manualPayoutToken,
        PAYOUT_BPS: 8000n,
      };
      value = ["activateDeposits", "assertPinnedOldToken"].includes(
        decoded.functionName,
      )
        ? "0x"
        : encodeFunctionResult({
            abi,
            functionName: decoded.functionName,
            result: values[decoded.functionName],
          });
    } else throw new Error(`unexpected RPC ${method}`);
    return mutate(structuredClone(value), method, params, index);
  }
  const providers = ["alpha", "beta"].map((name, index) =>
    Object.freeze({
      id: name,
      trustDomain: `${name}.test`,
      request: (method, params) => request(method, params, index),
    }),
  );
  function production() {
    const entries = ["alpha", "beta"].map((name) => ({
      id: name,
      trustDomain: `${name}.test`,
      url: `https://rpc.${name}.test`,
      headers: { authorization: "Bearer test-only-not-a-secret" },
    }));
    entries.forEach((entry) => {
      entry.endpointCommitmentSha256 = lateMigrationEndpointCommitment(entry);
    });
    return productionProvidersFromEnvironment({
      env: {
        LATE_MIGRATION_ETHEREUM_PRODUCTION_PROVIDERS_JSON:
          JSON.stringify(entries),
      },
      policy: args.preflight.activationProviderPolicy,
      fetchImpl: async (url, options) => {
        const body = JSON.parse(options.body);
        const value = await request(
          body.method,
          body.params,
          url.includes("alpha") ? 0 : 1,
        );
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: body.id, result: value }),
          { headers: { "content-type": "application/json" } },
        );
      },
    });
  }
  return {
    ...args,
    sourceAddress,
    nowSeconds,
    providers,
    trace,
    production,
    bytes,
  };
}
