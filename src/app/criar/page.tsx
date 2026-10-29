import { Studio } from "@/components/studio";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ cena?: string }>;
}) {
  const { cena } = await searchParams;
  return <Studio view="create" initialScene={cena} />;
}
