import { LaunchExperience } from "@/components/launch-entry";
import { isStockPairedPublicLaunchEnabled } from "@/lib/stock-paired-access";
import { getConfiguredStockPairedLaunchRelease } from "@/lib/stock-paired-release";

export default function LaunchPage() {
  const launchEnvironment =
    process.env.PROGRAMMABLE_ONCHAIN_NETWORK === "rehearsal"
      ? "rehearsal"
      : "production";
  const stockPairedPublicLaunchEnabled =
    isStockPairedPublicLaunchEnabled(
      launchEnvironment,
      getConfiguredStockPairedLaunchRelease(),
    );

  return (
    <LaunchExperience
      stockPairedPublicLaunchEnabled={stockPairedPublicLaunchEnabled}
    />
  );
}
