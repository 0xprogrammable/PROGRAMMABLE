import {
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  hashTypedData,
  keccak256,
  numberToHex,
  parseAbi,
  parseAbiParameters,
  recoverAddress,
  recoverTransactionAddress,
  serializeTransaction,
} from "viem";
import {
  hashAuthorization,
  hashStruct,
  recoverAuthorizationAddress,
} from "viem/utils";
import {
  EXPECTED,
  address,
  agreedRead,
  assertProviderSet,
  commitment,
  decimal,
  equal as assertEqual,
  fail,
  freeze,
  hash,
  hex,
  quantity,
} from "./late-migration-deployment-preflight-core.mjs";

// MetaMask delegation-framework v1.3.0, independently bound to official source
// and execution-block code. This profile supports only one owner-to-self
// delegation and one zero-value, default-mode activation, not arbitrary batches.
export const METAMASK_ACTIVATION_PROFILE = freeze({
  manager: address("0xdb9b1e94b5b69df7e401ddbede43491141047db3", "manager"),
  implementation: address("0x63c0c19a282a1b52b07dd5a65b58948a07dae32b", "implementation"),
  enforcer: address("0xbd7b277507723490cd50b12eaafe87c616be6880", "enforcer"),
  managerCodehash: "0x762a7ccac3fba1fce7751870298c097c0d050451d9b4a1f0935e65dc4078d1d3",
  implementationCodehash: "0x0b77e469f5603ed1e9ff0e7ee56238b61a8cf7cb3185b33e53e2eeaad50109ab",
  enforcerCodehash: "0x61f455a893e4dcb39599bfcd8f59000e438c52639b278b933e469610c7761b76",
  maximumFeePerGasWei: "200000000",
  maximumPriorityFeePerGasWei: "100000",
});
export const ACTIVATION_TRACE_OPTIONS = freeze({
  tracer: "callTracer",
  timeout: "10s",
  tracerConfig: { withLog: true },
});
const ZERO = `0x${"00".repeat(32)}`;
const ROOT_AUTHORITY = `0x${"ff".repeat(32)}`;
const ACTIVATE = "0xe5703512";
const PRECOMPILE = "0x0000000000000000000000000000000000000001";
const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const DELEGATION_TUPLE = "(address delegate,address delegator,bytes32 authority,(address enforcer,bytes terms,bytes args)[] caveats,uint256 salt,bytes signature)";
const CONTEXT_PARAMETERS = parseAbiParameters(`${DELEGATION_TUPLE}[]`);
const DELEGATION_PARAMETERS = parseAbiParameters(DELEGATION_TUPLE);
const ABI = parseAbi([
  "function redeemDelegations(bytes[] permissionContexts,bytes32[] modes,bytes[] executionCallDatas)",
  "function executeFromExecutor(bytes32 mode,bytes executionCalldata) returns (bytes[])",
  "function isValidSignature(bytes32 digest,bytes signature) view returns (bytes4)",
  ...["beforeAllHook", "beforeHook", "afterHook", "afterAllHook"].map(
    (name) => `function ${name}(bytes terms,bytes args,bytes32 mode,bytes executionCalldata,bytes32 delegationHash,address delegator,address redeemer)`,
  ),
  `event RedeemedDelegation(address indexed rootDelegator,address indexed redeemer,${DELEGATION_TUPLE} delegation)`,
  "event DepositsActivated(bytes32 indexed roundId,address indexed previousAuthority,uint256 activatedAtBlock)",
]);
const TYPES = {
  Delegation: [
    { name: "delegate", type: "address" },
    { name: "delegator", type: "address" },
    { name: "authority", type: "bytes32" },
    { name: "caveats", type: "Caveat[]" },
    { name: "salt", type: "uint256" },
  ],
  Caveat: [
    { name: "enforcer", type: "address" },
    { name: "terms", type: "bytes" },
  ],
};
const callData = (functionName, args) => encodeFunctionData({ abi: ABI, functionName, args });
const q = (value, label) => numberToHex(quantity(value, label));
// RPC quantities become bigint during signature construction. Keep the common
// verifier's canonical comparison while making these internal values JSON-safe.
const comparable = (value) => JSON.parse(JSON.stringify(value, (_key, item) =>
  typeof item === "bigint" ? { bigint: item.toString() } : item));
