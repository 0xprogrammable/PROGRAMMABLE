import { TokenDetailView } from "@/components/token-detail-view";

export default async function TokenPage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;
  return <TokenDetailView address={address} />;
}
