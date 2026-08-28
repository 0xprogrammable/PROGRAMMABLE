import {
  concat,
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  getAddress,
  isAddress,
  isHex,
  keccak256,
  parseAbi,
  parseAbiParameters,
  stringToHex,
  type Address,
  type Hex,
} from "viem";

import {
  classicV3LaunchAbi,
  encodeClassicV3Launch,
  type ClassicV3DeploymentManifest,
} from "./classic-v3";
import {
  CLASSIC_V4_LAUNCH_STAMP_ROUTER,
  classicV4LaunchAbi,
  encodeClassicV4Launch,
} from "./classic-v4";
import {
  CLASSIC_V4_PUBLIC_RELEASE_BINDING,
  isClassicV4PublicActionBinding,
  type ClassicV4PublicReleaseBinding,
} from "./classic-v4-public-release";
import {
  getConfiguredClassicV3Release,
  isClassicV3ReleaseVerified,
  type ClassicV3ReleaseManifest,
} from "./classic-v3-release";
import { parseInitialBuyWei, type LaunchDraft } from "./launch";
import { buildPlanHash } from "./launch-transaction";
import {
  parsePreparedTransaction,
  type PreparedTransaction,
} from "./prepared-transaction";

export const MIN_CLASSIC_V3_LAUNCH_GAS_LIMIT = 1_500_000n;
export const MAX_CLASSIC_V3_LAUNCH_GAS_LIMIT = 13_500_000n;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const CLASSIC_V4_KIND = 2;
const CLASSIC_V4_LP_FEE_PIPS = 0;
const CLASSIC_V4_TICK_SPACING = 200;
const MAXIMUM_CLASSIC_V4_PERMIT_WINDOW_SECONDS = 330n;
const SECP256K1_ORDER =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const SECP256K1_HALF_ORDER = SECP256K1_ORDER >> 1n;

const CLASSIC_V4_ROUTER_ABI = parseAbi([
  "function launchAndStampV1((uint256 chainId,address router,address launchWallet,uint8 kind,bytes32 routePayloadHash,bytes32 expectedResultHash,bytes32 stampRequestHash,bytes32 nonce,uint64 validAfter,uint64 deadline,uint256 value) permit,(bytes32 launchId,address token,bytes32 tokenRuntimeCodeHash,(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bytes32 hookRuntimeCodeHash,(uint8 resultIndex,address account,bytes32 runtimeCodeHash,uint8 kind,uint8 scope)[] components) stampRequest,bytes routePayload,bytes signature) payable returns (bytes32 stampHash)",
]);

const CLASSIC_V4_ROUTE_PARAMETERS = parseAbiParameters(
  "(address launcher,bytes32 launcherRuntimeCodeHash,(string name,string symbol,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,bytes32 creatorSalt,(string description,string website,string image,bytes extraData) metadata,address[] rewardBeneficiaries,uint16[] rewardSharesBps,(uint8 mode,uint16 durationDays,uint16 cliffDays) initialBuyCustody) parameters,(address token,address rewardVault,address positionRecipient,uint256 positionTokenId,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,uint256 initialBuyNativeAmount,uint256 initialBuyTokenAmount,address initialBuyCustody,bytes32 poolId,bytes32 launchHash) expectedResult) route",
);

