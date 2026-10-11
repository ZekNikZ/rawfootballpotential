import { Skeleton, Stack, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useLocation } from "react-router";
import { catalogQuery } from "../../api/queries";
import type { CatalogRecord } from "../../api/schemas";
import { useLeague } from "../../lib/league-context";
import { QueryError } from "../QueryState";
import { SectionNav } from "./SectionNav";
import { RecordSection } from "./RecordSection";
import { slugify } from "./section-state";

/** All record sections of one category, in catalog order. */
export function CategoryPage({
  category,
  only,
  exclude = [],
  children,
}: {
  category: CatalogRecord["category"];
  /** Show just this section (by title). */
  only?: string;
  /** Hide these sections (by title); they live on another page. */
  exclude?: readonly string[];
  children?: React.ReactNode;
}) {
  const { league } = useLeague();
  const catalog = useQuery(catalogQuery(league.slug));
  const { hash } = useLocation();
  // A link to one record (the search bar) ends in #h-<section>: scroll to it once the sections are on the page.
  useEffect(() => {
    if (!hash || !catalog.data) return;
    document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [hash, catalog.data]);

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
  for (const r of catalog.data.records.filter(
    (x) =>
      x.category === category &&
      (only === undefined || x.section === only) &&
      !exclude.includes(x.section)
  )) {
    const list = sections.get(r.section) ?? [];
    list.push(r);
    sections.set(r.section, list);
  }

  return (
    <SectionNav>
      <Stack gap={40}>
        {[...sections].map(([title, records]) => (
          <RecordSection key={title} sectionKey={slugify(title)} title={title} records={records} />
        ))}
        {sections.size === 0 && <Title order={3}>No records in this category yet.</Title>}
        {children}
      </Stack>
    </SectionNav>
  );
}
