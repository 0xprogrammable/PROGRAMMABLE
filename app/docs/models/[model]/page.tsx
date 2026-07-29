import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";

import { DocsShell } from "@/components/docs-shell";
import styles from "@/components/docs-experience.module.css";

type ModelSlug = "classic" | "deep" | "stock-paired";

const modelMetadata: Record<
  ModelSlug,
  { description: string; title: string }
> = {
  classic: {
    title: "Classic",
    description:
      "Fixed swap fees, creator rewards in ETH and permanently locked one-sided Uniswap v4 liquidity.",
  },
  deep: {
    title: "Deep",
    description:
      "The coming Programmable model that turns its fee share into permanently pool-bound liquidity.",
  },
  "stock-paired": {
    title: "Stock-Paired",
    description:
      "A limited-access model whose Uniswap v4 pool uses a reviewed stock token as its quote asset.",
  },
};

function isModelSlug(value: string): value is ModelSlug {
  return value in modelMetadata;
}

export function generateStaticParams() {
  return Object.keys(modelMetadata).map((model) => ({ model }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ model: string }>;
}): Promise<Metadata> {
  const { model } = await params;
  if (!isModelSlug(model)) return {};

  const metadata = modelMetadata[model];
  return {
    title: metadata.title,
    description: metadata.description,
    alternates: { canonical: `/docs/models/${model}` },
  };
}