const CLASSIC_RESULT_ADDRESSES_TYPEHASH = keccak256(stringToHex(
  "ProgrammableClassicResultAddressesV1(address token,address rewardVault,address positionRecipient,address initialBuyCustody)",
));
const CLASSIC_RESULT_AMOUNTS_TYPEHASH = keccak256(stringToHex(
  "ProgrammableClassicResultAmountsV1(uint256 positionTokenId,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,uint256 initialBuyNativeAmount,uint256 initialBuyTokenAmount)",
));
const CLASSIC_RESULT_TYPEHASH = keccak256(stringToHex(
  "ProgrammableClassicLaunchResultV1(bytes32 addressesHash,bytes32 amountsHash,bytes32 poolId,bytes32 launchHash)",
));
const COMPONENT_TYPEHASH = keccak256(stringToHex(
  "ProgrammableLaunchComponentV1(uint8 resultIndex,address account,bytes32 runtimeCodeHash,uint8 kind,uint8 scope)",
));
const POOL_KEY_TYPEHASH = keccak256(stringToHex(
  "ProgrammablePoolKeyV1(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)",
));
const STAMP_REQUEST_TYPEHASH = keccak256(stringToHex(
  "ProgrammableStampRequestV1(bytes32 launchId,address token,bytes32 tokenRuntimeCodeHash,bytes32 poolKeyHash,bytes32 hookRuntimeCodeHash,bytes32 componentSetHash)",
));

type PreparedClassicV3LaunchInput = {
  transaction: unknown;
  draft: LaunchDraft;
  account: string;
  planHash: unknown;
};

type PreparedClassicV4LaunchInput = PreparedClassicV3LaunchInput & {
  releaseLauncher: unknown;
  releaseManifestDigest: unknown;
};

type PreparedClassicV3LaunchTransaction = Extract<
  PreparedTransaction,
  { kind: "launch" }
>;

function connectedAccount(value: string) {
  try {
    return getAddress(value);
  } catch {
    throw new Error("Connect a valid Ethereum wallet before launching");
  }
}

function readParameters(data: Hex) {
  try {
    const decoded = decodeFunctionData({
      abi: classicV3LaunchAbi,
      data,
    });
    if (decoded.functionName !== "launch") throw new Error("selector");
    return decoded.args[0];
  } catch {
    throw new Error(
      "The prepared transaction does not call the Classic launch function",
    );
  }
}

function parametersMatch(
  received: ReturnType<typeof readParameters>,
  expected: ReturnType<typeof readParameters>,
) {
  return (
    received.name === expected.name &&
    received.symbol === expected.symbol &&
    received.buySwapFeeBps === expected.buySwapFeeBps &&
    received.sellSwapFeeBps === expected.sellSwapFeeBps &&
    received.creatorSalt.toLowerCase() === expected.creatorSalt.toLowerCase() &&
    received.metadata.description === expected.metadata.description &&
    received.metadata.website === expected.metadata.website &&
    received.metadata.image === expected.metadata.image &&
    received.metadata.extraData.toLowerCase() ===
      expected.metadata.extraData.toLowerCase() &&
    received.rewardBeneficiaries.length ===
      expected.rewardBeneficiaries.length &&
    received.rewardBeneficiaries.every(
      (beneficiary, index) =>
        beneficiary.toLowerCase() ===
        expected.rewardBeneficiaries[index].toLowerCase(),
    ) &&
    received.rewardSharesBps.length === expected.rewardSharesBps.length &&
    received.rewardSharesBps.every(
      (share, index) => share === expected.rewardSharesBps[index],
    ) &&
    received.initialBuyCustody.mode === expected.initialBuyCustody.mode &&
    received.initialBuyCustody.durationDays ===
      expected.initialBuyCustody.durationDays &&
    received.initialBuyCustody.cliffDays ===
      expected.initialBuyCustody.cliffDays
  );
}

