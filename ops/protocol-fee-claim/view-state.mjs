export const SCAN_SNAPSHOT_SCHEMA =
  "programmable.fee-claim-scan-snapshot.v1";
export const SCAN_SNAPSHOT_STORAGE_KEY =
  "programmable.fee-claim.scan-snapshot.v1";

const MAX_SNAPSHOT_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_DISPLAY_COUNT = 100_000;
const MAX_UINT256_DECIMAL_DIGITS = 78;

function parseNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_DISPLAY_COUNT)
    throw new Error(`${label} ist ungültig`);
  return value;
}

function parsePositiveDecimal(value, label) {
  if (
    typeof value !== "string" ||
    value.length > MAX_UINT256_DECIMAL_DIGITS ||
    !/^[1-9][0-9]*$/.test(value)
  )
    throw new Error(`${label} ist ungültig`);
  return BigInt(value).toString();
}

function parseNonNegativeDecimal(value, label) {
  if (
    typeof value !== "string" ||
    value.length > MAX_UINT256_DECIMAL_DIGITS ||
    !/^(?:0|[1-9][0-9]*)$/.test(value)
  )
    throw new Error(`${label} ist ungültig`);
  return BigInt(value).toString();
}

export function parseScanSnapshot(
  value,
  { expectedAccount, expectedChainId, now = Date.now() },
) {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== "object")
    throw new Error("Scan-Snapshot fehlt");
  if (parsed.schema !== SCAN_SNAPSHOT_SCHEMA)
    throw new Error("Scan-Snapshot-Schema stimmt nicht");
  if (
    typeof expectedAccount !== "string" ||
    parsed.account?.toLowerCase() !== expectedAccount.toLowerCase()
  )
    throw new Error("Scan-Snapshot-Wallet stimmt nicht");
  if (parsed.chainId !== expectedChainId)
    throw new Error("Scan-Snapshot-Netzwerk stimmt nicht");
  if (
    !Number.isSafeInteger(parsed.scannedAt) ||
    parsed.scannedAt <= 0 ||
    parsed.scannedAt > now + MAX_FUTURE_SKEW_MS ||
    now - parsed.scannedAt > MAX_SNAPSHOT_AGE_MS
  )
    throw new Error("Scan-Snapshot ist nicht mehr aktuell genug");

  return Object.freeze({
    schema: SCAN_SNAPSHOT_SCHEMA,
    account: expectedAccount.toLowerCase(),
    chainId: expectedChainId,
    blockNumber: parsePositiveDecimal(parsed.blockNumber, "Blocknummer"),
    nativeWei: parseNonNegativeDecimal(parsed.nativeWei, "ETH-Betrag"),
    claimCount: parseNonNegativeInteger(parsed.claimCount, "Claim-Anzahl"),
    assetCount: parseNonNegativeInteger(parsed.assetCount, "Asset-Anzahl"),
    scannedAt: parsed.scannedAt,
  });
}

export function createScanSnapshot({
  account,
  chainId,
  blockNumber,
  nativeWei,
  claimCount,
  assetCount,
  scannedAt = Date.now(),
}) {
  return parseScanSnapshot(
    {
      schema: SCAN_SNAPSHOT_SCHEMA,
      account,
      chainId,
      blockNumber: BigInt(blockNumber).toString(),
      nativeWei: BigInt(nativeWei).toString(),
      claimCount,
      assetCount,
      scannedAt,
    },
    { expectedAccount: account, expectedChainId: chainId, now: scannedAt },
  );
}
