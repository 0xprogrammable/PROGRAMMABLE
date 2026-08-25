import type { Metadata } from "next";

import { GenericLaunchDirectoryV2 } from
  "@/components/generic-launch-directory-v2";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Legacy Registry records · Programmable",
  description: "Historical Custom launch records from the retired Registry approval flow.",
  robots: { follow: false, index: false },
};

export default function CustomLaunchesPage() {
  return <GenericLaunchDirectoryV2 />;
}
