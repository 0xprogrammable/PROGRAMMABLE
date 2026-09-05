import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAddress, isAddress, type Address } from "viem";

import { LateMigrationClaim } from "@/components/late-migration-claim";
import intakeActivationJson from
  "@/config/late-migration-intake-activation.v1.json";

// Keep the page kill switch effective for each request, including local production QA.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "V4 late migration | Programmable",
  description: "Check an eligible wallet's exact V4 late-migration allocation.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function LateMigrationPage() {
  const localPreview =
    process.env.NODE_ENV !== "production" &&
    process.env.PROGRAMMABLE_LATE_MIGRATION_LOCAL_PREVIEW === "true";
  const publicPageEnabled =
    process.env.PROGRAMMABLE_LATE_MIGRATION_PAGE_ENABLED === "true";

  if (!localPreview && !publicPageEnabled) {
    notFound();
  }

  const intakeActivation = readIntakeActivation();
  return <LateMigrationClaim intakeActivation={intakeActivation} />;
}

function readIntakeActivation(): Readonly<{
  sourceContractAddress: Address;
}> | null {
  if (process.env.PROGRAMMABLE_LATE_MIGRATION_INTAKE_ENABLED !== "true") {
    return null;
  }
  const manifest = intakeActivationJson as unknown as Record<string, unknown>;
  if (
    manifest.schema !== "programmable-late-migration-intake-activation/v1" ||
    manifest.enabled !== true ||
    typeof manifest.sourceContractAddress !== "string" ||
    !isAddress(manifest.sourceContractAddress, { strict: true })
  ) {
    return null;
  }
  return Object.freeze({
    sourceContractAddress: getAddress(manifest.sourceContractAddress),
  });
}
