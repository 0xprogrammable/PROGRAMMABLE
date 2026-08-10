import {
  concatHex,
  encodeAbiParameters,
  keccak256,
  stringToHex,
  type Hex,
} from "viem";

export const HOOKEMON_PERMIT_ENVELOPE_TYPE_V1 =
  "HookemonPermitEnvelopeV1(bytes32 envelopeTypeHash,uint256 chainId,address router,address launchWallet,bytes32 profileKey,bytes32 architectureIdHash,bytes32 sourceLaunchPlanHash,bytes32 adoptionPlanHash,bytes32 architectureResultHash,bytes32 currentArchitectureStateHash,bytes32 stampRequestHash,bytes32 nonce,uint64 validAfter,uint64 deadline,uint256 value,bytes32 r,bytes32 s,uint8 v)" as const;
export const HOOKEMON_PERMIT_ENVELOPE_TYPE_HASH_V1 =
  "0x76aee0e3ca5251fb636fbe95fc3c44609c3fa524a51d0054aab916ec752319d0" as const;
export const HOOKEMON_PERMIT_ENVELOPE_BYTES_V1 = 576 as const;

export const HOOKEMON_LAUNCH_PERMIT_TYPE_V1 =
  "LaunchPermitV1(uint256 chainId,address router,address launchWallet,bytes32 profileKey,bytes32 architectureIdHash,bytes32 sourceLaunchPlanHash,bytes32 adoptionPlanHash,bytes32 architectureResultHash,bytes32 currentArchitectureStateHash,bytes32 stampRequestHash,bytes32 nonce,uint64 validAfter,uint64 deadline,uint256 value)" as const;
export const HOOKEMON_LAUNCH_PERMIT_TYPE_HASH_V1 =
  "0x9bbf58469f9b0d79df750050233f3adb8e1c7f52e505a731334edd22f0025226" as const;
export const HOOKEMON_ADOPTION_EIP712_NAME_V1 =
  "ProgrammableHookemonAdoptionRouter" as const;
export const HOOKEMON_ADOPTION_EIP712_VERSION_V1 = "1.0.0" as const;

const EIP712_DOMAIN_TYPE_V1 =
  "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)";
const SECP256K1_ORDER =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const SECP256K1_HALF_ORDER =
  0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;

export type HookemonPermitAddressV1 = `0x${string}`;
export type HookemonPermitBytes32V1 = `0x${string}`;

export interface HookemonLaunchPermitV1 {
  readonly chainId: "1";
  readonly router: HookemonPermitAddressV1;
  readonly launchWallet: HookemonPermitAddressV1;
  readonly profileKey: HookemonPermitBytes32V1;
  readonly architectureIdHash: HookemonPermitBytes32V1;
  readonly sourceLaunchPlanHash: HookemonPermitBytes32V1;
  readonly adoptionPlanHash: HookemonPermitBytes32V1;
  readonly architectureResultHash: HookemonPermitBytes32V1;
  readonly currentArchitectureStateHash: HookemonPermitBytes32V1;
  readonly stampRequestHash: HookemonPermitBytes32V1;
  readonly nonce: HookemonPermitBytes32V1;
  readonly validAfter: string;
  readonly deadline: string;
  readonly value: "0";
}

export interface HookemonPermitSignatureV1 {
  readonly r: HookemonPermitBytes32V1;
  readonly s: HookemonPermitBytes32V1;
  readonly v: 27 | 28;
}

export interface HookemonPermitEnvelopeExpectedReleaseV1 {
  readonly router: HookemonPermitAddressV1;
  readonly launchWallet: HookemonPermitAddressV1;
  readonly profileKey: HookemonPermitBytes32V1;
  readonly architectureIdHash: HookemonPermitBytes32V1;
  readonly sourceLaunchPlanHash: HookemonPermitBytes32V1;
  readonly adoptionPlanHash: HookemonPermitBytes32V1;
  readonly architectureResultHash: HookemonPermitBytes32V1;
  readonly currentArchitectureStateHash: HookemonPermitBytes32V1;
  readonly stampRequestHash: HookemonPermitBytes32V1;
  readonly nonce: HookemonPermitBytes32V1;
  readonly permitDigest: HookemonPermitBytes32V1;
  readonly validAfterEpochSeconds: string;
  readonly expiresAtEpochSeconds: string;
}

