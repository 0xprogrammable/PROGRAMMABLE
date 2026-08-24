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
    "Create a Classic coin or start a Custom launch through the API-first preparation path.",
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