function ClassicDocs() {
  const launcher = "0xD240D06f8586eB799f20056054e5b527405E6bAd";
  const hook = "0x025a386eAa79f6067d29848FD05ccC71bEAb20CC";

  return (
    <DocsShell
      currentPath="/docs/models/classic"
      kicker="Launch model · Live"
      title="Classic"
      description="Fixed swap fees, creator rewards in ETH and a direct path into Uniswap v4."
    >
      <section>
        <span className={styles.sectionEyebrow}>What it does</span>
        <h2>A fixed-supply token with a fixed fee policy</h2>
        <p className={styles.lead}>
          Classic creates a new token, initializes its ETH pool and places the
          complete supply into a permanently locked one-sided Uniswap v4
          position in one launch transaction.
        </p>
        <div className={styles.factGrid}>
          <div className={styles.fact}>
            <span>Supply</span>
            <strong>1,000,000,000 tokens with 18 decimals</strong>
          </div>
          <div className={styles.fact}>
            <span>Transfer tax</span>
            <strong>0%</strong>
          </div>
          <div className={styles.fact}>
            <span>Public swap fee</span>
            <strong>1.00% through the canonical pool</strong>
          </div>
          <div className={styles.fact}>
            <span>Liquidity deposit</span>
            <strong>None from the creator</strong>
          </div>
        </div>
      </section>

      <section>
        <span className={styles.sectionEyebrow}>Fee path</span>
        <h2>Creator rewards are paid in ETH</h2>
        <div className={styles.flow}>
          <div className={styles.flowItem}>
            <span>Swap</span>
            <strong>A buy or sell reaches the canonical v4 pool</strong>
          </div>
          <div className={styles.flowItem}>
            <span>Total fee</span>
            <strong>1.00% is accounted on the ETH side</strong>
          </div>
          <div className={styles.flowItem}>
            <span>Creator</span>
            <strong>0.90% accrues as creator rewards</strong>
          </div>
          <div className={styles.flowItem}>
            <span>Programmable</span>
            <strong>0.10% accrues to the protocol treasury</strong>
          </div>
        </div>
        <div className={styles.callout}>
          <strong>The Programmable share is not added on top.</strong>
          <p>
            It is deducted from the fixed 1.00% hook fee. Normal ERC-20
            transfers do not pay this fee.
          </p>
        </div>
      </section>

      <section>
        <span className={styles.sectionEyebrow}>Launch transaction</span>
        <h2>What the wallet approves</h2>
        <ol className={styles.steps}>
          <li>
            <strong>Create the fixed-supply token</strong>
            <span>
              The official Uniswap UERC20 factory creates the token and stores
              its metadata.
            </span>
          </li>
          <li>
            <strong>Create and initialize the canonical pool</strong>
            <span>
              ETH is the quote asset and the hook records the fixed fee policy.
            </span>
          </li>
          <li>
            <strong>Lock the complete launch position</strong>
            <span>
              The full token supply enters one one-sided position with no
              liquidity-removal path.
            </span>
          </li>
          <li>
            <strong>Execute the Initial Buy</strong>
            <span>
              The creator chooses at least 0.0006 ETH. Purchased tokens go
              directly to the creator.
            </span>
          </li>
        </ol>
      </section>

      <section>
        <span className={styles.sectionEyebrow}>Opening price</span>
        <h2>A deterministic starting valuation</h2>
        <p>
          The current Classic release starts at an approximate fully diluted
          valuation of 1.36 ETH. This is a mathematical starting point, not
          guaranteed liquidity, sale proceeds or future market value. The
          Initial Buy moves the live pool price before public trading begins.
        </p>
      </section>

      <section>
        <span className={styles.sectionEyebrow}>Token behavior</span>
        <h2>What Classic does not add</h2>
        <ul className={styles.contentList}>
          <li>No minting after launch.</li>
          <li>No blacklist, sell restriction, rebase or transfer tax.</li>
          <li>No token allocation for the creator or Programmable.</li>
          <li>No protocol launch fee beyond Ethereum gas.</li>
          <li>
            No guarantee that a third-party terminal routes through the
            canonical hooked pool.
          </li>
        </ul>
      </section>

      <section>
        <span className={styles.sectionEyebrow}>Contracts</span>
        <h2>Active public deployment</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Contract</th>
                <th>Address</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Launcher</td>
                <td>
                  <a
                    className={styles.address}
                    href={`https://etherscan.io/address/${launcher}#code`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {launcher}
                  </a>
                </td>
              </tr>
              <tr>
                <td>Fee hook</td>
                <td>
                  <a
                    className={styles.address}
                    href={`https://etherscan.io/address/${hook}#code`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {hook}
                  </a>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className={styles.sourceLinks}>
          <a
            href="https://github.com/0xprogrammable/programmable/blob/codex/deep-v3-mainnet-release/contracts/deployments/mainnet-classic-v2.json"
            target="_blank"
            rel="noreferrer"
          >
            Deployment record
            <ExternalLink aria-hidden="true" size={13} />
          </a>
          <a
            href="https://github.com/0xprogrammable/programmable/blob/codex/deep-v3-mainnet-release/contracts/security/REVIEW-MEME-V1-2026-07-26.md"
            target="_blank"
            rel="noreferrer"
          >
            Launch review
            <ExternalLink aria-hidden="true" size={13} />
          </a>
        </div>
      </section>
    </DocsShell>
  );
}

function DeepDocs() {
  return (
    <DocsShell
      currentPath="/docs/models/deep"
      kicker="Launch model · Coming soon"
      title="Deep"
      description="A fixed-supply launch designed to turn trading fees into permanently pool-bound liquidity."
    >
      <section>
        <span className={styles.sectionEyebrow}>Release status</span>
        <h2>Documented, not publicly launchable</h2>
        <p className={styles.lead}>
          Deep is still behind the production release gate. Its contracts,
          source verification, launch lifecycle and live automation evidence
          must all match before the Launch page can enable it.
        </p>
        <div className={styles.callout}>
          <strong>Coming soon means no Mainnet launch is available.</strong>
          <p>
            Tests, simulations and a completed interface do not change that
            status.
          </p>
        </div>
      </section>

      <section>
        <span className={styles.sectionEyebrow}>Model</span>
        <h2>Trading fees return to the original pool</h2>
        <div className={styles.flow}>
          <div className={styles.flowItem}>
            <span>Swap</span>
            <strong>A trade pays the fixed 1.00% hook fee in ETH</strong>
          </div>
          <div className={styles.flowItem}>
            <span>Growth share</span>
            <strong>0.90% accrues inside the pool&apos;s growth vault</strong>
          </div>
          <div className={styles.flowItem}>
            <span>Compound</span>
            <strong>Bounded ETH buys tokens in the original pool</strong>
          </div>
          <div className={styles.flowItem}>
            <span>Liquidity</span>
            <strong>ETH and tokens enter permanent full-range liquidity</strong>
          </div>
        </div>
        <p>
          The remaining 0.10% accrues to the Programmable treasury. Deep has no
          creator reward, payout address, rescue path or liquidity-removal
          control.
        </p>
      </section>

      <section>
        <span className={styles.sectionEyebrow}>Automation</span>
        <h2>Five minutes is the earliest eligible retry</h2>
        <p>
          A reviewed offchain executor pays gas and checks eligible pools.
          When the vault has enough accounted fees and its safety checks pass,
          it can compound no more than once in an eligible five-minute window.
          If a cycle cannot run, it is skipped and checked again later.
        </p>
        <div className={styles.factGrid}>
          <div className={styles.fact}>
            <span>Minimum interval</span>
            <strong>5 minutes after a successful compound</strong>
          </div>
          <div className={styles.fact}>
            <span>Minimum pending growth</span>
            <strong>0.002 ETH</strong>
          </div>
          <div className={styles.fact}>
            <span>Per-cycle maximum</span>
            <strong>0.25 ETH before tighter depth limits</strong>
          </div>
          <div className={styles.fact}>
            <span>Oracle history</span>
            <strong>30-minute pool observations required</strong>
          </div>
        </div>
      </section>

      <section>
        <span className={styles.sectionEyebrow}>Protection</span>
        <h2>Growth is bounded by live pool conditions</h2>
        <ul className={styles.contentList}>
          <li>
            Spot, short-window and long-window pool prices must remain within
            fixed deviation limits.
          </li>
          <li>
            The internal buy must stay within the per-cycle price-impact limit.
          </li>
          <li>
            The growth budget is capped by accounted ETH and permanent,
            factory-proven pool depth.
          </li>
          <li>
            The swap and liquidity addition happen atomically. A failed
            compound changes neither accounting nor liquidity.
          </li>
        </ul>
      </section>

      <section>
        <span className={styles.sectionEyebrow}>Boundaries</span>
        <h2>What deeper liquidity does not solve</h2>
        <ul className={styles.contentList}>
          <li>It does not guarantee demand or prevent the token price falling.</li>
          <li>It does not remove all manipulation, MEV or execution risk.</li>
          <li>
            An offchain executor is required. Smart contracts do not wake
            themselves every five minutes.
          </li>
          <li>
            Uniswap protocol fees, if enabled for the pool, are separate from
            the fixed Programmable hook fee.
          </li>
        </ul>
        <div className={styles.sourceLinks}>
          <a
            href="https://github.com/0xprogrammable/programmable/blob/codex/deep-v3-mainnet-release/docs/superpowers/specs/2026-07-29-deep-eth-buy-and-lock-design.md"
            target="_blank"
            rel="noreferrer"
          >
            Design specification
            <ExternalLink aria-hidden="true" size={13} />
          </a>
          <a
            href="https://github.com/0xprogrammable/programmable/blob/codex/deep-v3-mainnet-release/contracts/security/DEEP-V3.md"
            target="_blank"
            rel="noreferrer"
          >
            Security notes
            <ExternalLink aria-hidden="true" size={13} />
          </a>
        </div>
      </section>
    </DocsShell>
  );
}

function StockPairedDocs() {
  const launcher = "0x195750f33caD5eF2DF857a53226B421297A1e79e";
  const hook = "0x7773D183fe7B60d4F1885047fa42b815a62Fe0Cc";

  return (
    <DocsShell
      currentPath="/docs/models/stock-paired"
      kicker="Launch model · Limited access"
      title="Stock-Paired"
      description="A fixed-supply token whose Uniswap v4 pool uses a reviewed stock token as the quote asset."
    >
      <section>
        <span className={styles.sectionEyebrow}>Product boundary</span>
        <h2>The launched token is not a share</h2>
        <p className={styles.lead}>
          Stock-Paired creates a new Programmable token and pairs it with one
          supported Ondo Global Markets token. The launched token does not
          represent ownership in the company and is not redeemable for the
          selected stock.
        </p>
        <div className={styles.callout}>
          <strong>General public access is not enabled.</strong>
          <p>
            The release is restricted while route, issuer and integration
            boundaries remain under review.
          </p>
        </div>
      </section>

      <section>
        <span className={styles.sectionEyebrow}>Launch flow</span>
        <h2>ETH in, stock-token pool underneath</h2>
        <ol className={styles.steps}>
          <li>
            <strong>Choose a supported quote asset</strong>
            <span>NVDAon, SPYon, GOOGLon, SLVon, TSLAon or AAPLon.</span>
          </li>
          <li>
            <strong>Enter the Initial Buy in ETH</strong>
            <span>
              The coordinator routes ETH through reviewed pools into the
              selected quote asset.
            </span>
          </li>
          <li>
            <strong>Create and lock the new token pool</strong>
            <span>
              The token supply enters a permanently locked one-sided v4
              position against the quote asset.
            </span>
          </li>
          <li>
            <strong>Complete the Initial Buy</strong>
            <span>
              The routed quote asset buys the launched token in the same wallet
              transaction.
            </span>
          </li>
        </ol>
      </section>

      <section>
        <span className={styles.sectionEyebrow}>Economics</span>
        <h2>Rewards accrue in the quote token</h2>
        <div className={styles.factGrid}>
          <div className={styles.fact}>
            <span>Supply</span>
            <strong>1,000,000,000 tokens</strong>
          </div>
          <div className={styles.fact}>
            <span>Transfer tax</span>
            <strong>0%</strong>
          </div>
          <div className={styles.fact}>
            <span>Creator share</span>
            <strong>0.90% in the selected quote token</strong>
          </div>
          <div className={styles.fact}>
            <span>Programmable share</span>
            <strong>0.10% in the selected quote token</strong>
          </div>
        </div>
      </section>

      <section>
        <span className={styles.sectionEyebrow}>Trading</span>
        <h2>The interface composes the route</h2>
        <p>
          A buy routes ETH into the reviewed stock token and then into the
          launched token&apos;s exact v4 pool. A sell reverses that path back to
          ETH. The server checks the current round trip before preparing a
          transaction and fails closed when the route is too thin.
        </p>
        <div className={styles.callout}>
          <strong>External terminals do not inherit this route.</strong>
          <p>
            GMGN, Fomo and other interfaces must support the combined route
            themselves. Programmable cannot represent them as compatible
            without direct testing.
          </p>
        </div>
      </section>

      <section>
        <span className={styles.sectionEyebrow}>Issuer assumptions</span>
        <h2>The quote asset has its own controls</h2>
        <ul className={styles.contentList}>
          <li>
            Ondo controls the supported quote-token implementation and can
            upgrade, pause or restrict it.
          </li>
          <li>
            Availability can depend on issuer controls, jurisdiction, market
            hours and third-party eligibility.
          </li>
          <li>
            Programmable does not mint, redeem or promise delivery of the
            underlying share.
          </li>
          <li>
            New launches fail closed when the reviewed quote-token runtime no
            longer matches.
          </li>
        </ul>
      </section>

      <section>
        <span className={styles.sectionEyebrow}>Contracts</span>
        <h2>Restricted Mainnet deployment</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Contract</th>
                <th>Address</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Launcher</td>
                <td>
                  <a
                    className={styles.address}
                    href={`https://etherscan.io/address/${launcher}#code`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {launcher}
                  </a>
                </td>
              </tr>
              <tr>
                <td>Fee hook</td>
                <td>
                  <a
                    className={styles.address}
                    href={`https://etherscan.io/address/${hook}#code`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {hook}
                  </a>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className={styles.sourceLinks}>
          <a
            href="https://github.com/0xprogrammable/programmable/blob/codex/deep-v3-mainnet-release/docs/superpowers/specs/2026-07-29-stock-paired-v1-design.md"
            target="_blank"
            rel="noreferrer"
          >
            Model specification
            <ExternalLink aria-hidden="true" size={13} />
          </a>
          <a
            href="https://github.com/0xprogrammable/programmable/blob/codex/deep-v3-mainnet-release/contracts/deployments/mainnet-stock-paired-v1.json"
            target="_blank"
            rel="noreferrer"
          >
            Deployment record
            <ExternalLink aria-hidden="true" size={13} />
          </a>
        </div>
      </section>
    </DocsShell>
  );
}

export default async function ModelDocsPage({
  params,
}: {
  params: Promise<{ model: string }>;
}) {
  const { model } = await params;
  if (!isModelSlug(model)) notFound();

  if (model === "classic") return <ClassicDocs />;
  if (model === "deep") return <DeepDocs />;
  return <StockPairedDocs />;
}