export interface HookemonDecodedPermitEnvelopeV1 {
  readonly permit: HookemonLaunchPermitV1;
  readonly signature: HookemonPermitSignatureV1;
  readonly permitDigest: HookemonPermitBytes32V1;
  readonly envelopeHash: HookemonPermitBytes32V1;
}

const PERMIT_ENVELOPE_ABI = [
  { type: "bytes32" },
  { type: "uint256" },
  { type: "address" },
  { type: "address" },
  { type: "bytes32" },
  { type: "bytes32" },
  { type: "bytes32" },
  { type: "bytes32" },
  { type: "bytes32" },
  { type: "bytes32" },
  { type: "bytes32" },
  { type: "bytes32" },
  { type: "uint64" },
  { type: "uint64" },
  { type: "uint256" },
  { type: "bytes32" },
  { type: "bytes32" },
  { type: "uint8" },
] as const;

export function assertHookemonPermitEnvelopeTypeHashesV1(): void {
  if (
    keccak256(stringToHex(HOOKEMON_PERMIT_ENVELOPE_TYPE_V1))
      !== HOOKEMON_PERMIT_ENVELOPE_TYPE_HASH_V1
    || keccak256(stringToHex(HOOKEMON_LAUNCH_PERMIT_TYPE_V1))
      !== HOOKEMON_LAUNCH_PERMIT_TYPE_HASH_V1
  ) throw invalid("Hookemon permit type hash drifted");
}

export function assertHookemonLaunchPermitV1(
  raw: unknown,
): HookemonLaunchPermitV1 {
  const value = exactObject(raw, [
    "adoptionPlanHash", "architectureIdHash", "architectureResultHash",
    "chainId", "currentArchitectureStateHash", "deadline", "launchWallet",
    "nonce", "profileKey", "router", "sourceLaunchPlanHash",
    "stampRequestHash", "validAfter", "value",
  ], "Hookemon launch permit");
  const permit = deepFreeze({
    chainId: uint(value.chainId, 256) as "1",
    router: address(value.router),
    launchWallet: address(value.launchWallet),
    profileKey: bytes32(value.profileKey),
    architectureIdHash: bytes32(value.architectureIdHash),
    sourceLaunchPlanHash: bytes32(value.sourceLaunchPlanHash),
    adoptionPlanHash: bytes32(value.adoptionPlanHash),
    architectureResultHash: bytes32(value.architectureResultHash),
    currentArchitectureStateHash: bytes32(value.currentArchitectureStateHash),
    stampRequestHash: bytes32(value.stampRequestHash),
    nonce: bytes32(value.nonce),
    validAfter: uint(value.validAfter, 64),
    deadline: uint(value.deadline, 64),
    value: uint(value.value, 256) as "0",
  });
  if (
    permit.chainId !== "1"
    || permit.value !== "0"
    || BigInt(permit.validAfter) > BigInt(permit.deadline)
    || BigInt(permit.deadline) - BigInt(permit.validAfter) > 3_600n
  ) throw invalid("Hookemon permit is outside the Mainnet zero-value policy");
  return permit;
}

export function assertHookemonPermitSignatureV1(
  raw: unknown,
): HookemonPermitSignatureV1 {
  const value = exactObject(raw, ["r", "s", "v"], "Hookemon permit signature");
  const r = bytes32(value.r);
  const s = bytes32(value.s);
  const rNumber = BigInt(r);
  const sNumber = BigInt(s);
  if (
    rNumber === 0n
    || rNumber >= SECP256K1_ORDER
    || sNumber === 0n
    || sNumber > SECP256K1_HALF_ORDER
    || (value.v !== 27 && value.v !== 28)
  ) throw invalid("Hookemon permit signature is non-canonical");
  return Object.freeze({ r, s, v: value.v });
}

