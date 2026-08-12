// SPDX-License-Identifier: MIT

export type BlockHash = `0x${string}`;

export interface CanonicalBlock<T> {
  number: bigint;
  hash: BlockHash;
  parentHash: BlockHash;
  records: readonly T[];
}

export interface CanonicalBufferStatus {
  finalizedNumber: bigint | null;
  finalizedHash: BlockHash | null;
  bufferedBlockNumbers: readonly bigint[];
}

const BLOCK_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const MAX_RECORD_DEPTH = 32;
const MAX_RECORD_NODES = 10_000;
const MAX_RECORD_TEXT_UNITS = 1_048_576;

interface PreparedBlock<T> {
  snapshot: CanonicalBlock<T>;
  digest: string;
}

interface CloneBudget {
  active: WeakSet<object>;
  nodes: number;
  textUnits: number;
}

interface CanonicalClone<T> {
  value: T;
  digest: string;
}

export class CanonicalEventBuffer<T> {
  readonly #blocks = new Map<bigint, CanonicalBlock<T>>();
  readonly #digests = new Map<bigint, string>();
  readonly confirmationDepth: bigint;
  readonly startBlock: bigint;
  #head: CanonicalBlock<T> | null = null;
  #finalized: bigint;

  constructor(confirmationDepth: bigint, startBlock = 0n) {
    if (typeof confirmationDepth !== "bigint" || confirmationDepth < 1n) {
      throw new Error("confirmationDepth must be a positive bigint");
    }
    if (typeof startBlock !== "bigint" || startBlock < 0n) {
      throw new Error("startBlock must be a nonnegative bigint");
    }
    this.confirmationDepth = confirmationDepth;
    this.startBlock = startBlock;
    this.#finalized = startBlock - 1n;
  }

