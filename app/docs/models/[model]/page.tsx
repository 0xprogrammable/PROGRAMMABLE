import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DocsAddress } from "@/components/docs-address";
import { DocsExternalLink } from "@/components/docs-external-link";
import { DocsShell } from "@/components/docs-shell";
import styles from "@/components/docs-experience.module.css";

type ModelSlug = "classic" | "custom" | "stock-paired";

const classicEvidenceCommit =
  "1fb9558af4f0248de75d5c7983f80036e32f47cb";
const stockPairedEvidenceCommit =
  "ef2bbb51336a20aa2886dad0232f61495e8f2911";

const classicSections = [
  { id: "terms", label: "Terms" },
  { id: "fees", label: "Fees" },
  { id: "rewards", label: "Rewards" },
  { id: "initial-buy", label: "Initial Buy" },
  { id: "launch-transaction", label: "Launch transaction" },
  { id: "starting-point", label: "Starting point" },
  { id: "boundaries", label: "Boundaries" },
  { id: "deployment", label: "Deployment" },
] as const;

const customSections = [
  { id: "status", label: "Status" },
  { id: "release-requirements", label: "Release requirements" },
  { id: "project-presentation", label: "Project presentation" },
] as const;

const stockPairedSections = [
  { id: "token-boundary", label: "Token boundary" },
  { id: "pool-creation", label: "Pool creation" },
  { id: "quote-rewards", label: "Quote rewards" },
  { id: "routing", label: "Routing" },
  { id: "quote-controls", label: "Quote controls" },
  { id: "deployment", label: "Deployment" },
] as const;

const modelMetadata: Record<
  ModelSlug,
  { description: string; title: string }
> = {
  classic: {
    title: "Classic",
    description:
      "Configure buy and sell fees, creator rewards and Initial Buy custody for a fixed-supply Uniswap v4 token.",
  },
  custom: {
    title: "Custom Hook",
    description:
      "Product boundary and release requirements for custom launch configuration.",
  },
  "stock-paired": {
    title: "Stock-Paired",
    description:
      "Historical Uniswap v4 pools that use a reviewed stock token as their quote asset.",
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
    title: "Programmable",
    description: metadata.description,
    alternates: { canonical: `/docs/models/${model}` },
  };
}

