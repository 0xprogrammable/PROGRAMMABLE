import { HookathonCountdown } from "@/components/hookathon-countdown";
import styles from "@/components/hookathon-page.module.css";
import { hookathonConfig } from "@/lib/hookathon/config";
import { formatHookathonDeadline } from "@/lib/hookathon/time";

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export type HookathonPageProps = Readonly<{
  initialNowMs: number;
}>;

export function HookathonPage({ initialNowMs }: HookathonPageProps) {
  const deadlineDisplay = formatHookathonDeadline(
    hookathonConfig.deadlineIso,
    hookathonConfig.timeZone,
  );

  return (
    <article
      className={`${styles.page} hookathon-root`}
      aria-labelledby="hookathon-title"
    >
      <div className={styles.shell}>
        <header className={styles.hero}>
          <h1 id="hookathon-title">{hookathonConfig.name}</h1>
          <HookathonCountdown
            deadlineDisplay={deadlineDisplay}
            deadlineIso={hookathonConfig.deadlineIso}
            hookbuilderUrl={hookathonConfig.hookbuilderUrl}
            initialNowMs={initialNowMs}
            prompt={hookathonConfig.builderPrompt}
          />
        </header>

        <section className={styles.prizes} aria-labelledby="hookathon-prizes">
          <div className={styles.prizeLead}>
            <h2 id="hookathon-prizes">Prize pool</h2>
            <p>{usdFormatter.format(hookathonConfig.totalPrizeUsd)}</p>
          </div>
          <ol className={styles.prizeSplit}>
            {hookathonConfig.prizes.map((prize) => (
              <li key={prize.place}>
                <span>{prize.place}</span>
                <strong>{usdFormatter.format(prize.amountUsd)}</strong>
              </li>
            ))}
          </ol>
        </section>

        <section className={styles.entry} aria-labelledby="hookathon-entry">
          <h2 id="hookathon-entry">How to enter</h2>
          <ol className={styles.steps}>
            {hookathonConfig.entrySteps.map((step) => (
              <li key={step.id}>
                <span className={styles.stepNumber} aria-hidden="true">
                  {step.number}
                </span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <div className={styles.conditions}>
          <section
            className={styles.eligibility}
            aria-labelledby="hookathon-eligibility"
          >
            <h2 id="hookathon-eligibility">Eligibility</h2>
            <p>{hookathonConfig.eligibility.description}</p>
          </section>

          <section
            className={styles.judging}
            aria-labelledby="hookathon-judging"
          >
            <h2 id="hookathon-judging">Judging</h2>
            <ul aria-label="Judging criteria">
              {hookathonConfig.judging.criteria.map((criterion) => (
                <li key={criterion}>{criterion}</li>
              ))}
            </ul>
            <p>{hookathonConfig.judging.description}</p>
          </section>
        </div>
      </div>
    </article>
  );
}