export function validatePreparedClassicV3LaunchTransactionAgainstManifest(
  input: PreparedClassicV3LaunchInput,
  manifest: ClassicV3DeploymentManifest,
  releaseManifest: ClassicV3ReleaseManifest,
): PreparedClassicV3LaunchTransaction {
  const transaction = parsePreparedTransaction(input.transaction);
  if (transaction.kind !== "launch") {
    throw new Error("The prepared transaction is not a Classic launch");
  }
  if (
    !isClassicV3ReleaseVerified(
      manifest,
      releaseManifest,
      manifest.chainId,
    ) ||
    !manifest.memeLaunchV2 ||
    !isAddress(manifest.memeLaunchV2)
  ) {
    throw new Error(
      "Classic is not enabled by the release manifest",
    );
  }
  if (transaction.chainId !== manifest.chainId) {
    throw new Error(
      "The prepared launch network does not match the release manifest",
    );
  }
  const expectedLauncher = getAddress(manifest.memeLaunchV2);
  if (transaction.to.toLowerCase() !== expectedLauncher.toLowerCase()) {
    throw new Error(
      "The prepared launch destination does not match the release manifest",
    );
  }

  const initialBuy = parseInitialBuyWei(input.draft.initialBuyEth);
  if (initialBuy === null || transaction.value !== initialBuy.toString()) {
    throw new Error(
      "The prepared Initial Buy does not match the current token setup",
    );
  }
  const gasLimit = BigInt(transaction.gasLimit);
  if (
    gasLimit < MIN_CLASSIC_V3_LAUNCH_GAS_LIMIT ||
    gasLimit > MAX_CLASSIC_V3_LAUNCH_GAS_LIMIT
  ) {
    throw new Error(
      "The prepared launch gas limit is outside the reviewed range",
    );
  }
  if (
    !isHex(input.draft.launchSalt, { strict: true }) ||
    input.draft.launchSalt.length !== 66
  ) {
    throw new Error(
      "Create a fresh launch identifier before opening the wallet",
    );
  }

  const account: Address = connectedAccount(input.account);
  const expectedData = encodeClassicV3Launch(
    input.draft,
    input.draft.launchSalt,
    account,
  );
  const receivedParameters = readParameters(transaction.data);
  const expectedParameters = readParameters(expectedData);
  if (
    !parametersMatch(receivedParameters, expectedParameters) ||
    transaction.data.toLowerCase() !== expectedData.toLowerCase()
  ) {
    throw new Error(
      "The prepared launch does not match the current token setup",
    );
  }

  if (
    typeof input.planHash !== "string" ||
    !isHex(input.planHash, { strict: true }) ||
    input.planHash.length !== 66
  ) {
    throw new Error("The prepared launch proof is invalid");
  }
  const expectedPlanHash = buildPlanHash(account, {
    kind: "launch",
    chainId: transaction.chainId,
    to: transaction.to,
    data: transaction.data,
    value: transaction.value,
  });
  if (expectedPlanHash.toLowerCase() !== input.planHash.toLowerCase()) {
    throw new Error(
      "The prepared launch does not match the connected wallet",
    );
  }
  return transaction;
}

export function validatePreparedClassicV3LaunchTransaction(
  input: PreparedClassicV3LaunchInput,
) {
  const environment =
    process.env.NEXT_PUBLIC_PROGRAMMABLE_ONCHAIN_NETWORK === "rehearsal"
      ? "rehearsal"
      : "production";
  const configured = getConfiguredClassicV3Release(environment);
  return validatePreparedClassicV3LaunchTransactionAgainstManifest(
    input,
    configured.appManifest,
    configured.releaseManifest,
  );
}

/**
 * Revalidates the exact V4 transaction returned by the server preflight before
 * opening the wallet. The server only returns these release fields after the
 * canonical public manifest and the complete eth_call simulation have passed.
 */
export function validatePreparedClassicV4LaunchTransaction(
  input: PreparedClassicV4LaunchInput,
): PreparedClassicV3LaunchTransaction {
  return validatePreparedClassicV4LaunchTransactionAgainstPublicRelease(
    input,
    CLASSIC_V4_PUBLIC_RELEASE_BINDING,
  );
}