  ingest(input: CanonicalBlock<T>): readonly CanonicalBlock<T>[] {
    const prepared = prepareBlock(input);
    const block = prepared.snapshot;
    const existing = this.#blocks.get(block.number);
    if (existing?.hash === block.hash) {
      if (this.#digests.get(block.number) !== prepared.digest) {
        throw new Error("duplicate block snapshot mismatch");
      }
      return [];
    }
    if (block.number <= this.#finalized) throw new Error("cannot rewrite finalized block");
    while (this.#head && this.#head.hash !== block.parentHash) {
      if (this.#head.number <= this.#finalized) throw new Error("reorg crossed finalized checkpoint");
      this.#blocks.delete(this.#head.number);
      this.#digests.delete(this.#head.number);
      this.#head = this.#blocks.get(this.#head.number - 1n) ?? null;
    }
    const expectedNumber = this.#head ? this.#head.number + 1n : this.#finalized + 1n;
    if (block.number !== expectedNumber) throw new Error("canonical block gap");
    this.#blocks.set(block.number, block);
    this.#digests.set(block.number, prepared.digest);
    this.#head = block;
    return this.finalizeAvailable();
  }

  status(): CanonicalBufferStatus {
    const finalizedBlock = this.#finalized < this.startBlock
      ? null
      : this.#blocks.get(this.#finalized) ?? null;
    if (this.#finalized >= this.startBlock && finalizedBlock === null) {
      throw new Error("finalized checkpoint was pruned without its anchor");
    }
    return Object.freeze({
      finalizedNumber: finalizedBlock?.number ?? null,
      finalizedHash: finalizedBlock?.hash ?? null,
      bufferedBlockNumbers: Object.freeze([...this.#blocks.keys()].sort(compareBigInt))
    });
  }

  private finalizeAvailable(): readonly CanonicalBlock<T>[] {
    if (!this.#head) return [];
    const target = this.#head.number - this.confirmationDepth;
    if (target <= this.#finalized) return [];
    const finalized: CanonicalBlock<T>[] = [];
    for (let number = this.#finalized + 1n; number <= target; number += 1n) {
      const block = this.#blocks.get(number);
      if (!block) throw new Error("canonical block gap before finalization");
      finalized.push(prepareBlock(block).snapshot);
    }
    this.#finalized = target;
    for (const number of this.#blocks.keys()) {
      if (number < this.#finalized) {
        this.#blocks.delete(number);
        this.#digests.delete(number);
      }
    }
    if (!this.#blocks.has(this.#finalized) || !this.#digests.has(this.#finalized)) {
      throw new Error("finalized checkpoint pruning lost its anchor");
    }
    return Object.freeze(finalized);
  }
}

function prepareBlock<T>(input: CanonicalBlock<T>): PreparedBlock<T> {
  if (typeof input !== "object" || input === null) throw new Error("canonical block must be an object");
  if (typeof input.number !== "bigint" || input.number < 0n) throw new Error("canonical block number is invalid");
  const hash = normalizeBlockHash(input.hash, "canonical block hash");
  const parentHash = normalizeBlockHash(input.parentHash, "canonical parent hash");
  if (!Array.isArray(input.records)) throw new Error("canonical block records must be an array");
  let records: CanonicalClone<readonly T[]>;
  try {
    records = cloneCanonicalValue(input.records, {
      active: new WeakSet<object>(),
      nodes: 0,
      textUnits: 0
    }, 0);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("canonical block records")) throw error;
    throw new Error("canonical block records failed controlled validation");
  }
  const snapshot = Object.freeze({
    number: input.number,
    hash,
    parentHash,
    records: records.value
  });
  return {
    snapshot,
    digest: `block-v1:${input.number.toString(10)}:${hash}:${parentHash}:${records.digest}`
  };
}

function cloneCanonicalValue<T>(input: T, budget: CloneBudget, depth: number): CanonicalClone<T> {
  if (depth > MAX_RECORD_DEPTH) throw new Error("canonical block records exceed maximum depth");
  budget.nodes += 1;
  if (budget.nodes > MAX_RECORD_NODES) throw new Error("canonical block records exceed maximum node count");

  if (input === null) return { value: input, digest: "n;" };
  if (typeof input === "boolean") return { value: input, digest: input ? "b1;" : "b0;" };
  if (typeof input === "string") {
    consumeTextBudget(budget, input.length);
    return { value: input, digest: `s${input.length}:${input}` };
  }
  if (typeof input === "bigint") {
    const encoded = input.toString(10);
    consumeTextBudget(budget, encoded.length);
    return { value: input, digest: `i${encoded.length}:${encoded}` };
  }
  if (typeof input === "number") {
    if (!Number.isFinite(input)) throw new Error("canonical block records contain a non-finite number");
    const encoded = Object.is(input, -0) ? "-0" : input.toString();
    return { value: input, digest: `d${encoded.length}:${encoded}` };
  }
  if (typeof input !== "object") {
    throw new Error("canonical block records support only null, booleans, strings, finite numbers, bigints, arrays and plain objects");
  }
  if (budget.active.has(input)) throw new Error("canonical block records must not be cyclic");
  budget.active.add(input);
  try {
    if (Array.isArray(input)) {
      if (budget.nodes + input.length > MAX_RECORD_NODES) {
        throw new Error("canonical block records exceed maximum node count");
      }
      const ownKeys = Reflect.ownKeys(input);
      if (ownKeys.some((key) => typeof key === "symbol") || ownKeys.length !== input.length + 1) {
        throw new Error("canonical block records: arrays must be dense and contain only canonical index properties");
      }
      const descriptors = Object.getOwnPropertyDescriptors(input);
      const children: CanonicalClone<unknown>[] = [];
      for (let index = 0; index < input.length; index += 1) {
        const descriptor = descriptors[index.toString()];
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          throw new Error("canonical block records: arrays must be dense and contain only canonical index properties");
        }
        children.push(cloneCanonicalValue(descriptor.value, budget, depth + 1));
      }
      if (!ownKeys.includes("length")) {
        throw new Error("canonical block records: arrays must expose their canonical length property");
      }
      const value = Object.freeze(children.map((child) => child.value)) as T;
      return { value, digest: `a${children.length}:[${children.map((child) => child.digest).join("")}]` };
    }
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("canonical block records support only plain objects and arrays");
    }
    const ownKeys = Reflect.ownKeys(input);
    if (ownKeys.some((key) => typeof key === "symbol")) {
      throw new Error("canonical block records must not contain symbol keys");
    }
    const keys = (ownKeys as string[]).sort();
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const output: Record<string, unknown> = {};
    const digestParts: string[] = [];
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !("value" in descriptor)) {
        throw new Error("canonical block records require enumerable data properties");
      }
      consumeTextBudget(budget, key.length);
      const child = cloneCanonicalValue(descriptor.value, budget, depth + 1);
      Object.defineProperty(output, key, {
        configurable: false,
        enumerable: true,
        value: child.value,
        writable: false
      });
      digestParts.push(`k${key.length}:${key}${child.digest}`);
    }
    return {
      value: Object.freeze(output) as T,
      digest: `o${keys.length}:{${digestParts.join("")}}`
    };
  } finally {
    budget.active.delete(input);
  }
}

function consumeTextBudget(budget: CloneBudget, units: number): void {
  budget.textUnits += units;
  if (budget.textUnits > MAX_RECORD_TEXT_UNITS) {
    throw new Error("canonical block records exceed maximum text size");
  }
}

function normalizeBlockHash(value: string, label: string): BlockHash {
  if (typeof value !== "string" || !BLOCK_HASH_PATTERN.test(value)) throw new Error(`${label} is invalid`);
  return value.toLowerCase() as BlockHash;
}

function compareBigInt(left: bigint, right: bigint): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
