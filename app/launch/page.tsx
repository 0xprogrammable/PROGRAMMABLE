import type { Metadata } from "next";

import { LaunchExperience } from "@/components/launch-entry";
import {
  configuredLaunchPermitSignersV2,
  isCustomLaunchPublicEnabled,
} from "@/lib/server/custom-launch/public-readiness";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Programmable",
  description:
    "Create a fixed-supply token with locked Uniswap v4 liquidity, or review the Custom Hook framework.",
  alternates: {
    canonical: "/launch",
  },
};

export default function LaunchPage() {
  return (
    <LaunchExperience
      customLaunchPublicEnabled={isCustomLaunchPublicEnabled()}
      trustedLaunchPermitSigners={configuredLaunchPermitSignersV2()}
    />
  );
}
