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
    "Move an approved GitHub revision through wallet submission, finality, and a public launch record.",
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
