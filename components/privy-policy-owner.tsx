"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useWallet } from "@/components/wallet-provider";
import {
  privyPolicyOwnerErrorMessage,
  REVIEWED_PRIVY_POLICY_BINDINGS,
  REVIEWED_PRIVY_POLICY_BODY_SHA256,
  type PrivyPolicyOwnerOperation,
  type PrivyPolicyOwnerReview,
} from "@/lib/privy-policy-owner/handoff";
import styles from "./privy-policy-owner.module.css";

type ReviewCapability = ReturnType<typeof useWallet>["reviewPrivyPolicyOwnerRequest"];
type ImportedRequest = Readonly<{
  text: string;
  review: PrivyPolicyOwnerReview;
  reviewedBy: ReviewCapability;
}>;

function downloadSignature(text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "privy-policy-app-user-signature-v4.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // The URL contains no signature text and is only a short-lived local Blob handle.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function PrivyPolicyOwner() {
  const {
    authReady, authenticated, connecting, openWallet, preloadWallet,
    reviewPrivyPolicyOwnerRequest, signPrivyPolicyOwnerRequest,
  } = useWallet();
  const [operation, setOperation] = useState<PrivyPolicyOwnerOperation>("reconcile");
  const [acknowledged, setAcknowledged] = useState(false);
  const [request, setRequest] = useState<ImportedRequest | null>(null);
  const [busy, setBusy] = useState<"review" | "sign" | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [now, setNow] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const revisionRef = useRef(0);
  const signingRef = useRef(false);

  useEffect(() => {
    if (!request) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [request]);
  useEffect(() => () => { revisionRef.current += 1; }, []);

  const sessionMatches = authReady && authenticated
    && request?.reviewedBy === reviewPrivyPolicyOwnerRequest;
  const secondsLeft = request
    ? Math.max(0, Math.ceil((Date.parse(request.review.artifact.expiresAt) - now) / 1_000))
    : 0;
  const expired = request !== null && secondsLeft === 0;
  const readyToSign = Boolean(request && sessionMatches && !expired && acknowledged && !busy);

  function chooseOperation(next: PrivyPolicyOwnerOperation) {
    revisionRef.current += 1;
    setOperation(next);
    setRequest(null);
    setAcknowledged(false);
    setError("");
    setStatus("");
    if (inputRef.current) inputRef.current.value = "";
  }

  async function importRequest(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    const revision = ++revisionRef.current;
    setRequest(null);
    setError("");
    setStatus("");
    if (!file) return;
    if (file.size === 0 || file.size > 65_536) {
      setError("Choose the operator request JSON file, no larger than 64 KiB.");
      return;
    }
    if (!authReady || !authenticated) {
      setError("Sign in with the existing policy owner account before importing a request.");
      return;
    }
    setBusy("review");
    try {
      const text = await file.text();
      const review = await reviewPrivyPolicyOwnerRequest({ text, operation });
      if (revision !== revisionRef.current) return;
      setNow(Date.now());
      setRequest({ text, review, reviewedBy: reviewPrivyPolicyOwnerRequest });
      setStatus("Request verified for this owner session. Signing does not apply the policy.");
    } catch (cause) {
      if (revision === revisionRef.current) setError(privyPolicyOwnerErrorMessage(cause));
    } finally {
      if (revision === revisionRef.current) setBusy(null);
    }
  }

  async function signRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (signingRef.current) return;
    if (!readyToSign || !request) {
      setError("Review the policy, confirm your consent, and import a fresh request from the operator.");
      return;
    }
    signingRef.current = true;
    const revision = revisionRef.current;
    setBusy("sign");
    setError("");
    setStatus("Waiting for your policy authorization signature…");
    try {
      const signature = await signPrivyPolicyOwnerRequest({
        text: request.text,
        operation,
        reviewedRequestArtifactSha256: request.review.requestArtifactSha256,
      });
      if (revision !== revisionRef.current) return;
      downloadSignature(signature);
      setRequest(null);
      setAcknowledged(false);
      if (inputRef.current) inputRef.current.value = "";
      setStatus("Signature downloaded. Return it immediately to the operator before the original request expires. No policy was applied by this page.");
    } catch (cause) {
      if (revision === revisionRef.current) {
        setError(privyPolicyOwnerErrorMessage(cause));
        setStatus("");
      }
    } finally {
      signingRef.current = false;
      if (revision === revisionRef.current) setBusy(null);
    }
  }

  return (
    <section className={styles.page} aria-labelledby="owner-policy-title">
      <header className={styles.header}>
        <p className={styles.eyebrow}>Custom Launch / policy owner</p>
        <h1 id="owner-policy-title">Authorize the prepared policy</h1>
        <p className={styles.intro}>
          Sign one exact Privy policy request with the existing owner account.
          This page downloads your signature; only the operator can apply the change.
        </p>
      </header>

      <div className={styles.layout}>
        <div className={styles.review}>
          <h2>1. Review the policy change</h2>
          <fieldset className={styles.operations} disabled={busy !== null}>
            <legend>Choose the prepared operation</legend>
            <label><input type="radio" name="operation" value="reconcile" checked={operation === "reconcile"}
              onChange={() => chooseOperation("reconcile")} /> Add Robinhood</label>
            <label><input type="radio" name="operation" value="rollback" checked={operation === "rollback"}
              onChange={() => chooseOperation("rollback")} /> Restore Ethereum only</label>
          </fieldset>
          <p className={styles.consequence}>
            {operation === "reconcile"
              ? "Keep the Ethereum permit rule and add the equivalent restricted rule for Robinhood Chain."
              : "Remove the Robinhood permit rule and restore the reviewed Ethereum only policy."}
          </p>
          <dl className={styles.facts}>
            <div><dt>Ethereum · chain 1</dt><dd><code>0x755509eA6e3F5Ec1aA2E797bb68f1B87DD8b886b</code><span>Unchanged</span></dd></div>
            <div><dt>Robinhood · chain 4663</dt><dd><code>0xeD617CE7f82e2AB589aDeFFD319D1D872Bc8De06</code><span>{operation === "reconcile" ? "Add restricted permit rule" : "Remove permit rule"}</span></dd></div>
          </dl>
          <p className={styles.explanation}>
            Only <code>eth_signTypedData_v4</code> is allowed, for <code>SafeMessage(message:bytes)</code> with
            the exact chain and verifying contract above. The message must be in the existing condition set.
            All other requests remain denied.
          </p>
          <p className={styles.explanation}>
            The policy owner, wallets, quorums and condition set are unchanged. No funds move and no blockchain transaction is sent here.
          </p>
          <details className={styles.details}>
            <summary>Show exact policy bindings</summary>
            <dl className={styles.facts}>
              {Object.entries(REVIEWED_PRIVY_POLICY_BINDINGS).map(([key, value]) =>
                <div key={key}><dt>{key}</dt><dd><code>{value}</code></dd></div>)}
              <div><dt>Reviewed request body</dt><dd><code>{REVIEWED_PRIVY_POLICY_BODY_SHA256[operation]}</code></dd></div>
              <div><dt>Typed data domain</dt><dd><code>chainId:uint256, verifyingContract:address</code></dd></div>
            </dl>
          </details>
        </div>

        <form className={styles.console} onSubmit={signRequest}>
          <h2>2. Prepare to sign</h2>
          <p className={styles.explanation}>
            Review and sign in first. Then ask the operator to prepare the file: its 30 second window cannot be extended.
          </p>
          <div className={styles.session}>
            <span>{authReady && authenticated ? "Signed in · owner checked on import" : "Owner sign in required"}</span>
            <button type="button" className={styles.secondary} onClick={openWallet}
              onFocus={preloadWallet} onPointerEnter={preloadWallet} disabled={busy !== null || connecting}>
              {connecting ? "Connecting…" : authenticated ? "Manage session" : "Connect owner wallet"}
            </button>
          </div>
          <p className={styles.hint}>Use the existing linked owner wallet. The imported file must match the signed in Privy account.</p>
          <label className={styles.acknowledgement}>
            <input type="checkbox" checked={acknowledged} disabled={busy !== null}
              onChange={(event) => setAcknowledged(event.target.checked)} />
            <span>I reviewed the exact policy change above and authorize this operation.</span>
          </label>

          <h2 className={styles.importHeading}>3. Import the fresh request</h2>
          <label className={styles.fileLabel} htmlFor="owner-policy-request">Prepared request JSON</label>
          <input ref={inputRef} className={styles.fileInput} id="owner-policy-request" type="file"
            accept="application/json,.json" onChange={importRequest}
            disabled={busy !== null || !authReady || !authenticated}
            aria-invalid={error ? true : undefined} aria-describedby="owner-policy-file-hint owner-policy-error" />
          <p id="owner-policy-file-hint" className={styles.hint}>Unmodified operator artifact · maximum 64 KiB · no API keys or private keys</p>
          {request ? <div className={styles.request}>
            <p className={styles.timer} aria-live="off">
              {expired ? "Request expired — ask for a fresh file" : `${secondsLeft} seconds remaining`}
            </p>
            {!sessionMatches ? <p>Your owner session changed. Import a fresh request.</p> : null}
            <dl className={styles.facts}>
              <div><dt>Request digest</dt><dd><code>{request.review.artifact.requestSha256}</code></dd></div>
              <div><dt>Source policy digest</dt><dd><code>{request.review.artifact.sourcePolicySha256}</code></dd></div>
              <div><dt>Target policy digest</dt><dd><code>{request.review.artifact.targetPolicySha256}</code></dd></div>
            </dl>
          </div> : null}
          <p className={styles.error} id="owner-policy-error" role="alert">{error}</p>
          <button type="submit" className={styles.primary} disabled={!readyToSign} aria-busy={busy === "sign"}>
            {busy === "review" ? "Verifying request…" : busy === "sign" ? "Sign policy request · waiting…" : "Sign policy request"}
          </button>
          <p className={styles.status} role="status" aria-atomic="true">
            {expired ? "Request expired. Ask the operator for a fresh file." : status}
          </p>
          <p className={styles.hint}>The signature authorizes only the original request until its original expiry. It is not a deployment or launch confirmation.</p>
        </form>
      </div>
      <a className={styles.back} href="/profile">Back to profile</a>
    </section>
  );
}