export function validatePreparedClassicV4LaunchTransactionAgainstPublicRelease(
  input: PreparedClassicV4LaunchInput,
  publicRelease: ClassicV4PublicReleaseBinding | null,
): PreparedClassicV3LaunchTransaction {
  const transaction = parsePreparedTransaction(input.transaction);
  if (transaction.kind !== "launch") {
    throw new Error("The prepared transaction is not a Classic V4 launch");
  }
  if (
    !isClassicV4PublicActionBinding(publicRelease) ||
    publicRelease.chainId !== 1 ||
    !isAddress(publicRelease.launcher) ||
    getAddress(publicRelease.launcher) ===
      "0x0000000000000000000000000000000000000000" ||
    !isHex(publicRelease.manifestDigest, { strict: true }) ||
    publicRelease.manifestDigest.length !== 66 ||
    BigInt(publicRelease.manifestDigest) === 0n ||
    input.draft.classicContractRelease !== "classic-v4" ||
    typeof input.releaseLauncher !== "string" ||
    !isAddress(input.releaseLauncher) ||
    typeof input.releaseManifestDigest !== "string" ||
    !isHex(input.releaseManifestDigest, { strict: true }) ||
    input.releaseManifestDigest.length !== 66
  ) {
    throw new Error("Classic V4 is not enabled by the browser release binding");
  }
  if (
    getAddress(input.releaseLauncher).toLowerCase() !==
      getAddress(publicRelease.launcher).toLowerCase() ||
    input.releaseManifestDigest.toLowerCase() !==
      publicRelease.manifestDigest.toLowerCase()
  ) {
    throw new Error(
      "The prepared launch does not match the browser V4 release binding",
    );
  }
  if (transaction.chainId !== publicRelease.chainId) {
    throw new Error(
      "The prepared Classic V4 launch is not on the public Ethereum release",
    );
  }
  if (
    transaction.to.toLowerCase() !==
    CLASSIC_V4_LAUNCH_STAMP_ROUTER.toLowerCase()
  ) {
    throw new Error(
      "Classic V4 launches must use the canonical Launch Stamp Router",
    );
  }
  const initialBuy = parseInitialBuyWei(input.draft.initialBuyEth);
  if (initialBuy === null || transaction.value !== initialBuy.toString()) {
    throw new Error(
      "The prepared Activation Buy does not match the current token setup",
    );
  }
  const gasLimit = BigInt(transaction.gasLimit);
  if (
    gasLimit < MIN_CLASSIC_V3_LAUNCH_GAS_LIMIT
    || gasLimit > MAX_CLASSIC_V3_LAUNCH_GAS_LIMIT
  ) {
    throw new Error(
      "The prepared launch gas limit is outside the reviewed range",
    );
  }
  if (
    !isHex(input.draft.launchSalt, { strict: true })
    || input.draft.launchSalt.length !== 66
  ) {
    throw new Error(
      "Create a fresh launch identifier before opening the wallet",
    );
  }

  const account = connectedAccount(input.account);
  const decoded = readClassicV4RouterCall(transaction.data);
  const [permit, stampRequest, routePayload, signature] = decoded.args;
  const route = readClassicV4Route(routePayload);
  const expectedDirect = readClassicV4DirectParameters(
    encodeClassicV4Launch(
      input.draft,
      input.draft.launchSalt,
      account,
    ),
  );
  if (
    permit.chainId !== 1n
    || permit.router.toLowerCase()
      !== CLASSIC_V4_LAUNCH_STAMP_ROUTER.toLowerCase()
    || permit.launchWallet.toLowerCase() !== account.toLowerCase()
    || permit.kind !== CLASSIC_V4_KIND
    || permit.value !== initialBuy
    || !nonzeroBytes32(permit.nonce)
    || permit.validAfter > permit.deadline
    || permit.deadline - permit.validAfter
      > MAXIMUM_CLASSIC_V4_PERMIT_WINDOW_SECONDS
    || keccak256(routePayload).toLowerCase()
      !== permit.routePayloadHash.toLowerCase()
    || route.launcher.toLowerCase() !== publicRelease.launcher.toLowerCase()
    || route.launcher.toLowerCase()
      !== getAddress(input.releaseLauncher as string).toLowerCase()
    || !nonzeroBytes32(route.launcherRuntimeCodeHash)
    || !classicV4ParametersMatch(route.parameters, expectedDirect)
    || encodeAbiParameters(CLASSIC_V4_ROUTE_PARAMETERS, [route]).toLowerCase()
      !== routePayload.toLowerCase()
  ) {
    throw new Error(
      "The prepared Router launch does not match the current Classic setup",
    );
  }

  assertClassicV4ExpectedResult(stampRequest, route.expectedResult, initialBuy);
  if (
    classicV4ResultHash(route.expectedResult).toLowerCase()
      !== permit.expectedResultHash.toLowerCase()
    || classicV4StampRequestHash(stampRequest).toLowerCase()
      !== permit.stampRequestHash.toLowerCase()
    || !canonicalClassicV4Signature(signature)
  ) {
    throw new Error("The prepared Classic Router proof is invalid");
  }

  if (
    typeof input.planHash !== "string"
    || !isHex(input.planHash, { strict: true })
    || input.planHash.length !== 66
  ) {
    throw new Error("The prepared launch proof is invalid");
  }
  const expectedPlanHash = buildPlanHash(account, {
    kind: "launch",
    chainId: transaction.chainId,
    to: transaction.to,
    data: transaction.data,
    value: transaction.value,
  });
  if (expectedPlanHash.toLowerCase() !== input.planHash.toLowerCase()) {
    throw new Error(
      "The prepared launch does not match the connected wallet",
    );
  }
  return transaction;
}