function ClassicDocs() {
  const launcher = "0xC3bd04aAc2fb2ba58efD7Eb673E544E0B80De770";
  const hook = "0x35Fe236EA82F7cF525c9719d7df8F49F94D720CC";
  const rewardVaultFactory =
    "0xF28967f9DFaC3Ca21384b59D6D75C8106b3eab2a";
  const initialBuyCustodyFactory =
    "0xDe21b9c0Cc0AfDB9be20e8236113f066BB8C66f4";
  const positionRecipientFactory =
    "0x291a9ff1059d225d02B1659430804486404dB507";
  const ctoAuthority =
    "0x9746469Cd79fdDc5aA7218e7dd51c829ee518c0C";

  return (
    <DocsShell
      currentPath="/docs/models/classic"
      kicker="Launch model · Live"
      title="Classic"
      description="A fixed-supply Uniswap v4 launch with configurable fees, creator rewards in ETH and permanent one-sided liquidity."
      sections={classicSections}
    >
      <section id="terms">
        <h2>Set the terms before the token launches</h2>
        <p className={styles.lead}>
          Classic creates the token, initializes its ETH pool and deposits the
          complete supply into a permanently locked one-sided Uniswap v4
          position. The launch wallet chooses the buy fee, sell fee, reward
          destination and Initial Buy custody before signing.
        </p>
        <div className={styles.factGrid}>
          <div className={styles.fact}>
            <span>Supply</span>
            <strong>1 billion tokens with 18 decimals</strong>
          </div>
          <div className={styles.fact}>
            <span>Transfer tax</span>
            <strong>0%</strong>
          </div>
          <div className={styles.fact}>
            <span>Buy and sell fees</span>
            <strong>Set separately from 1% to 10%</strong>
          </div>
          <div className={styles.fact}>
            <span>Creator liquidity deposit</span>
            <strong>Not required</strong>
          </div>
        </div>
      </section>

      <section id="fees">
        <h2>Each direction has its own fixed fee</h2>
        <div className={styles.flow}>
          <div className={styles.flowItem}>
            <span>Direction</span>
            <strong>The pool identifies a buy or a sell</strong>
          </div>
          <div className={styles.flowItem}>
            <span>Selected fee</span>
            <strong>The launch&apos;s fixed rate is accounted in ETH</strong>
          </div>
          <div className={styles.flowItem}>
            <span>Creator</span>
            <strong>The selected rate minus 0.10% accrues as rewards</strong>
          </div>
          <div className={styles.flowItem}>
            <span>Programmable</span>
            <strong>0.10% accrues to the protocol treasury</strong>
          </div>
        </div>
        <div className={styles.callout}>
          <strong>The 0.10% Programmable share is included.</strong>
          <p>
            A 1% buy fee leaves 0.90% for creator rewards. It is not a second
            fee added to the selected rate. Normal ERC-20 transfers do not pay
            the hook fee.
          </p>
        </div>
      </section>

      <section id="rewards">
        <h2>Choose who receives the ETH</h2>
        <p>
          Rewards can go to the launch wallet, another wallet or a split
          between two and five unique wallets. That configuration is recorded
          at launch. Each current payout wallet can claim only its own
          allocation.
        </p>
        <ol className={styles.steps}>
          <li>
            <strong>Rewards accrue by allocation</strong>
            <span>
              The vault accounts for each beneficiary without requiring the
              launch wallet to distribute funds.
            </span>
          </li>
          <li>
            <strong>Each beneficiary claims independently</strong>
            <span>
              A beneficiary cannot claim another wallet&apos;s rewards or
              redirect them.
            </span>
          </li>
          <li>
            <strong>A payout wallet can move future rewards</strong>
            <span>
              Accrued rewards remain claimable by the previous wallet. Future
              accrual for that allocation moves to the new address without
              changing its percentage.
            </span>
          </li>
        </ol>
        <div className={styles.callout}>
          <strong>
            A disclosed CTO authority can replace the future reward
            configuration.
          </strong>
          <p>
            It checkpoints the existing configuration first, then can change
            future recipients and split percentages. It cannot move accrued
            rewards, alter swap fees, change token supply or remove liquidity.
          </p>
        </div>
      </section>

      <section id="initial-buy">
        <h2>Buy at launch, then choose how the tokens are held</h2>
        <p>
          The launch wallet chooses at least 0.0006 ETH for its Initial Buy.
          Purchased tokens can remain unlocked, use a fixed lock, vest
          linearly or vest after a cliff. Lock and vesting periods are
          immutable after launch and can run from 1 to 3,650 days.
        </p>
      </section>

      <section id="launch-transaction">
        <h2>One confirmation creates the complete launch</h2>
        <ol className={styles.steps}>
          <li>
            <strong>Create the fixed-supply token</strong>
            <span>
              The UERC20 factory creates the token and records its metadata.
            </span>
          </li>
          <li>
            <strong>Initialize the recorded ETH pool</strong>
            <span>
              The hook stores the buy fee, sell fee and reward vault for the
              pool.
            </span>
          </li>
          <li>
            <strong>Lock the one-sided position</strong>
            <span>
              The complete supply enters a position with no liquidity-removal
              path.
            </span>
          </li>
          <li>
            <strong>Execute the Initial Buy</strong>
            <span>
              Purchased tokens go to the launch wallet or its selected custody
              contract.
            </span>
          </li>
        </ol>
      </section>

      <section id="starting-point">
        <h2>A deterministic starting point</h2>
        <p>
          The current Classic curve begins at an approximate fully diluted
          valuation of 1.36 ETH before the Initial Buy. This is a mathematical
          starting point, not guaranteed liquidity, sale proceeds or future
          market value. The Initial Buy moves the live pool price before public
          trading begins.
        </p>
      </section>

      <section id="boundaries">
        <h2>What Classic does not add</h2>
        <ul className={styles.contentList}>
          <li>No minting after launch.</li>
          <li>No blacklist, sell restriction, rebase or transfer tax.</li>
          <li>No token allocation for the creator or Programmable.</li>
          <li>No protocol launch fee beyond Ethereum gas.</li>
          <li>
            No conventional LP fee. Creator rewards come from the configured
            hook fee.
          </li>
          <li>
            No guarantee that a third-party terminal routes through the
            recorded hooked pool.
          </li>
        </ul>
      </section>

      <section id="deployment">
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
                  <DocsAddress address={launcher} label="Launcher" />
                </td>
              </tr>
              <tr>
                <td>Fee hook</td>
                <td>
                  <DocsAddress address={hook} label="Fee hook" />
                </td>
              </tr>
              <tr>
                <td>Reward vault factory</td>
                <td>
                  <DocsAddress
                    address={rewardVaultFactory}
                    label="Reward vault factory"
                  />
                </td>
              </tr>
              <tr>
                <td>Initial Buy custody factory</td>
                <td>
                  <DocsAddress
                    address={initialBuyCustodyFactory}
                    label="Initial Buy custody factory"
                  />
                </td>
              </tr>
              <tr>
                <td>Position recipient factory</td>
                <td>
                  <DocsAddress
                    address={positionRecipientFactory}
                    label="Position recipient factory"
                  />
                </td>
              </tr>
              <tr>
                <td>CTO authority</td>
                <td>
                  <DocsAddress address={ctoAuthority} label="CTO authority" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className={styles.sourceLinks}>
          <DocsExternalLink
            href={`https://github.com/0xprogrammable/programmable/blob/${classicEvidenceCommit}/contracts/deployments/mainnet-classic-v3.json`}
            variant="chip"
          >
            Deployment record
          </DocsExternalLink>
          <DocsExternalLink
            href={`https://github.com/0xprogrammable/programmable/blob/${classicEvidenceCommit}/contracts/security/CLASSIC-V3.md`}
            variant="chip"
          >
            Security notes
          </DocsExternalLink>
        </div>
      </section>
    </DocsShell>
  );
}

