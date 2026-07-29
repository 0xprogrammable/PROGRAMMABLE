import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ExternalLink } from "lucide-react";

import { DocsShell } from "@/components/docs-shell";
import styles from "@/components/docs-experience.module.css";

export const metadata: Metadata = {
  title: "Docs",
  alternates: { canonical: "/docs" },
};

const classicLauncher =
  "0xD240D06f8586eB799f20056054e5b527405E6bAd";
const classicHook =
  "0x025a386eAa79f6067d29848FD05ccC71bEAb20CC";
const positionLockFactory =
  "0x291a9ff1059d225d02B1659430804486404dB507";

export default function DocsPage() {
  return (
    <DocsShell
      currentPath="/docs"
      title="Understand the launch before you sign it"
      description="How each model creates a token, routes fees, locks liquidity and reaches the interface."
    >
      <section id="overview">
        <span className={styles.sectionEyebrow}>Overview</span>
        <h2>One interface, distinct onchain models</h2>
        <p className={styles.lead}>
          Programmable launches fixed-supply ERC-20 tokens into Uniswap v4
          pools on Ethereum. Each launch model defines its pool structure, fee
          path and reward behavior before the wallet submits the transaction.
        </p>
        <div className={styles.callout}>
          <strong>The interface does not make a model interchangeable.</strong>
          <p>
            Classic, Deep and Stock-Paired have different economics and
            assumptions. Read the model page before launching or trading.
          </p>
        </div>

        <div className={styles.modelGrid}>
          <Link className={styles.modelCard} href="/docs/models/classic">
            <span className={styles.modelCardHeader}>
              <strong>Classic</strong>
              <span className={styles.status} data-status="live">
                Live
              </span>
            </span>
            <p>
              Fixed swap fees with creator rewards paid in ETH through the
              canonical v4 pool.
            </p>
            <span className={styles.modelLink}>
              Read Classic
              <ArrowRight aria-hidden="true" size={14} />
            </span>
          </Link>

          <Link className={styles.modelCard} href="/docs/models/deep">
            <span className={styles.modelCardHeader}>
              <strong>Deep</strong>
              <span className={styles.status}>Coming soon</span>
            </span>
            <p>
              Uses the model&apos;s fee share to buy the token and add
              permanently pool-bound liquidity.
            </p>
            <span className={styles.modelLink}>
              Read Deep
              <ArrowRight aria-hidden="true" size={14} />
            </span>
          </Link>

          <Link
            className={styles.modelCard}
            href="/docs/models/stock-paired"
          >
            <span className={styles.modelCardHeader}>
              <strong>Stock-Paired</strong>
              <span className={styles.status}>Limited access</span>
            </span>
            <p>
              Creates a token whose v4 pool uses a reviewed stock token as the
              quote asset.
            </p>
            <span className={styles.modelLink}>
              Read Stock-Paired
              <ArrowRight aria-hidden="true" size={14} />
            </span>
          </Link>
        </div>
      </section>

      <section id="launching">
        <span className={styles.sectionEyebrow}>Launching</span>
        <h2>From idea to confirmed transaction</h2>
        <ol className={styles.steps}>
          <li>
            <strong>Choose a model</strong>
            <span>
              The model determines the pool, fee accounting and reward path.
            </span>
          </li>
          <li>
            <strong>Define the token</strong>
            <span>
              Add the name, ticker, image, description, project links and
              model-specific inputs.
            </span>
          </li>
          <li>
            <strong>Review the prepared call</strong>
            <span>
              Programmable validates the active deployment and simulates the
              exact call before opening the wallet.
            </span>
          </li>
          <li>
            <strong>Confirm in the wallet</strong>
            <span>
              The connected wallet submits the transaction and pays Ethereum
              gas. A successful receipt becomes the launch record.
            </span>
          </li>
        </ol>
      </section>

      <section id="trading">
        <span className={styles.sectionEyebrow}>Trading and pricing</span>
        <h2>The canonical pool is the source of truth</h2>
        <p>
          Explore and token pages use the pool recorded by the verified launch
          event. Quotes are prepared against that exact pool. Market cap is an
          estimate based on confirmed pool price and fixed token supply, not a
          promise of executable value.
        </p>
        <div className={styles.factGrid}>
          <div className={styles.fact}>
            <span>Quotes</span>
            <strong>Prepared against the recorded Uniswap v4 pool</strong>
          </div>
          <div className={styles.fact}>
            <span>Market cap</span>
            <strong>Confirmed pool price multiplied by fixed supply</strong>
          </div>
          <div className={styles.fact}>
            <span>Third-party routes</span>
            <strong>May use a different path or may not support the hook</strong>
          </div>
          <div className={styles.fact}>
            <span>Price impact</span>
            <strong>Depends on live liquidity and trade size</strong>
          </div>
        </div>
      </section>

      <section id="rewards">
        <span className={styles.sectionEyebrow}>Creator rewards</span>
        <h2>Rewards follow the selected model</h2>
        <p>
          Classic rewards accrue in ETH for swaps through the canonical pool.
          Stock-Paired rewards accrue in its selected quote token. Deep has no
          creator reward because its 0.90% model share is committed to
          liquidity growth. The connected beneficiary can review available
          claims in Profile.
        </p>
        <div className={styles.callout}>
          <strong>A claim does not change the pool policy.</strong>
          <p>
            Calling a claim can only pay the destination defined by that model.
            It cannot redirect another recipient&apos;s rewards.
          </p>
        </div>
      </section>

      <section id="network">
        <span className={styles.sectionEyebrow}>Network</span>
        <h2>Ethereum Mainnet</h2>
        <p>
          Public launches use Ethereum Mainnet and the official Uniswap v4
          PoolManager, PositionManager, StateView, quoter and router
          deployments. The wallet must be connected to Ethereum before it can
          submit a launch or trade.
        </p>
        <div className={styles.factGrid}>
          <div className={styles.fact}>
            <span>Chain ID</span>
            <strong>1</strong>
          </div>
          <div className={styles.fact}>
            <span>Gas asset</span>
            <strong>ETH</strong>
          </div>
        </div>
      </section>

      <section id="contracts">
        <span className={styles.sectionEyebrow}>Contracts</span>
        <h2>Public deployment records</h2>
        <p>
          The addresses below belong to the active public Classic release.
          Model pages identify any separate deployment boundary.
        </p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Contract</th>
                <th>Address</th>
                <th>Purpose</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Classic launcher</td>
                <td>
                  <a
                    className={styles.address}
                    href={`https://etherscan.io/address/${classicLauncher}#code`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {classicLauncher}
                  </a>
                </td>
                <td>Creates the token, pool and initial locked position.</td>
              </tr>
              <tr>
                <td>Classic fee hook</td>
                <td>
                  <a
                    className={styles.address}
                    href={`https://etherscan.io/address/${classicHook}#code`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {classicHook}
                  </a>
                </td>
                <td>Accounts for the fixed ETH swap fee.</td>
              </tr>
              <tr>
                <td>Position lock factory</td>
                <td>
                  <a
                    className={styles.address}
                    href={`https://etherscan.io/address/${positionLockFactory}#code`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {positionLockFactory}
                  </a>
                </td>
                <td>Creates the recipient that permanently holds launch positions.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section id="metadata">
        <span className={styles.sectionEyebrow}>Token metadata</span>
        <h2>Project details travel with the token</h2>
        <p>
          The token metadata can include a description, image, website, X link
          and Telegram link. Programmable reads those values for Explore and
          token pages. External terminals control their own indexing,
          moderation and refresh timing, so display there is not guaranteed.
        </p>
      </section>

      <section id="releases">
        <span className={styles.sectionEyebrow}>Source and releases</span>
        <h2>Public code, explicit release gates</h2>
        <p>
          A model reaches the public launcher only when its deployment record,
          runtime code and required lifecycle evidence match the application
          release. Local tests or a design document are not a Mainnet release.
        </p>
        <div className={styles.sourceLinks}>
          <a
            href="https://github.com/0xprogrammable/programmable"
            target="_blank"
            rel="noreferrer"
          >
            Source repository
            <ExternalLink aria-hidden="true" size={13} />
          </a>
          <a
            href="https://github.com/0xprogrammable/programmable/tree/codex/deep-v3-mainnet-release/contracts/deployments"
            target="_blank"
            rel="noreferrer"
          >
            Deployment records
            <ExternalLink aria-hidden="true" size={13} />
          </a>
          <a
            href="https://docs.uniswap.org/contracts/v4/overview"
            target="_blank"
            rel="noreferrer"
          >
            Uniswap v4 docs
            <ExternalLink aria-hidden="true" size={13} />
          </a>
        </div>
      </section>

      <section id="risks">
        <span className={styles.sectionEyebrow}>Risk</span>
        <h2>What the interface cannot guarantee</h2>
        <ul className={styles.contentList}>
          <li>
            A transaction can fail, be irreversible or cost more when network
            conditions change.
          </li>
          <li>
            A fixed supply and locked launch position do not guarantee demand,
            price stability or deep liquidity.
          </li>
          <li>
            Tokens can be volatile, illiquid or lose all value.
          </li>
          <li>
            Third-party wallets, scanners and trading terminals make their own
            routing and display decisions.
          </li>
          <li>
            The contracts have not completed an external audit or public
            security contest.
          </li>
        </ul>
      </section>
    </DocsShell>
  );
}
