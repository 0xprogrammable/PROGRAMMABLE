import type { Metadata } from "next";

import { DocsAddress } from "@/components/docs-address";
import { DocsExternalLink } from "@/components/docs-external-link";
import { DocsShell } from "@/components/docs-shell";
import styles from "@/components/docs-experience.module.css";

export const metadata: Metadata = {
  title: "Docs",
  alternates: { canonical: "/docs" },
};

const classicEvidenceCommit =
  "1fb9558af4f0248de75d5c7983f80036e32f47cb";
const classicLauncher =
  "0xC3bd04aAc2fb2ba58efD7Eb673E544E0B80De770";
const classicHook =
  "0x35Fe236EA82F7cF525c9719d7df8F49F94D720CC";
const classicRewardVaultFactory =
  "0xF28967f9DFaC3Ca21384b59D6D75C8106b3eab2a";
const positionLockFactory =
  "0x291a9ff1059d225d02B1659430804486404dB507";

const platformSections = [
  { id: "overview", label: "Overview" },
  { id: "launching", label: "Launch flow" },
  { id: "trading", label: "Trading and pricing" },
  { id: "rewards", label: "Creator rewards" },
  { id: "network", label: "Network" },
  { id: "contracts", label: "Contracts" },
  { id: "metadata", label: "Token metadata" },
  { id: "releases", label: "Release evidence" },
  { id: "risks", label: "Risks" },
] as const;

