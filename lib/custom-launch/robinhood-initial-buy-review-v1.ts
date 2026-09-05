import { decodeFunctionData, encodeFunctionData, getAddress, parseAbi, type Address, type Hex } from "viem";
import { canonicalBrowserJsonV2, canonicalBrowserSha256V2 } from "./browser-authority-v2";
import { parseRobinhoodFeeReviewV1 } from "./robinhood-fee-review-v1";
import { parseRobinhoodFundingPlanV1 } from "./robinhood-funding-review-v1";

const QUOTE_SCHEMA = "programmable.robinhood-initial-buy-usd-quote.v1";
const REVIEW_SCHEMA = "programmable.robinhood-initial-buy-review.v1";
const EXECUTION_SCHEMA = "programmable.robinhood-native20-seed-proof.v1";
const SEED_RELEASE = "sha256:c88991b7987bdbee930ead63f5ac4b880858051b334e02ff25fe533793a2d7c4";
export const ROBINHOOD_INITIAL_BUY_REFERENCE_FEED_V1 = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419";
const PROVIDERS = [{ providerId: "drpc", trustDomain: "drpc.org" }, { providerId: "quicknode", trustDomain: "quicknode.com" }];
const INITIALIZE = parseAbi(["function initialize(address token_, address hook_, address buyer, uint256 minimumTokensOut)"]);
const UINT256 = (1n << 256n) - 1n;
const UINT80 = (1n << 80n) - 1n;
const QUOTE_KEYS = ["schemaVersion", "executionChainId", "referenceChainId", "nativeCurrency", "quoteCurrency",
  "assessmentBase", "feedAddress", "feedDecimals", "blockNumber", "blockHash", "blockTimestamp", "roundId",
  "answeredInRound", "answer", "startedAt", "updatedAt", "minimumUsdWad", "minimumInitialBuyWei", "observedAt", "expiresAt", "providers", "evidenceDigest"];
const EXECUTION_KEYS = ["schemaVersion", "artifactReleaseSha256", "graphSha256", "verificationBundleSha256", "preparedArtifactHash",
  "kernelEvidenceDigest", "tokenTargetId", "tokenAddress", "initializerTargetId", "initializerAddress", "initialSqrtPriceX96",
  "initialTokenInventoryRaw", "nativeSeedWei", "initialBuyWei", "buyer", "minimumTokensOut", "initialBuyExecution", "tickLower",
  "tickUpper", "positionOwner", "principalPolicy", "evidenceDigest"];
const SUMMARY_KEYS = ["evidenceDigest", "preparedArtifactHash", "initialBuyWei", "buyer", "minimumTokensOut", "quoteAnswer",
  "minimumInitialBuyWei", "referenceObservedAt", "authorizedAt"];

export type RobinhoodInitialBuyUsdQuoteV1 = Readonly<{
  schemaVersion: typeof QUOTE_SCHEMA; executionChainId: "4663"; referenceChainId: "1"; nativeCurrency: "ETH"; quoteCurrency: "USD";
  assessmentBase: "gross-native-initial-buy-at-admission"; feedAddress: typeof ROBINHOOD_INITIAL_BUY_REFERENCE_FEED_V1; feedDecimals: 8;
  blockNumber: string; blockHash: Hex; blockTimestamp: string; roundId: string; answeredInRound: string; answer: string;
  startedAt: string; updatedAt: string; minimumUsdWad: "1000000000000000000"; minimumInitialBuyWei: string;
  observedAt: string; expiresAt: string; providers: readonly Readonly<{ providerId: string; trustDomain: string }>[];
  evidenceDigest: `sha256:${string}`;
}>;
export type RobinhoodInitialBuyReviewV1 = Readonly<{
  evidenceDigest: `sha256:${string}`; preparedArtifactHash: `sha256:${string}`; initialBuyWei: string; buyer: Address;
  minimumTokensOut: string; quoteAnswer: string; minimumInitialBuyWei: string; referenceObservedAt: string; authorizedAt: string;
}>;

