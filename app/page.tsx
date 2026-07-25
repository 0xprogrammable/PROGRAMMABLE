import { ExploreView } from "@/components/explore-view";
import { launcherMarkets } from "@/lib/markets";

export default function ExplorePage() {
  return <ExploreView markets={launcherMarkets} />;
}
