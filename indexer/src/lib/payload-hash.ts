import {
  encodeAbiParameters,
  encodeEventTopics,
  keccak256,
  type AbiEvent,
  type AbiParameter,
  type Hex,
} from "viem";

export type EncodedEventPayload = {
  topics: readonly Hex[];
  data: Hex;
  payloadHash: Hex;
};

export function encodeEventPayload(
  eventAbi: AbiEvent,
  params: Readonly<Record<string, unknown>>,
): EncodedEventPayload {
  const encodedTopics = encodeEventTopics({
    abi: [eventAbi],
    eventName: eventAbi.name,
    args: params,
  });
  if (!Array.isArray(encodedTopics)) {
    throw new TypeError("event topic encoding did not produce a topic array");
  }
  const topics = encodedTopics as readonly Hex[];
  const nonIndexedInputs = eventAbi.inputs.filter(
    (input) => !("indexed" in input) || input.indexed !== true,
  );
  const nonIndexedValues = nonIndexedInputs.map((input) => {
    if (input.name === undefined || input.name.length === 0) {
      throw new TypeError("configured event inputs must be named");
    }
    return params[input.name];
  });
  const data = encodeAbiParameters(
    nonIndexedInputs as readonly AbiParameter[],
    nonIndexedValues,
  );
  const payloadHash = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32[]" }, { type: "bytes" }],
      [topics, data],
    ),
  );
  assertEventPayloadEncoding(topics, data, payloadHash);

  return {
    topics,
    data,
    payloadHash,
  };
}

export function canonicalPayloadJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (
    typeof value === "string" &&
    /^0x(?:[0-9a-fA-F]{2})*$/.test(value)
  ) {
    return value.toLowerCase();
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function assertEventPayloadEncoding(
  topics: readonly Hex[],
  data: Hex,
  payloadHash: Hex,
): void {
  if (
    topics.length === 0 ||
    topics.some((topic) => !/^0x[0-9a-fA-F]{64}$/.test(topic))
  ) {
    throw new TypeError("event topics must be non-empty 32-byte hex values");
  }
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(data)) {
    throw new TypeError("event data must be canonical even-length hexadecimal");
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(payloadHash)) {
    throw new TypeError("payload hash must be a 32-byte hexadecimal value");
  }
}