/** Validates a serialized reference at an explicit assessment time; JSON never issues server authority. */
export function parseRobinhoodInitialBuyUsdQuoteV1(value: unknown, assessedAt: Date): RobinhoodInitialBuyUsdQuoteV1 | null {
  try {
    const quote = exact(value, QUOTE_KEYS);
    const observed = timestamp(quote.observedAt);
    const expires = timestamp(quote.expiresAt);
    const assessed = assessedAt.getTime();
    const blockTime = uint(quote.blockTimestamp);
    const updated = uint(quote.updatedAt);
    const started = uint(quote.startedAt);
    const round = uint(quote.roundId, UINT80);
    const answered = uint(quote.answeredInRound, UINT80);
    const answer = uint(quote.answer, (1n << 255n) - 1n);
    const minimum = uint(quote.minimumInitialBuyWei);
    const observedSeconds = BigInt(Math.floor(observed / 1000));
    const assessedSeconds = BigInt(Math.floor(assessed / 1000));
    if (quote.schemaVersion !== QUOTE_SCHEMA || quote.executionChainId !== "4663" || quote.referenceChainId !== "1"
      || quote.nativeCurrency !== "ETH" || quote.quoteCurrency !== "USD" || quote.assessmentBase !== "gross-native-initial-buy-at-admission"
      || quote.feedAddress !== ROBINHOOD_INITIAL_BUY_REFERENCE_FEED_V1 || quote.feedDecimals !== 8
      || quote.minimumUsdWad !== "1000000000000000000" || uint(quote.blockNumber) === 0n
      || typeof quote.blockHash !== "string" || !/^0x(?!0{64}$)[0-9a-f]{64}$/u.test(quote.blockHash)
      || blockTime === 0n || started === 0n || started > updated || updated > blockTime
      || blockTime > observedSeconds || observedSeconds - blockTime > 120n || observedSeconds - updated > 7200n
      || !Number.isSafeInteger(assessed) || assessed < observed || assessed >= expires
      || assessedSeconds - blockTime > 120n || assessedSeconds - updated > 7200n
      || expires !== Math.min(observed + 60000, Number(blockTime + 120n) * 1000, Number(updated + 7200n) * 1000)
      || expires <= observed || round === 0n || answered < round || answer === 0n
      || minimum !== (10n ** 26n + answer - 1n) / answer
      || canonicalBrowserJsonV2(quote.providers) !== canonicalBrowserJsonV2(PROVIDERS)
      || canonicalBrowserSha256V2(QUOTE_SCHEMA, without(quote, "evidenceDigest")) !== digest(quote.evidenceDigest)) return null;
    return Object.freeze({ ...quote, providers: Object.freeze(PROVIDERS.map(item => Object.freeze({ ...item }))) }) as RobinhoodInitialBuyUsdQuoteV1;
  } catch { return null; }
}

/** The receipt binds a historical authorization quote; later wallet sends keep their original permit deadline. */
export function parseRobinhoodInitialBuyReviewV1(value: unknown): RobinhoodInitialBuyReviewV1 | null {
  try {
    const resource = record(value);
    const fee = parseRobinhoodFeeReviewV1(resource);
    if (!fee) return null;
    const review = exact(resource.initialBuyReview, ["schemaVersion", "execution", "quote", "assessmentTime", "evidenceDigest"]);
    const execution = exact(review.execution, EXECUTION_KEYS);
    const receipt = record(resource.admissionReceipt);
    const quote = parseRobinhoodInitialBuyUsdQuoteV1(review.quote, new Date(timestamp(receipt.issuedAt)));
    if (!quote) return null;
    const artifact = record(resource.preparedArtifact);
    const funding = record(resource.funding);
    const plan = parseRobinhoodFundingPlanV1(resource.fundingPlan, String(funding.valueWei));
    const controller = record(resource.controller);
    const permit = record(artifact.permit);
    const stamp = record(artifact.stampRequest);
    const pool = record(stamp.poolKey);
    const targets = record(artifact.route).targets;
    if (!Array.isArray(targets)) return null;
    const token = targets.map(record).find(target => target.targetId === execution.tokenTargetId);
    const initializer = targets.map(record).find(target => target.targetId === execution.initializerTargetId);
    if (!token || !initializer || token === initializer) return null;
    const buyer = address(execution.buyer);
    const initialBuy = uint(execution.initialBuyWei);
    const minimumTokensOut = uint(execution.minimumTokensOut);
    const tokenAddress = address(execution.tokenAddress);
    const initializerAddress = address(execution.initializerAddress);
    const calldata = initializer.initializerCalldata;
    if (typeof calldata !== "string" || !/^0x(?:[0-9a-f]{2})+$/u.test(calldata)) return null;
    const decoded = decodeFunctionData({ abi: INITIALIZE, data: calldata as Hex });
    if (review.schemaVersion !== REVIEW_SCHEMA || review.assessmentTime !== "permit-authorization"
      || execution.schemaVersion !== EXECUTION_SCHEMA || execution.artifactReleaseSha256 !== SEED_RELEASE
      || digest(execution.graphSha256) !== (artifact.unboundGraphBundleHash ?? artifact.graphBundleHash)
      || execution.verificationBundleSha256 !== artifact.verificationBundleHash
      || execution.preparedArtifactHash !== fee.preparedArtifactHash || execution.kernelEvidenceDigest !== fee.evidenceDigest
      || buyer !== controller.address || buyer !== permit.launchWallet
      || initialBuy === 0n || initialBuy < BigInt(quote.minimumInitialBuyWei)
      || plan.launchMode !== "fund-and-launch"
      || execution.initialBuyWei !== plan.nativeAllocations.initialBuyWei || initialBuy > uint(funding.valueWei)
      || execution.initialBuyWei !== initializer.initializerValueWei || minimumTokensOut === 0n
      || typeof execution.tokenTargetId !== "string" || !/^[a-z][a-z0-9._:-]{0,127}$/u.test(execution.tokenTargetId)
      || typeof execution.initializerTargetId !== "string" || !/^[a-z][a-z0-9._:-]{0,127}$/u.test(execution.initializerTargetId)
      || token.predictedAddress !== tokenAddress || initializer.predictedAddress !== initializerAddress
      || tokenAddress !== pool.currency1 || pool.hooks !== fee.kernelAddress || pool.fee !== 0 || pool.tickSpacing !== 60
      || record(artifact.chainBindings).graphFactory !== "0x0B6b3F40f84Df25D3bd69238f937096177DD09Bd"
      || execution.initialSqrtPriceX96 !== "1747735933952748037356115466503453"
      || execution.initialTokenInventoryRaw !== "1000000000000000000000000000" || execution.nativeSeedWei !== "0"
      || execution.tickLower !== 160020 || execution.tickUpper !== 200040 || execution.positionOwner !== initializerAddress
      || execution.principalPolicy !== "no-remove-approve-or-execute-entrypoint"
      || execution.initialBuyExecution !== "atomic-full-native-input-and-minimum-token-output"
      || token.deploymentValueWei !== "0" || token.initializerValueWei !== "0" || token.initializerCalldata !== "0x"
      || initializer.deploymentValueWei !== "0" || decoded.functionName !== "initialize"
      || calldata !== encodeFunctionData({ abi: INITIALIZE, functionName: "initialize", args: [tokenAddress, fee.kernelAddress, buyer, minimumTokensOut] })
      || canonicalBrowserSha256V2(EXECUTION_SCHEMA, without(execution, "evidenceDigest")) !== digest(execution.evidenceDigest)
      || canonicalBrowserSha256V2(REVIEW_SCHEMA, without(review, "evidenceDigest")) !== digest(review.evidenceDigest)
      || receipt.initialBuyReviewDigest !== review.evidenceDigest) return null;
    return parseRobinhoodInitialBuyReviewSummaryV1({ evidenceDigest: review.evidenceDigest,
      preparedArtifactHash: fee.preparedArtifactHash, initialBuyWei: execution.initialBuyWei, buyer,
      minimumTokensOut: execution.minimumTokensOut, quoteAnswer: quote.answer, minimumInitialBuyWei: quote.minimumInitialBuyWei,
      referenceObservedAt: quote.observedAt, authorizedAt: receipt.issuedAt });
  } catch { return null; }
}

