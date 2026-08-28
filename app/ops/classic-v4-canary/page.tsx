import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  ClassicV4CanaryAuthorizationConsole,
} from "@/components/classic-v4-canary-authorization-console";
import {
  loadAvailableClassicV4CanaryAuthorizationRequestV1,
} from "@/lib/server/custom-launch/classic-v4-canary-authorization-v1";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Classic V4 canary authorization · Programmable",
  description: "Authorize the installed Classic V4 canary request.",
  robots: { index: false, follow: false },
};

export default function ClassicV4CanaryAuthorizationPage() {
  const installed = loadAvailableClassicV4CanaryAuthorizationRequestV1();
  if (installed === null) notFound();

  return (
    <ClassicV4CanaryAuthorizationConsole
      authorizationRequestDigest={installed.authorizationRequestDigest}
      launchWallet={installed.launchWallet}
    />
  );
}
