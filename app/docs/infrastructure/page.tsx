import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Braces, FileJson2, GitBranch, Network } from "lucide-react";

import { PROGRAMMABLE_LAUNCH_STAMP_RESOURCES } from "@/components/launch-stamp-docs-contract";
import styles from "@/components/docs-hub.module.css";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "Infrastructure · Programmable",
  description:
    "Understand Programmable launch execution, onchain identity, Router provenance, public resources and verification boundaries.",
  alternates: { canonical: "/docs/infrastructure" },
};

const sections = [
  { id: "system", label: "System overview" },
  { id: "provenance", label: "Launch provenance" },
  { id: "resources", label: "Public resources" },
  { id: "boundaries", label: "Verification boundaries" },
] as const;

const resources = [
  {
    description: "Read the current Ethereum deployment and Router bindings.",
    href: PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.manifestUrl,
    icon: FileJson2,
    label: "Live manifest",
  },
  {
    description: "Download the exact interface used for onchain verification.",
    href: PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.abiUrl,
    icon: Braces,
    label: "Router ABI",
  },
  {
    description: "Follow the reference algorithm and integration examples.",
    href: PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.referenceUrl,
    icon: GitBranch,
    label: "GitHub reference",
  },
] as const;

export default function InfrastructureDocsPage() {
  return (
    <DocsShell
      currentPath="/docs/infrastructure"
      description="Launch contracts create tokens and markets. The Launch Stamp Router separately records provenance for launches executed through it. This page explains both without requiring contract-level knowledge."
      heroAside={
        <div className={styles.systemLine} aria-label="Infrastructure sequence">
          <span>Router launch</span>
          <ArrowRight aria-hidden="true" size={16} />
          <span>Token and market</span>
          <ArrowRight aria-hidden="true" size={16} />
          <span>Provenance record</span>
          <ArrowRight aria-hidden="true" size={16} />
          <span>Verifier-enabled app</span>
        </div>
      }
      heroId="system-map"
      kicker="Infrastructure"
      sections={sections}
      title="Public launch infrastructure"
    >
      <section id="system">
        <div className={styles.sectionIntro}>
          <p className={styles.eyebrow}>System overview</p>
          <h2>Each infrastructure layer answers a different question</h2>
          <p>
            Launch execution, market state, provenance and presentation are
            related, but they are not interchangeable sources of truth.
          </p>
        </div>

        <ol className={styles.layerList}>
          <li>
            <span>01</span>
            <div>
              <strong>Launch execution</strong>
              <p>
                Model-specific contracts create the token, initialize its
                Uniswap v4 market and apply the selected launch rules.
              </p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <strong>Onchain market</strong>
              <p>
                The PoolManager address and poolId identify the v4 market. Read
                its currencies, fee, tick spacing, hook and current state
                separately.
              </p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <strong>Launch provenance</strong>
              <p>
                The Launch Stamp Router records identity for launches that are
                executed and stamped through it.
              </p>
            </div>
          </li>
          <li>
            <span>04</span>
            <div>
              <strong>Public applications</strong>
              <p>
                Applications that implement the verifier can identify
                Router-stamped launches. Historical launches and direct
                factory calls require separate discovery data.
              </p>
            </div>
          </li>
        </ol>
      </section>

      <section id="provenance">
        <div className={styles.sectionIntro}>
          <p className={styles.eyebrow}>Launch provenance</p>
          <h2>Router verification applies only to stamped launches</h2>
          <p>
            A terminal can start with a token address or a PoolManager and
            poolId, resolve the launch ID, and read the recorded stamp from the
            Router. Historical launches and direct factory calls are outside
            that Router record. A Router record establishes provenance only
            after the published address, runtime, binding, lookup and
            cross-check requirements pass. It is not a safety guarantee.
          </p>
        </div>

        <div className={styles.inlineAction}>
          <Link href="/docs/launch-stamps">
            Read the complete Launch Stamp Router reference
            <ArrowRight aria-hidden="true" size={17} strokeWidth={1.8} />
          </Link>
        </div>
      </section>

      <section id="resources">
        <div className={styles.sectionIntro}>
          <p className={styles.eyebrow}>Canonical resources</p>
          <h2>Use the manifest, ABI and public reference together</h2>
          <p>
            The manifest identifies the deployment. The ABI defines the
            available reads. The reference explains how to interpret the
            result and handle finality or inconsistent data.
          </p>
        </div>

        <div className={styles.resourceList}>
          {resources.map((resource) => {
            const Icon = resource.icon;
            return (
              <a
                href={resource.href}
                key={resource.href}
                rel="noreferrer"
                target="_blank"
              >
                <Icon aria-hidden="true" size={19} strokeWidth={1.7} />
                <span>
                  <strong>{resource.label}</strong>
                  <small>{resource.description}</small>
                </span>
                <ArrowRight aria-hidden="true" size={17} strokeWidth={1.8} />
                <span className="sr-only">Opens in a new tab</span>
              </a>
            );
          })}
        </div>
      </section>

      <section id="boundaries">
        <div className={styles.sectionIntro}>
          <p className={styles.eyebrow}>Verification boundaries</p>
          <h2>What a launch record does and does not establish</h2>
        </div>

        <div className={styles.proofGrid}>
          <article>
            <Network aria-hidden="true" size={20} strokeWidth={1.7} />
            <strong>It establishes</strong>
            <p>
              The recorded launch identity, token, hook, market, launch type
              and component proofs for a Router-stamped launch.
            </p>
          </article>
          <article>
            <Braces aria-hidden="true" size={20} strokeWidth={1.7} />
            <strong>It does not establish</strong>
            <p>
              Current safety, tradability, liquidity, price, terminal support
              or the behavior of an unverified external interface.
            </p>
          </article>
        </div>

        <div className={styles.inlineAction}>
          <Link href="/docs/developers">
            Open the developer integration guide
            <ArrowRight aria-hidden="true" size={17} strokeWidth={1.8} />
          </Link>
        </div>
      </section>
    </DocsShell>
  );
}
