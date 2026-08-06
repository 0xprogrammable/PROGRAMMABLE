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
    "Create a Classic token, review Custom Hooks, or preview upcoming partner launch models.",
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
