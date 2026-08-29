export class ProgrammableSdkError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProgrammableSdkError";
    this.code = code;
  }
}

export function invariant(
  condition: unknown,
  code: string,
  message: string,
): asserts condition {
  if (!condition) {
    throw new ProgrammableSdkError(code, message);
  }
}
