/**
 * Browser send authority for actionHash/selectorHash is intentionally absent.
 * Replace this stub only with the exact frozen Facade formula or signature
 * over the binding, full transaction envelope (including gas), currentness and
 * action fields; structural SHA-256 strings are not execution authority.
 */
export function verifyHookemonActionIdentifierAuthorityForSendV1(
  action: unknown,
  binding: unknown,
): void {
  void action;
  void binding;
  throw new TypeError("Hookemon action identifier authority is unavailable");
}
