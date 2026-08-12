export class UnsupportedClosureError extends Error {
  constructor(closureCode, message) {
    super(message);
    this.name = "UnsupportedClosureError";
    this.closureCode = closureCode;
  }
}