export default function DocsPage() {
  return (
    <DocsShell
      currentPath="/docs"
      title="Docs"
      description="Platform reference and launch-model documentation."
      sections={platformSections}
    >
      <section id="overview">
        <h2>Platform</h2>
        <p className={styles.lead}>
          Programmable launches fixed-supply ERC-20 tokens into Uniswap v4
          pools on Ethereum. A launch model defines the pool structure, fee
          path, reward rules and available controls before the wallet submits
          the transaction.
        </p>
        <p>
          Set buy and sell fees in Classic, then route creator rewards to the
          launch wallet, another wallet or a split of up to five wallets.
        </p>
        <div className={styles.callout}>
          <strong>Classic is available for new launches.</strong>
          <p>
            Custom Hook is documented as a product boundary but is not
            available in this build.
          </p>
        </div>
      </section>

      <section id="launching">
        <h2>From setup to a confirmed transaction</h2>
        <ol className={styles.steps}>
          <li>
            <strong>Choose a model</strong>
            <span>
              Check its release status, fee path and model-specific risks.
            </span>
          </li>
          <li>
            <strong>Set the token and launch terms</strong>
            <span>
              Add the name, ticker, image, description, project links and the
              settings available for that model.
            </span>
          </li>
          <li>
            <strong>Review the prepared transaction</strong>
            <span>
              Programmable checks the configured release and validates the
              prepared call before opening the wallet.
            </span>
          </li>
          <li>
            <strong>Confirm in the wallet</strong>
            <span>
              The connected wallet submits the transaction and pays Ethereum
              gas. A confirmed receipt becomes the launch record.
            </span>
          </li>
        </ol>
        <div className={styles.callout}>
          <strong>There is no separate Programmable launch charge.</strong>
          <p>
            The launch wallet pays network gas and the Initial Buy required by
            the selected model.
          </p>
        </div>
      </section>

      <section id="trading">
        <h2>The recorded pool is the source of truth</h2>
        <p>
          Explore and token pages read the pool recorded by the verified launch
          event. Market cap is an estimate based on confirmed pool price and
          fixed token supply. It is not a promise that the full supply can be
          sold at that price.
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
            <span>Price impact</span>
            <strong>Changes with live liquidity and trade size</strong>
          </div>
          <div className={styles.fact}>
            <span>External routes</span>
            <strong>May not support the pool or its hook correctly</strong>
          </div>
        </div>
      </section>

      <section id="rewards">
        <h2>Rewards follow the launch terms</h2>
        <p>
          Classic rewards accrue in ETH. A launch can assign them to the launch
          wallet, another wallet or a recorded split of up to five wallets. Each
          current payout wallet claims only its own allocation and can move
          future rewards for that allocation to a new address.
        </p>
        <p>
          Moving an allocation to a new payout address does not change its
          percentage. The disclosed CTO authority can replace future recipients
          and split percentages after checkpointing rewards already accrued
          under the current configuration.
        </p>
        <div className={styles.callout}>
          <strong>Claiming cannot change the launch economics.</strong>
          <p>
            A claim pays only the caller&apos;s recorded entitlement. It cannot
            alter fee rates, reward percentages or liquidity custody.
          </p>
        </div>
      </section>

      <section id="network">
        <h2>Ethereum Mainnet</h2>
        <p>
          Public launches use Ethereum Mainnet and the official Uniswap v4
          PoolManager, PositionManager, StateView, Quoter and Universal Router
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
        <h2>Active Classic deployment</h2>
        <p>
          These are the primary contracts behind the public Classic launcher.
          The release manifest records the complete deployment, runtime hashes
          and lifecycle evidence.
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
                  <DocsAddress
                    address={classicLauncher}
                    label="Classic launcher"
                  />
                </td>
                <td>Creates the token, pool and launch records.</td>
              </tr>
              <tr>
                <td>Classic fee hook</td>
                <td>
                  <DocsAddress address={classicHook} label="Classic fee hook" />
                </td>
                <td>Applies the immutable buy and sell fee settings.</td>
              </tr>
              <tr>
                <td>Reward vault factory</td>
                <td>
                  <DocsAddress
                    address={classicRewardVaultFactory}
                    label="Reward vault factory"
                  />
                </td>
                <td>Creates the reward vault for each Classic pool.</td>
              </tr>
              <tr>
                <td>Position recipient factory</td>
                <td>
                  <DocsAddress
                    address={positionLockFactory}
                    label="Position recipient factory"
                  />
                </td>
                <td>Permanently holds the launch position.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section id="metadata">
        <h2>Project details are public</h2>
        <p>
          Token metadata can include a description, image, website, X link and
          Telegram link. Programmable uses those values on Explore and token
          pages. External terminals control their own indexing, moderation and
          refresh timing, so display there is not guaranteed.
        </p>
      </section>

      <section id="releases">
        <h2>Source and deployment must match</h2>
        <p>
          A model reaches the public launcher only when its deployment record,
          runtime code and required lifecycle evidence match the application
          release. Local tests and design documents do not make a model live.
        </p>
        <div className={styles.sourceLinks}>
          <DocsExternalLink
            href="https://github.com/0xprogrammable/programmable"
            variant="chip"
          >
            Source repository
          </DocsExternalLink>
          <DocsExternalLink
            href={`https://github.com/0xprogrammable/programmable/blob/${classicEvidenceCommit}/contracts/deployments/mainnet-classic-v3.json`}
            variant="chip"
          >
            Classic release record
          </DocsExternalLink>
          <DocsExternalLink
            href={`https://github.com/0xprogrammable/programmable/blob/${classicEvidenceCommit}/contracts/security/CLASSIC-V3.md`}
            variant="chip"
          >
            Classic security notes
          </DocsExternalLink>
          <DocsExternalLink
            href="https://docs.uniswap.org/contracts/v4/overview"
            variant="chip"
          >
            Uniswap v4 documentation
          </DocsExternalLink>
        </div>
      </section>

      <section id="risks">
        <h2>What Programmable cannot guarantee</h2>
        <ul className={styles.contentList}>
          <li>
            A transaction can fail, be irreversible or cost more when network
            conditions change.
          </li>
          <li>
            Fixed supply and locked launch liquidity do not guarantee demand,
            price stability or deep liquidity.
          </li>
          <li>Tokens can be volatile, illiquid or lose all value.</li>
          <li>
            Third-party wallets, scanners and trading terminals make their own
            routing and display decisions.
          </li>
          <li>
            Source verification and lifecycle tests are not an independent
            audit or a guarantee that no vulnerability exists.
          </li>
        </ul>
      </section>
    </DocsShell>
  );
}