function CustomDocs() {
  return (
    <DocsShell
      currentPath="/docs/models/custom"
      title="Custom Hook"
      description="Framework and release requirements for token-specific Uniswap v4 hook logic."
      sections={customSections}
    >
      <section id="status">
        <h2>Status</h2>
        <p className={styles.lead}>
          Create links directly to this guide. A public Custom Hook launch path
          activates only when its configuration, contracts and release
          evidence match. Until then, the interface does not prepare, simulate
          or submit a Custom Hook launch.
        </p>
        <div className={styles.callout}>
          <strong>The framework is open for review.</strong>
          <p>
            Launch activation requires defined permissions, transaction
            preparation, deployed contracts and verified release evidence.
          </p>
        </div>
      </section>

      <section id="release-requirements">
        <h2>What a release must define</h2>
        <ul className={styles.contentList}>
          <li>The allowed token and pool configuration.</li>
          <li>The fee path, reward recipients and mutable controls.</li>
          <li>Liquidity custody and every withdrawal path.</li>
          <li>Transaction preparation, simulation and wallet validation.</li>
          <li>Deployment records, runtime verification and supported network.</li>
        </ul>
      </section>

      <section id="project-presentation">
        <h2>Project presentation</h2>
        <p>
          A released Custom Hook token would use the same square artwork,
          project description, links, dedicated token page and community
          surface as other tokens. Those presentation fields do not make an
          unreleased transaction path available.
        </p>
      </section>
    </DocsShell>
  );
}

function StockPairedDocs() {
  const launcher = "0x195750f33caD5eF2DF857a53226B421297A1e79e";
  const hook = "0x7773D183fe7B60d4F1885047fa42b815a62Fe0Cc";
  const coordinator =
    "0xfa5f17389CA28D071781d59750b32C842ab6A54b";

  return (
    <DocsShell
      currentPath="/docs/models/stock-paired"
      kicker="Historical launch model"
      title="Stock-Paired"
      description="Existing fixed-supply tokens whose Uniswap v4 pools use a reviewed stock token as the quote asset."
      sections={stockPairedSections}
    >
      <section id="token-boundary">
        <h2>The launched token is not a share</h2>
        <p className={styles.lead}>
          Stock-Paired creates a new Programmable token and pairs it with one
          supported Ondo Global Markets token. The launched token does not
          represent ownership in the company and is not redeemable for the
          selected stock.
        </p>
        <div className={styles.callout}>
          <strong>New Stock-Paired launches are closed.</strong>
          <p>
            Existing tokens remain in Explore. Their token pages, trading,
            profile history and reward claims remain supported, and their
            deployment records stay public.
          </p>
        </div>
      </section>

      <section id="pool-creation">
        <h2>How the existing pools were created</h2>
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

      <section id="quote-rewards">
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

      <section id="routing">
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

      <section id="quote-controls">
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
            New launch preparation is closed server-side.
          </li>
        </ul>
      </section>

      <section id="deployment">
        <h2>Historical Mainnet deployment</h2>
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
                  <DocsAddress address={launcher} label="Launcher" />
                </td>
              </tr>
              <tr>
                <td>Fee hook</td>
                <td>
                  <DocsAddress address={hook} label="Fee hook" />
                </td>
              </tr>
              <tr>
                <td>ETH launch coordinator</td>
                <td>
                  <DocsAddress
                    address={coordinator}
                    label="ETH launch coordinator"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className={styles.sourceLinks}>
          <DocsExternalLink
            href={`https://github.com/0xprogrammable/programmable/blob/${stockPairedEvidenceCommit}/docs/superpowers/specs/2026-07-29-stock-paired-v1-design.md`}
            variant="chip"
          >
            Model specification
          </DocsExternalLink>
          <DocsExternalLink
            href={`https://github.com/0xprogrammable/programmable/blob/${stockPairedEvidenceCommit}/contracts/deployments/mainnet-stock-paired-v1.json`}
            variant="chip"
          >
            Deployment record
          </DocsExternalLink>
          <DocsExternalLink
            href={`https://github.com/0xprogrammable/programmable/blob/${stockPairedEvidenceCommit}/contracts/security/STOCK-PAIRED-V1.md`}
            variant="chip"
          >
            Security notes
          </DocsExternalLink>
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
  if (model === "custom") return <CustomDocs />;
  return <StockPairedDocs />;
}