const equal = (actual, expected, label) => assertEqual(comparable(actual), comparable(expected), label);

function signature(value, label) {
  const yParity = Number(quantity(value.yParity, `${label} parity`));
  const r = hash(value.r, `${label} r`);
  const s = hash(value.s, `${label} s`);
  if (yParity > 1 || BigInt(r) === 0n || BigInt(r) >= SECP256K1_N || BigInt(s) === 0n || BigInt(s) > SECP256K1_N / 2n)
    fail(`${label} is not a canonical signature`);
  return { yParity, r, s };
}
function safeNumber(value, label) {
  const n = quantity(value, label);
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) fail(`${label} exceeds supported integer bound`);
  return Number(n);
}
// A direct destination must not route type-4 transactions around the delegated
// envelope checks. Keep ordinary legacy/access-list/EIP-1559 calls supported.
export async function verifyPlainActivationEnvelope(providers, canonicalTransaction) {
  assertProviderSet(providers);
  const types = await Promise.all(providers.map(async (provider) => {
    const raw = await provider.request("eth_getTransactionByHash", [canonicalTransaction.hash]);
    if (!raw) fail("direct activation transaction unavailable");
    const type = safeNumber(raw.type, "direct transaction type");
    if (![0, 1, 2].includes(type)) fail("direct activation requires plain transaction type 0, 1 or 2");
    if (raw.authorizationList !== undefined && (!Array.isArray(raw.authorizationList) || raw.authorizationList.length !== 0))
      fail("direct activation cannot contain authorizations");
    equal({
      hash: hash(raw.hash, "direct transaction hash"), from: address(raw.from, "direct from"),
      to: address(raw.to, "direct to"), nonce: q(raw.nonce, "direct nonce"), chainId: q(raw.chainId, "direct chain"),
      value: q(raw.value, "direct value"), input: hex(raw.input, "direct input"),
      blockHash: hash(raw.blockHash, "direct block hash"), blockNumber: q(raw.blockNumber, "direct block number"),
      transactionIndex: q(raw.transactionIndex, "direct transaction index"),
    }, canonicalTransaction, "fresh direct/canonical transaction binding");
    return type;
  }));
  for (const type of types.slice(1)) equal(type, types[0], "independent direct transaction type");
}
function signedTransaction(raw) {
  if (!raw || !Array.isArray(raw.authorizationList) || raw.authorizationList.length !== 1)
    fail("wrapped activation requires one authorization");
  equal(q(raw.type, "transaction type"), "0x4", "wrapped transaction type");
  equal(raw.accessList, [], "wrapped access list");
  const sig = signature(raw, "transaction");
  if (raw.v !== undefined) equal(safeNumber(raw.v, "transaction v"), sig.yParity, "transaction parity aliases");
  const auth = raw.authorizationList[0];
  const authorization = {
    chainId: safeNumber(auth.chainId, "authorization chain"),
    address: address(auth.address, "authorization implementation"),
    nonce: safeNumber(auth.nonce, "authorization nonce"),
    ...signature(auth, "authorization"),
  };
  return {
    hash: hash(raw.hash, "transaction hash"),
    from: address(raw.from, "transaction from"),
    blockHash: hash(raw.blockHash, "transaction block hash"),
    blockNumber: q(raw.blockNumber, "transaction block number"),
    transactionIndex: q(raw.transactionIndex, "transaction index"),
    transaction: {
      type: "eip7702",
      chainId: safeNumber(raw.chainId, "transaction chain"),
      nonce: safeNumber(raw.nonce, "transaction nonce"),
      to: address(raw.to, "transaction to"),
      gas: quantity(raw.gas, "transaction gas"),
      value: quantity(raw.value, "transaction value"),
      data: hex(raw.input, "transaction input"),
      maxFeePerGas: quantity(raw.maxFeePerGas, "maximum fee"),
      maxPriorityFeePerGas: quantity(raw.maxPriorityFeePerGas, "priority fee"),
      accessList: [],
      authorizationList: [authorization],
    },
    signature: sig,
  };
}

