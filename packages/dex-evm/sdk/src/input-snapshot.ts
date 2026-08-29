import { ProgrammableSdkError } from "./errors.js";

type DataRecord = Readonly<Record<string, unknown>>;

function snapshotFailure(code: string, message: string): never {
  throw new ProgrammableSdkError(code, message);
}

function ownDescriptors(value: object, label: string): PropertyDescriptorMap {
  try {
    return Object.getOwnPropertyDescriptors(value);
  } catch (error) {
    throw new ProgrammableSdkError(
      "SDK_INPUT_DESCRIPTOR_INVALID",
      `${label} descriptors could not be captured`,
      { cause: error },
    );
  }
}

function assertDataDescriptor(
  descriptor: PropertyDescriptor | undefined,
  label: string,
): asserts descriptor is PropertyDescriptor & { readonly value: unknown } {
  if (descriptor === undefined || !("value" in descriptor)) {
    snapshotFailure("SDK_INPUT_ACCESSOR_REJECTED", `${label} must be an own data property`);
  }
  if (!descriptor.enumerable) {
    snapshotFailure("SDK_INPUT_NON_ENUMERABLE_REJECTED", `${label} must be enumerable`);
  }
}

/**
 * Captures every own enumerable data property exactly once. Callers validate and
 * use only the returned null-prototype snapshot, never the original object.
 */
export function snapshotDataRecord(value: unknown, label: string): DataRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    snapshotFailure("SDK_INPUT_OBJECT_INVALID", `${label} must be an object`);
  }
  const descriptors = ownDescriptors(value, label);
  const snapshot = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") {
      snapshotFailure("SDK_INPUT_SYMBOL_REJECTED", `${label} cannot contain symbol properties`);
    }
    const descriptor = descriptors[key];
    assertDataDescriptor(descriptor, `${label}.${key}`);
    Object.defineProperty(snapshot, key, {
      value: descriptor.value,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return Object.freeze(snapshot);
}

/**
 * Captures one dense Array using one descriptor snapshot. `validateLength` runs
 * before allocating or iterating the result so module-specific limits retain
 * their exact error codes and bound attacker-controlled work.
 */
export function snapshotDenseArray<T = unknown>(
  value: unknown,
  label: string,
  validateLength?: (length: number) => void,
): readonly T[] {
  if (!Array.isArray(value)) {
    snapshotFailure("SDK_INPUT_ARRAY_INVALID", `${label} must be an array`);
  }
  const descriptors = ownDescriptors(value, label);
  const lengthDescriptor = descriptors["length"];
  if (
    lengthDescriptor === undefined ||
    !("value" in lengthDescriptor) ||
    typeof lengthDescriptor.value !== "number" ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    snapshotFailure("SDK_INPUT_ARRAY_LENGTH_INVALID", `${label}.length is invalid`);
  }
  const length = lengthDescriptor.value;
  validateLength?.(length);

  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") {
      snapshotFailure("SDK_INPUT_SYMBOL_REJECTED", `${label} cannot contain symbol properties`);
    }
    if (key === "length") continue;
    if (!/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= length) {
      snapshotFailure("SDK_INPUT_ARRAY_PROPERTY_INVALID", `${label} contains non-index property ${key}`);
    }
  }

  const snapshot: T[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (descriptor === undefined) {
      snapshotFailure("SDK_INPUT_SPARSE_ARRAY_REJECTED", `${label} cannot contain sparse positions`);
    }
    assertDataDescriptor(descriptor, `${label}[${index}]`);
    snapshot.push(descriptor.value as T);
  }
  return Object.freeze(snapshot);
}

export function assertExactKeys(
  value: DataRecord,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      snapshotFailure("SDK_INPUT_UNKNOWN_FIELD", `${label} contains unknown field ${key}`);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      snapshotFailure("SDK_INPUT_MISSING_FIELD", `${label} is missing ${key}`);
    }
  }
}