/** Validates the independent expected summary; a fresh raw resource must reproduce every field before sending. */
export function parseRobinhoodInitialBuyReviewSummaryV1(value: unknown): RobinhoodInitialBuyReviewV1 | null {
  try {
    const summary = exact(value, SUMMARY_KEYS);
    const initial = uint(summary.initialBuyWei);
    const minimum = uint(summary.minimumInitialBuyWei);
    const answer = uint(summary.quoteAnswer, (1n << 255n) - 1n);
    if (initial === 0n || minimum === 0n || answer === 0n || initial < minimum || uint(summary.minimumTokensOut) === 0n
      || minimum !== (10n ** 26n + answer - 1n) / answer || timestamp(summary.authorizedAt) < timestamp(summary.referenceObservedAt)) return null;
    return Object.freeze({ evidenceDigest: digest(summary.evidenceDigest), preparedArtifactHash: digest(summary.preparedArtifactHash),
      initialBuyWei: String(summary.initialBuyWei), buyer: address(summary.buyer), minimumTokensOut: String(summary.minimumTokensOut),
      quoteAnswer: String(summary.quoteAnswer), minimumInitialBuyWei: String(summary.minimumInitialBuyWei),
      referenceObservedAt: String(summary.referenceObservedAt), authorizedAt: String(summary.authorizedAt) });
  } catch { return null; }
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Invalid object");
  return value as Record<string, unknown>;
}
function exact(value: unknown, keys: readonly string[]) {
  const result = record(value);
  if (Object.keys(result).length !== keys.length || keys.some(key => !Object.hasOwn(result, key))) throw new TypeError("Invalid fields");
  return result;
}
function without(value: Record<string, unknown>, key: string) { const result = { ...value }; delete result[key]; return result; }
function uint(value: unknown, max = UINT256) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,77})$/u.test(value) || BigInt(value) > max) throw new TypeError("Invalid integer");
  return BigInt(value);
}
function timestamp(value: unknown) {
  if (typeof value !== "string" || new Date(value).toISOString() !== value || !Number.isSafeInteger(Date.parse(value))) throw new TypeError("Invalid time");
  return Date.parse(value);
}
function address(value: unknown): Address {
  if (typeof value !== "string" || value === "0x0000000000000000000000000000000000000000" || getAddress(value) !== value) throw new TypeError("Invalid address");
  return getAddress(value);
}
function digest(value: unknown): `sha256:${string}` {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) throw new TypeError("Invalid digest");
  return value as `sha256:${string}`;
}