// Exported for mutation tests. This returns decoded data, never a trusted stage
// context; the stage core alone grants that after authenticated fresh RPC reads.
export async function decodeMetaMaskActivationEnvelope(raw, sourceAddress, maximumActivationGas) {
  const signed = signedTransaction(raw);
  const tx = signed.transaction;
  const source = address(sourceAddress, "derived source");
  equal(signed.from, EXPECTED.owner, "wrapped owner");
  equal(tx.chainId, 1, "wrapped chain");
  equal(tx.to, METAMASK_ACTIVATION_PROFILE.manager, "wrapped manager");
  equal(tx.value, 0n, "wrapped zero value");
  if (tx.gas === 0n || tx.gas > decimal(maximumActivationGas, "maximum activation gas") ||
      tx.maxFeePerGas > BigInt(METAMASK_ACTIVATION_PROFILE.maximumFeePerGasWei) ||
      tx.maxPriorityFeePerGas > BigInt(METAMASK_ACTIVATION_PROFILE.maximumPriorityFeePerGasWei) ||
      tx.maxPriorityFeePerGas > tx.maxFeePerGas)
    fail("wrapped activation gas or fee bound exceeded");
  if (tx.data.length !== 2 + 1124 * 2) fail("wrapped activation calldata size mismatch");
  const decoded = decodeFunctionData({ abi: ABI, data: tx.data });
  equal(decoded.functionName, "redeemDelegations", "wrapped method");
  equal(callData(decoded.functionName, decoded.args), tx.data, "canonical outer calldata");
  const [contexts, modes, executions] = decoded.args;
  equal([contexts.length, modes.length, executions.length], [1, 1, 1], "single activation execution");
  equal(modes[0], ZERO, "single default execution mode");
  const execution = `${source.toLowerCase()}${"00".repeat(32)}${ACTIVATE.slice(2)}`;
  equal(executions[0], execution, "exact packed activation");
  const [delegations] = decodeAbiParameters(CONTEXT_PARAMETERS, contexts[0]);
  equal(encodeAbiParameters(CONTEXT_PARAMETERS, [delegations]), contexts[0], "canonical permission context");
  equal(delegations.length, 1, "one self delegation");
  const delegation = delegations[0];
  equal(delegation.delegate, EXPECTED.owner, "self delegation delegate");
  equal(delegation.delegator, EXPECTED.owner, "self delegation delegator");
  equal(delegation.authority, ROOT_AUTHORITY, "root delegation authority");
  equal(delegation.caveats.length, 1, "one native balance caveat");
  const terms = `0x01${EXPECTED.owner.slice(2).toLowerCase()}${"00".repeat(32)}`;
  equal(delegation.caveats[0], { enforcer: METAMASK_ACTIVATION_PROFILE.enforcer, terms, args: "0x" }, "exact native balance caveat");
  if (delegation.signature.length !== 132) fail("delegation signature length mismatch");
  const v = Number.parseInt(delegation.signature.slice(-2), 16);
  if (v !== 27 && v !== 28) fail("delegation signature v mismatch");
  const delegationSignature = signature({ yParity: numberToHex(v - 27), r: delegation.signature.slice(0, 66), s: `0x${delegation.signature.slice(66, 130)}` }, "delegation");
  const delegationHash = hashStruct({ data: delegation, primaryType: "Delegation", types: TYPES });
  const delegationDigest = hashTypedData({
    domain: { name: "DelegationManager", version: "1", chainId: 1, verifyingContract: tx.to },
    primaryType: "Delegation", types: TYPES, message: delegation,
  });
  equal(await recoverAddress({ hash: delegationDigest, signature: delegation.signature }), EXPECTED.owner, "delegation signer");
  const authorization = tx.authorizationList[0];
  equal(authorization.chainId, 1, "chain-bound authorization");
  equal(authorization.address, METAMASK_ACTIVATION_PROFILE.implementation, "authorization implementation");
  equal(authorization.nonce, tx.nonce + 1, "same-owner authorization nonce");
  equal(await recoverAuthorizationAddress({ authorization }), EXPECTED.owner, "authorization signer");
  const serialized = serializeTransaction(tx, signed.signature);
  equal(keccak256(serialized), signed.hash, "reconstructed signed transaction hash");
  equal(await recoverTransactionAddress({ serializedTransaction: serialized }), EXPECTED.owner, "outer transaction signer");
  return { signed, source, execution, delegation, delegationHash, delegationDigest, delegationSignature,
    authorizationDigest: hashAuthorization(authorization), serialized };
}