function readClassicV4RouterCall(data: Hex) {
  try {
    const decoded = decodeFunctionData({
      abi: CLASSIC_V4_ROUTER_ABI,
      data,
    });
    if (decoded.functionName !== "launchAndStampV1") throw new Error();
    return decoded;
  } catch {
    throw new Error(
      "The prepared transaction does not call the Classic Launch Stamp Router",
    );
  }
}

function readClassicV4Route(routePayload: Hex) {
  try {
    return decodeAbiParameters(CLASSIC_V4_ROUTE_PARAMETERS, routePayload)[0];
  } catch {
    throw new Error("The prepared Classic Router route is invalid");
  }
}

function readClassicV4DirectParameters(data: Hex) {
  try {
    const decoded = decodeFunctionData({ abi: classicV4LaunchAbi, data });
    if (decoded.functionName !== "launchFor") throw new Error();
    return decoded.args[1];
  } catch {
    throw new Error("The current Classic launch setup is invalid");
  }
}

type ClassicV4Parameters = ReturnType<typeof readClassicV4DirectParameters>;

function classicV4ParametersMatch(
  received: ClassicV4Parameters,
  expected: ClassicV4Parameters,
) {
  return (
    received.name === expected.name
    && received.symbol === expected.symbol
    && received.buySwapFeeBps === expected.buySwapFeeBps
    && received.sellSwapFeeBps === expected.sellSwapFeeBps
    && received.creatorSalt.toLowerCase() === expected.creatorSalt.toLowerCase()
    && received.metadata.description === expected.metadata.description
    && received.metadata.website === expected.metadata.website
    && received.metadata.image === expected.metadata.image
    && received.metadata.extraData.toLowerCase()
      === expected.metadata.extraData.toLowerCase()
    && received.rewardBeneficiaries.length
      === expected.rewardBeneficiaries.length
    && received.rewardBeneficiaries.every((beneficiary, index) =>
      beneficiary.toLowerCase()
        === expected.rewardBeneficiaries[index]?.toLowerCase())
    && received.rewardSharesBps.length === expected.rewardSharesBps.length
    && received.rewardSharesBps.every((share, index) =>
      share === expected.rewardSharesBps[index])
    && received.initialBuyCustody.mode === 0
    && expected.initialBuyCustody.mode === 0
    && received.initialBuyCustody.durationDays === 0
    && expected.initialBuyCustody.durationDays === 0
    && received.initialBuyCustody.cliffDays === 0
    && expected.initialBuyCustody.cliffDays === 0
  );
}

