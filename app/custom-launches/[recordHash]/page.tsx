import { GenericLaunchDetailV2 } from
  "@/components/generic-launch-directory-v2";

export const dynamic = "force-dynamic";

export default async function CustomLaunchDetailPage({ params }: Readonly<{
  params: Promise<{ recordHash: string }>;
}>) {
  const { recordHash } = await params;
  return <GenericLaunchDetailV2 recordHash={recordHash} />;
}