function traceLog(log) {
  if (!log || !Array.isArray(log.topics) || log.topics.length > 4) fail("malformed activation trace log");
  if (typeof log.data !== "string" || log.data.length > 4098) fail("activation trace log byte bound exceeded");
  return { address: address(log.address, "trace log address"),
    topics: log.topics.map((topic) => hash(topic, "trace log topic")), data: hex(log.data, "trace log data") };
}
export function normalizeActivationTrace(trace) {
  let count = 0;
  function visit(node, depth) {
    if (!node || depth > 3 || ++count > 9 || node.error !== undefined || node.revertReason !== undefined)
      fail("failed, truncated or oversized activation trace");
    if (node.type !== "CALL" && node.type !== "STATICCALL") fail("unexpected activation call type");
    const calls = node.calls ?? [];
    const logs = node.logs ?? [];
    if (!Array.isArray(calls) || !Array.isArray(logs) || calls.length > 6 || logs.length > 1)
      fail("activation trace child/log bound exceeded");
    const input = hex(node.input, "trace input");
    const output = hex(node.output ?? "0x", "trace output");
    if (input.length > 2250 || output.length > 258) fail("activation trace byte bound exceeded");
    return {
      type: node.type, from: address(node.from, "trace from"), to: address(node.to, "trace to"),
      input, value: quantity(node.value ?? "0x0", "trace value").toString(), output,
      calls: calls.map((child) => visit(child, depth + 1)),
      logs: logs.map((log) => ({ ...traceLog(log), position: quantity(log.position, "trace log position").toString() })),
    };
  }
  const result = visit(trace, 0);
  equal(count, 9, "complete activation frame count");
  return result;
}
function expectedTrace(envelope, blockNumber) {
  const { source, execution, delegation, delegationHash, delegationDigest, delegationSignature } = envelope;
  const owner = EXPECTED.owner;
  const manager = METAMASK_ACTIVATION_PROFILE.manager;
  const enforcer = METAMASK_ACTIVATION_PROFILE.enforcer;
  const frame = (type, from, to, input, output = "0x", calls = [], logs = []) =>
    ({ type, from, to, input, value: "0", output, calls, logs });
  const sourceLog = {
    address: source,
    topics: encodeEventTopics({ abi: ABI, eventName: "DepositsActivated", args: { roundId: EXPECTED.roundId, previousAuthority: owner } }),
    data: encodeAbiParameters(parseAbiParameters("uint256"), [blockNumber]), position: "0",
  };
  const managerLog = {
    address: manager,
    topics: encodeEventTopics({ abi: ABI, eventName: "RedeemedDelegation", args: { rootDelegator: owner, redeemer: owner } }),
    data: encodeAbiParameters(DELEGATION_PARAMETERS, [delegation]), position: "6",
  };
  const recoveryInput = encodeAbiParameters(parseAbiParameters("bytes32,uint256,bytes32,bytes32"),
    [delegationDigest, BigInt(delegationSignature.yParity + 27), delegationSignature.r, delegationSignature.s]);
  const hooks = ["beforeAllHook", "beforeHook", "afterHook", "afterAllHook"].map((name) => frame("CALL", manager, enforcer,
    callData(name, [delegation.caveats[0].terms, "0x", ZERO, execution, delegationHash, owner, owner])));
  return frame("CALL", owner, manager, envelope.signed.transaction.data, "0x", [
    frame("STATICCALL", manager, owner, callData("isValidSignature", [delegationDigest, delegation.signature]),
      encodeAbiParameters(parseAbiParameters("bytes4"), ["0x1626ba7e"]), [
        frame("STATICCALL", owner, PRECOMPILE, recoveryInput, encodeAbiParameters(parseAbiParameters("address"), [owner])),
      ]),
    hooks[0], hooks[1],
    frame("CALL", manager, owner, callData("executeFromExecutor", [ZERO, execution]),
      encodeAbiParameters(parseAbiParameters("bytes[]"), [["0x"]]), [
        frame("CALL", owner, source, ACTIVATE, "0x", [], [sourceLog]),
      ]),
    hooks[2], hooks[3],
  ], [managerLog]);
}