export function assertClassicV4ExpectedResult(
  stampRequest: ReturnType<typeof readClassicV4RouterCall>["args"][1],
  result: ReturnType<typeof readClassicV4Route>["expectedResult"],
  initialBuy: bigint,
): void {
  const poolKey = stampRequest.poolKey;
  const components = stampRequest.components;
  if (
    !nonzeroAddress(result.token)
    || !nonzeroAddress(result.rewardVault)
    || !nonzeroAddress(result.positionRecipient)
    || result.positionTokenId !== 0n
    || result.tokenLiquidityAmount === 0n
    || result.initialBuyNativeAmount !== initialBuy
    || result.initialBuyTokenAmount === 0n
    || result.initialBuyCustody.toLowerCase() !== ZERO_ADDRESS
    || !nonzeroBytes32(result.poolId)
    || !nonzeroBytes32(result.launchHash)
    || !nonzeroBytes32(stampRequest.launchId)
    || stampRequest.token.toLowerCase() !== result.token.toLowerCase()
    || !nonzeroBytes32(stampRequest.tokenRuntimeCodeHash)
    || poolKey.currency0.toLowerCase() !== ZERO_ADDRESS
    || poolKey.currency1.toLowerCase() !== result.token.toLowerCase()
    || poolKey.fee !== CLASSIC_V4_LP_FEE_PIPS
    || poolKey.tickSpacing !== CLASSIC_V4_TICK_SPACING
    || !nonzeroAddress(poolKey.hooks)
    || !nonzeroBytes32(stampRequest.hookRuntimeCodeHash)
    || classicV4PoolId(poolKey).toLowerCase() !== result.poolId.toLowerCase()
    || components.length !== 4
  ) throw new Error("The prepared Classic launch result is invalid");

  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    if (
      !component
      || !nonzeroAddress(component.account)
      || !nonzeroBytes32(component.runtimeCodeHash)
      || (index > 0
        && BigInt(components[index - 1]!.account) >= BigInt(component.account))
    ) throw new Error("The prepared Classic component set is invalid");
  }
  const byResultIndex = new Map(
    components.map((component) => [component.resultIndex, component]),
  );
  const token = byResultIndex.get(0);
  const reward = byResultIndex.get(1);
  const position = byResultIndex.get(2);
  const hook = byResultIndex.get(255);
  if (
    !token
    || token.account.toLowerCase() !== result.token.toLowerCase()
    || token.runtimeCodeHash.toLowerCase()
      !== stampRequest.tokenRuntimeCodeHash.toLowerCase()
    || token.kind !== 1
    || token.scope !== 1
    || !reward
    || reward.account.toLowerCase() !== result.rewardVault.toLowerCase()
    || reward.kind !== 0
    || reward.scope !== 1
    || !position
    || position.account.toLowerCase()
      !== result.positionRecipient.toLowerCase()
    || position.kind !== 0
    || position.scope !== 1
    || !hook
    || hook.account.toLowerCase() !== poolKey.hooks.toLowerCase()
    || hook.runtimeCodeHash.toLowerCase()
      !== stampRequest.hookRuntimeCodeHash.toLowerCase()
    || hook.kind !== 2
    || hook.scope !== 2
  ) throw new Error("The prepared Classic component bindings are invalid");
}

function classicV4PoolId(poolKey: Readonly<{
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}>) {
  return keccak256(encodeAbiParameters(
    parseAbiParameters(
      "address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks",
    ),
    [
      poolKey.currency0,
      poolKey.currency1,
      poolKey.fee,
      poolKey.tickSpacing,
      poolKey.hooks,
    ],
  ));
}

function classicV4PoolKeyHash(poolKey: Parameters<typeof classicV4PoolId>[0]) {
  return keccak256(encodeAbiParameters(
    parseAbiParameters(
      "bytes32 typehash,address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks",
    ),
    [
      POOL_KEY_TYPEHASH,
      poolKey.currency0,
      poolKey.currency1,
      poolKey.fee,
      poolKey.tickSpacing,
      poolKey.hooks,
    ],
  ));
}

