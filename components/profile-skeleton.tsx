import styles from "./profile-experience.module.css";
import projectStyles from "./profile-projects.module.css";

export function ProfileLaunchesSkeleton() {
  return <div className={projectStyles.skeletonList} aria-busy="true">
    <span className={projectStyles.visuallyHidden} role="status">Loading launches</span>
    <div className={projectStyles.skeletonProject} aria-hidden="true">
      <span className={projectStyles.skeletonArt} />
      <span className={projectStyles.skeletonCopy}><span /><span /></span>
      <span className={projectStyles.skeletonAction} />
    </div>
  </div>;
}

export function ProfileLoadingSkeleton({ label, showHero = false }: {
  label: string;
  showHero?: boolean;
}) {
  return <section
    className={`${styles.profileSkeleton} ${showHero ? styles.profileSkeletonPage : styles.profileSkeletonInline}`}
    aria-busy="true" aria-label={label}
  >
    <span className={styles.visuallyHidden} role="status">{label}</span>
    {showHero ? <>
      <div className={styles.profileSkeletonHero} aria-hidden="true">
        <span className={styles.profileSkeletonBanner} />
        <span className={styles.profileSkeletonAvatar} />
        <span className={styles.profileSkeletonCopy}><span /><span /></span>
      </div>
      <div className={styles.profileSkeletonChain} aria-hidden="true"><span /><span /></div>
      <div className={projectStyles.section} aria-hidden="true">
        <div className={projectStyles.heading}>
          <span className={styles.profileSkeletonHeading} />
        </div>
        <ProfileLaunchesSkeleton />
      </div>
    </> : null}
    <div className={`${styles.profileSkeletonWorkspace} ${showHero ? styles.profileSkeletonWorkspacePage : ""}`} aria-hidden="true">
      <div className={styles.profileSkeletonSummary}>
        <span className={styles.profileSkeletonHeading} />
        <span className={styles.profileSkeletonMetric} />
        <span className={styles.profileSkeletonLine} />
        <span className={styles.profileSkeletonBar} />
      </div>
      <div className={styles.profileSkeletonClaims}>
        <span className={styles.profileSkeletonSectionHeader}><span className={styles.profileSkeletonHeading} /></span>
        <span className={styles.profileSkeletonRows}>
          {Array.from({ length: 4 }, (_, item) => <span className={styles.profileSkeletonRow} key={item}><span /><span /><span /></span>)}
        </span>
      </div>
    </div>
  </section>;
}