export async function verifyMetaMaskActivationEnvelope({ providers, transactionHash,
  canonicalTransaction, canonicalReceipt, sourceAddress, sourceRuntimeCode, maximumActivationGas }) {
  assertProviderSet(providers);
  const txHash = hash(transactionHash, "activation transaction");
  const observations = await Promise.all(providers.map(async (provider) => {
    const raw = await provider.request("eth_getTransactionByHash", [txHash]);
    const envelope = await decodeMetaMaskActivationEnvelope(raw, sourceAddress, maximumActivationGas);
    const { signed } = envelope;
    const tx = signed.transaction;
    equal({ hash: signed.hash, from: signed.from, to: tx.to, nonce: numberToHex(tx.nonce), chainId: numberToHex(tx.chainId),
      value: numberToHex(tx.value), input: tx.data, blockHash: signed.blockHash, blockNumber: signed.blockNumber,
      transactionIndex: signed.transactionIndex }, canonicalTransaction, "full signed/canonical activation transaction");
    equal(signed.hash, txHash, "requested activation identity");
    const receipt = await provider.request("eth_getTransactionReceipt", [txHash]);
    if (!receipt) fail("wrapped receipt unavailable");
    equal(q(receipt.type, "receipt type"), "0x4", "wrapped receipt type");
    for (const key of ["transactionHash", "blockHash"])
      equal(hash(receipt[key], key), canonicalReceipt[key], `wrapped receipt ${key}`);
    for (const key of ["blockNumber", "transactionIndex", "status"])
      equal(q(receipt[key], key), canonicalReceipt[key], `wrapped receipt ${key}`);
    for (const key of ["from", "to"])
      equal(address(receipt[key], key), canonicalReceipt[key], `wrapped receipt ${key}`);
    equal(receipt.contractAddress, null, "wrapped receipt creation");
    equal(q(receipt.status, "receipt status"), "0x1", "wrapped receipt success");
    const gasUsed = quantity(receipt.gasUsed, "receipt gas used");
    const effectiveGasPrice = quantity(receipt.effectiveGasPrice, "receipt effective gas price");
    if (gasUsed === 0n || gasUsed > tx.gas || effectiveGasPrice > tx.maxFeePerGas)
      fail("wrapped receipt gas bound exceeded");
    const actual = await provider.request("debug_traceTransaction", [txHash, ACTIVATION_TRACE_OPTIONS]);
    equal(quantity(actual?.gas, "trace gas"), tx.gas, "trace transaction gas");
    equal(quantity(actual?.gasUsed, "trace gas used"), gasUsed, "trace receipt gas");
    const normalized = normalizeActivationTrace(actual);
    const expected = expectedTrace(envelope, quantity(signed.blockNumber, "activation block"));
    equal(normalized, expected, "exact activation execution trace");
    if (!Array.isArray(receipt.logs) || receipt.logs.length !== 2 || canonicalReceipt.logs.length !== 2)
      fail("exactly two wrapped activation receipt logs required");
    const expectedLogs = [expected.calls[3].calls[0].logs[0], expected.logs[0]];
    for (let index = 0; index < 2; index++) {
      const log = receipt.logs[index];
      const canonical = canonicalReceipt.logs[index];
      equal(traceLog(log), traceLog(canonical), "fresh/canonical receipt log");
      equal(traceLog(log), traceLog(expectedLogs[index]), "trace/receipt log binding");
      if (log.removed !== false || canonical.removed !== false) fail("wrapped activation log removed");
      for (const key of ["transactionHash", "blockHash"])
        for (const observed of [log, canonical])
          equal(hash(observed[key], key), canonicalReceipt[key], `wrapped log ${key}`);
      for (const key of ["blockNumber", "transactionIndex"])
        for (const observed of [log, canonical])
          equal(q(observed[key], key), canonicalReceipt[key], `wrapped log ${key}`);
      equal(q(log.logIndex, "log index"), canonical.logIndex, "canonical log index");
    }
    equal(quantity(receipt.logs[1].logIndex, "manager log index"), quantity(receipt.logs[0].logIndex, "source log index") + 1n, "wrapped log ordering");
    return { envelope, evidence: {
      serializedTransaction: envelope.serialized,
      traceCommitmentSha256: commitment(normalized),
      gasUsed: gasUsed.toString(), effectiveGasPriceWei: effectiveGasPrice.toString(),
    } };
  }));
  for (const observation of observations.slice(1))
    equal(observation.evidence, observations[0].evidence, "independent wrapped activation agreement");
  const { envelope, evidence } = observations[0];
  const block = quantity(envelope.signed.blockNumber, "activation block");
  if (block === 0n) fail("invalid activation block");
  for (const tag of [numberToHex(block - 1n), numberToHex(block)]) {
    for (const [name, expectedHash] of [["manager", "managerCodehash"], ["implementation", "implementationCodehash"], ["enforcer", "enforcerCodehash"]]) {
      const code = hex(await agreedRead(providers, "eth_getCode", [METAMASK_ACTIVATION_PROFILE[name], tag]), "wrapper runtime");
      equal(keccak256(code), METAMASK_ACTIVATION_PROFILE[expectedHash], `historical ${name} runtime`);
    }
  }
  const tag = numberToHex(block);
  const indicator = `0xef0100${METAMASK_ACTIVATION_PROFILE.implementation.slice(2).toLowerCase()}`;
  equal(hex(await agreedRead(providers, "eth_getCode", [EXPECTED.owner, tag]), "historical owner code"), indicator, "applied owner delegation");
  equal(hex(await agreedRead(providers, "eth_getCode", [envelope.source, tag]), "activation intake runtime"), hex(sourceRuntimeCode, "reviewed intake runtime"), "activation intake runtime");
  return freeze({
    kind: "metamask-delegation-framework-1.3.0-single-activation",
    transactionHash: txHash,
    calldataKeccak256: keccak256(envelope.signed.transaction.data),
    signedTransactionKeccak256: keccak256(evidence.serializedTransaction),
    outerTo: METAMASK_ACTIVATION_PROFILE.manager,
    authorizationDigest: envelope.authorizationDigest,
    authorizationNonce: envelope.signed.transaction.authorizationList[0].nonce.toString(),
    delegationHash: envelope.delegationHash,
    delegationDigest: envelope.delegationDigest,
    historicalOwnerDelegationCode: indicator,
    executionBlockNumber: block.toString(),
    runtimePins: METAMASK_ACTIVATION_PROFILE,
    traceCommitmentSha256: evidence.traceCommitmentSha256,
    gasLimit: envelope.signed.transaction.gas.toString(),
    gasUsed: evidence.gasUsed,
    maximumFeePerGasWei: envelope.signed.transaction.maxFeePerGas.toString(),
    maximumPriorityFeePerGasWei: envelope.signed.transaction.maxPriorityFeePerGas.toString(),
    effectiveGasPriceWei: evidence.effectiveGasPriceWei,
    actualFeeWei: (BigInt(evidence.gasUsed) * BigInt(evidence.effectiveGasPriceWei)).toString(),
    persistentDelegationApplied: true,
    matchesPreparedDirectTransaction: false,
  });
}
