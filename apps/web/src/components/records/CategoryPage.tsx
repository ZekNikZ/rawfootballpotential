import { Skeleton, Stack, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { catalogQuery } from "../../api/queries";
import type { CatalogRecord } from "../../api/schemas";
import { useLeague } from "../../lib/league-context";
import { QueryError } from "../QueryState";
import { RecordSection } from "./RecordSection";
import { slugify } from "./section-state";

/** All record sections of one category, in catalog order. */
export function CategoryPage({
  category,
  children,
}: {
  category: CatalogRecord["category"];
  children?: React.ReactNode;
}) {
  const { league } = useLeague();
  const catalog = useQuery(catalogQuery(league.slug));

  if (catalog.isPending)
    return (
      <Stack gap="xl">
        <Skeleton h={28} w="30%" />
        <Skeleton h={36} />
        <Skeleton h={260} />
      </Stack>
    );
  if (catalog.isError)
    return <QueryError error={catalog.error} onRetry={() => void catalog.refetch()} />;

  const sections = new Map<string, CatalogRecord[]>();
  for (const r of catalog.data.records.filter((x) => x.category === category)) {
    const list = sections.get(r.section) ?? [];
    list.push(r);
    sections.set(r.section, list);
  }

  return (
    <Stack gap={40}>
      {[...sections].map(([title, records]) => (
        <RecordSection key={title} sectionKey={slugify(title)} title={title} records={records} />
      ))}
      {sections.size === 0 && <Title order={3}>No records in this category yet.</Title>}
      {children}
    </Stack>
  );
}