export function computeHookemonPermitDigestV1(
  raw: HookemonLaunchPermitV1,
): HookemonPermitBytes32V1 {
  const permit = assertHookemonLaunchPermitV1(raw);
  assertHookemonPermitEnvelopeTypeHashesV1();
  const domainSeparator = keccak256(encodeAbiParameters(
    [
      { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" },
      { type: "uint256" }, { type: "address" },
    ],
    [
      keccak256(stringToHex(EIP712_DOMAIN_TYPE_V1)),
      keccak256(stringToHex(HOOKEMON_ADOPTION_EIP712_NAME_V1)),
      keccak256(stringToHex(HOOKEMON_ADOPTION_EIP712_VERSION_V1)),
      1n,
      permit.router,
    ],
  ));
  const structHash = keccak256(encodeAbiParameters(
    [
      { type: "bytes32" }, { type: "uint256" }, { type: "address" },
      { type: "address" }, { type: "bytes32" }, { type: "bytes32" },
      { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" },
      { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" },
      { type: "uint64" }, { type: "uint64" }, { type: "uint256" },
    ],
    [
      HOOKEMON_LAUNCH_PERMIT_TYPE_HASH_V1,
      1n,
      permit.router,
      permit.launchWallet,
      permit.profileKey,
      permit.architectureIdHash,
      permit.sourceLaunchPlanHash,
      permit.adoptionPlanHash,
      permit.architectureResultHash,
      permit.currentArchitectureStateHash,
      permit.stampRequestHash,
      permit.nonce,
      BigInt(permit.validAfter),
      BigInt(permit.deadline),
      0n,
    ],
  ));
  return keccak256(concatHex(["0x1901", domainSeparator, structHash]));
}

export function encodeHookemonPermitEnvelopeV1(
  rawPermit: HookemonLaunchPermitV1,
  rawSignature: HookemonPermitSignatureV1,
): Hex {
  const permit = assertHookemonLaunchPermitV1(rawPermit);
  const signature = assertHookemonPermitSignatureV1(rawSignature);
  assertHookemonPermitEnvelopeTypeHashesV1();
  const encoded = encodeAbiParameters(PERMIT_ENVELOPE_ABI, [
    HOOKEMON_PERMIT_ENVELOPE_TYPE_HASH_V1,
    1n,
    permit.router,
    permit.launchWallet,
    permit.profileKey,
    permit.architectureIdHash,
    permit.sourceLaunchPlanHash,
    permit.adoptionPlanHash,
    permit.architectureResultHash,
    permit.currentArchitectureStateHash,
    permit.stampRequestHash,
    permit.nonce,
    BigInt(permit.validAfter),
    BigInt(permit.deadline),
    0n,
    signature.r,
    signature.s,
    signature.v,
  ]);
  if ((encoded.length - 2) / 2 !== HOOKEMON_PERMIT_ENVELOPE_BYTES_V1) {
    throw invalid("Hookemon permit envelope has the wrong byte length");
  }
  return encoded;
}

export function decodeHookemonPermitEnvelopeV1(
  raw: unknown,
): HookemonDecodedPermitEnvelopeV1 {
  if (
    typeof raw !== "string"
    || !/^0x[0-9a-f]+$/u.test(raw)
    || (raw.length - 2) / 2 !== HOOKEMON_PERMIT_ENVELOPE_BYTES_V1
  ) throw invalid("Hookemon permit envelope encoding is invalid");
  const words = Array.from({ length: 18 }, (_, index) =>
    `0x${raw.slice(2 + index * 64, 2 + (index + 1) * 64)}` as const);
  if (words[0] !== HOOKEMON_PERMIT_ENVELOPE_TYPE_HASH_V1) {
    throw invalid("Hookemon permit envelope tag drifted");
  }
  const permit = assertHookemonLaunchPermitV1({
    chainId: uintFromWord(words[1]!, 256),
    router: addressFromWord(words[2]!),
    launchWallet: addressFromWord(words[3]!),
    profileKey: words[4],
    architectureIdHash: words[5],
    sourceLaunchPlanHash: words[6],
    adoptionPlanHash: words[7],
    architectureResultHash: words[8],
    currentArchitectureStateHash: words[9],
    stampRequestHash: words[10],
    nonce: words[11],
    validAfter: uintFromWord(words[12]!, 64),
    deadline: uintFromWord(words[13]!, 64),
    value: uintFromWord(words[14]!, 256),
  });
  const signature = assertHookemonPermitSignatureV1({
    r: words[15],
    s: words[16],
    v: Number(BigInt(words[17]!)),
  });
  const canonical = encodeHookemonPermitEnvelopeV1(permit, signature);
  if (canonical !== raw) {
    throw invalid("Hookemon permit envelope is not canonical ABI encoding");
  }
  return deepFreeze({
    permit,
    signature,
    permitDigest: computeHookemonPermitDigestV1(permit),
    envelopeHash: keccak256(canonical),
  });
}

export function assertHookemonPermitEnvelopeReleaseV1(input: Readonly<{
  envelope: unknown;
  expected: HookemonPermitEnvelopeExpectedReleaseV1;
  currentEpochSeconds: string;
}>): HookemonDecodedPermitEnvelopeV1 {
  const decoded = decodeHookemonPermitEnvelopeV1(input.envelope);
  const expected = assertExpectedRelease(input.expected);
  const now = BigInt(uint(input.currentEpochSeconds, 64));
  const permit = decoded.permit;
  if (
    decoded.permitDigest !== expected.permitDigest
    || permit.router !== expected.router
    || permit.launchWallet !== expected.launchWallet
    || permit.profileKey !== expected.profileKey
    || permit.architectureIdHash !== expected.architectureIdHash
    || permit.sourceLaunchPlanHash !== expected.sourceLaunchPlanHash
    || permit.adoptionPlanHash !== expected.adoptionPlanHash
    || permit.architectureResultHash !== expected.architectureResultHash
    || permit.currentArchitectureStateHash !== expected.currentArchitectureStateHash
    || permit.stampRequestHash !== expected.stampRequestHash
    || permit.nonce !== expected.nonce
    || permit.validAfter !== expected.validAfterEpochSeconds
    || permit.deadline !== expected.expiresAtEpochSeconds
    || BigInt(permit.validAfter) > now
    || now >= BigInt(permit.deadline)
  ) throw invalid("Hookemon permit envelope left the exact current release");
  return decoded;
}

function assertExpectedRelease(
  raw: unknown,
): HookemonPermitEnvelopeExpectedReleaseV1 {
  const value = exactObject(raw, [
    "adoptionPlanHash", "architectureIdHash", "architectureResultHash",
    "currentArchitectureStateHash", "expiresAtEpochSeconds", "launchWallet",
    "nonce", "permitDigest", "profileKey", "router", "sourceLaunchPlanHash",
    "stampRequestHash", "validAfterEpochSeconds",
  ], "Hookemon expected permit release");
  return deepFreeze({
    router: address(value.router),
    launchWallet: address(value.launchWallet),
    profileKey: bytes32(value.profileKey),
    architectureIdHash: bytes32(value.architectureIdHash),
    sourceLaunchPlanHash: bytes32(value.sourceLaunchPlanHash),
    adoptionPlanHash: bytes32(value.adoptionPlanHash),
    architectureResultHash: bytes32(value.architectureResultHash),
    currentArchitectureStateHash: bytes32(value.currentArchitectureStateHash),
    stampRequestHash: bytes32(value.stampRequestHash),
    nonce: bytes32(value.nonce),
    permitDigest: bytes32(value.permitDigest),
    validAfterEpochSeconds: uint(value.validAfterEpochSeconds, 64),
    expiresAtEpochSeconds: uint(value.expiresAtEpochSeconds, 64),
  });
}

function exactObject(
  raw: unknown,
  expectedKeys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw invalid(`${label} is invalid`);
  }
  const keys = Reflect.ownKeys(raw);
  const strings = keys.filter((key): key is string => typeof key === "string")
    .sort();
  const expected = [...expectedKeys].sort();
  if (
    keys.length !== strings.length
    || strings.length !== expected.length
    || strings.some((key, index) => key !== expected[index])
  ) throw invalid(`${label} has unexpected fields`);
  return raw as Record<string, unknown>;
}

function address(value: unknown): HookemonPermitAddressV1 {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(value)) {
    throw invalid("Hookemon permit address is invalid");
  }
  return value.toLowerCase() as HookemonPermitAddressV1;
}

function addressFromWord(word: Hex): HookemonPermitAddressV1 {
  if (!/^0x0{24}[0-9a-f]{40}$/u.test(word)) {
    throw invalid("Hookemon permit address word is non-canonical");
  }
  return address(`0x${word.slice(-40)}`);
}

function bytes32(value: unknown): HookemonPermitBytes32V1 {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(value)) {
    throw invalid("Hookemon permit bytes32 is invalid");
  }
  return value.toLowerCase() as HookemonPermitBytes32V1;
}

function uint(value: unknown, bits: number): string {
  if (
    typeof value !== "string"
    || !/^(?:0|[1-9][0-9]*)$/u.test(value)
    || BigInt(value) >= 1n << BigInt(bits)
  ) throw invalid(`Hookemon permit uint${bits} is invalid`);
  return value;
}

function uintFromWord(word: Hex, bits: number): string {
  const value = BigInt(word);
  if (value >= 1n << BigInt(bits)) {
    throw invalid(`Hookemon permit uint${bits} word overflowed`);
  }
  return value.toString(10);
}

function invalid(message: string): TypeError {
  return new TypeError(message);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}
