import type { Metadata } from "next";

import { GenericLaunchDetailV2 } from
  "@/components/generic-launch-directory-v2";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Legacy Registry record · Programmable",
  description: "A historical Custom launch record from the retired Registry approval flow.",
  robots: { follow: false, index: false },
};

export default async function CustomLaunchDetailPage({ params }: Readonly<{
  params: Promise<{ recordHash: string }>;
}>) {
  const { recordHash } = await params;
  return <GenericLaunchDetailV2 recordHash={recordHash} />;
}