function classicV4ComponentSetHash(
  components: ReturnType<typeof readClassicV4RouterCall>["args"][1]["components"],
) {
  const hashes = components.map((component) => keccak256(encodeAbiParameters(
    parseAbiParameters(
      "bytes32 typehash,uint8 resultIndex,address account,bytes32 runtimeCodeHash,uint8 kind,uint8 scope",
    ),
    [
      COMPONENT_TYPEHASH,
      component.resultIndex,
      component.account,
      component.runtimeCodeHash,
      component.kind,
      component.scope,
    ],
  )));
  if (hashes.length === 0) throw new Error("Classic components are missing");
  return keccak256(concat(
    hashes as unknown as readonly [Hex, ...Hex[]],
  ));
}

function classicV4StampRequestHash(
  request: ReturnType<typeof readClassicV4RouterCall>["args"][1],
) {
  return keccak256(encodeAbiParameters(
    parseAbiParameters(
      "bytes32 typehash,bytes32 launchId,address token,bytes32 tokenRuntimeCodeHash,bytes32 poolKeyHash,bytes32 hookRuntimeCodeHash,bytes32 componentSetHash",
    ),
    [
      STAMP_REQUEST_TYPEHASH,
      request.launchId,
      request.token,
      request.tokenRuntimeCodeHash,
      classicV4PoolKeyHash(request.poolKey),
      request.hookRuntimeCodeHash,
      classicV4ComponentSetHash(request.components),
    ],
  ));
}

function classicV4ResultHash(
  result: ReturnType<typeof readClassicV4Route>["expectedResult"],
) {
  const addressesHash = keccak256(encodeAbiParameters(
    parseAbiParameters(
      "bytes32 typehash,address token,address rewardVault,address positionRecipient,address initialBuyCustody",
    ),
    [
      CLASSIC_RESULT_ADDRESSES_TYPEHASH,
      result.token,
      result.rewardVault,
      result.positionRecipient,
      result.initialBuyCustody,
    ],
  ));
  const amountsHash = keccak256(encodeAbiParameters(
    parseAbiParameters(
      "bytes32 typehash,uint256 positionTokenId,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,uint256 initialBuyNativeAmount,uint256 initialBuyTokenAmount",
    ),
    [
      CLASSIC_RESULT_AMOUNTS_TYPEHASH,
      result.positionTokenId,
      result.tokenLiquidityAmount,
      result.lockedTokenDust,
      result.initialBuyNativeAmount,
      result.initialBuyTokenAmount,
    ],
  ));
  return keccak256(encodeAbiParameters(
    parseAbiParameters(
      "bytes32 typehash,bytes32 addressesHash,bytes32 amountsHash,bytes32 poolId,bytes32 launchHash",
    ),
    [
      CLASSIC_RESULT_TYPEHASH,
      addressesHash,
      amountsHash,
      result.poolId,
      result.launchHash,
    ],
  ));
}

function canonicalClassicV4Signature(signature: Hex) {
  if (!/^0x[0-9a-fA-F]{130}$/u.test(signature)) return false;
  const r = BigInt(`0x${signature.slice(2, 66)}`);
  const s = BigInt(`0x${signature.slice(66, 130)}`);
  const v = Number.parseInt(signature.slice(130, 132), 16);
  return r > 0n && r < SECP256K1_ORDER
    && s > 0n && s <= SECP256K1_HALF_ORDER
    && (v === 27 || v === 28);
}

function nonzeroAddress(value: string) {
  return isAddress(value) && getAddress(value) !== ZERO_ADDRESS;
}

function nonzeroBytes32(value: string) {
  return isHex(value, { strict: true })
    && value.length === 66
    && BigInt(value) !== 0n;
}
