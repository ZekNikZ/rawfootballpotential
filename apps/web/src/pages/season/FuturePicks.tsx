import { Anchor, Select, Skeleton, Stack, Table, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { picksQuery } from "../../api/queries";
import type { Entities } from "../../api/schemas";
import { EmptyState, QueryError } from "../../components/QueryState";
import classes from "../../components/DataTable.module.css";
import { ordinal } from "../../lib/format";
import { useLeague } from "../../lib/league-context";

/** A franchise is labeled with its current manager and team (picks belong to the franchise, not one season). */
function FranchiseLabel({ entities, id, slug }: { entities: Entities; id: number; slug: string }) {
  const f = entities.franchises[String(id)];
  const manager = f?.managerId == null ? null : entities.managers[String(f.managerId)]?.name;
  return (
    <>
      <Anchor component={Link} to={`/${slug}/franchises/${id}`}>
        {manager ?? f?.teamName ?? `Franchise ${id}`}
      </Anchor>
      {manager && f?.teamName && (
        <Text span c="dimmed" fz="sm">
          {" "}
          ({f.teamName})
        </Text>
      )}
    </>
  );
}

export default function FuturePicks() {
  const { league } = useLeague();
  const [search, setSearch] = useSearchParams();
  const q = useQuery(picksQuery(league.slug));
  const owner = search.get("owner");

  if (q.isPending) return <Skeleton h={320} />;
  if (q.isError) return <QueryError error={q.error} onRetry={() => void q.refetch()} />;
  const { picks, entities } = q.data;
  const nameOf = (id: number) => {
    const f = entities.franchises[String(id)];
    const m = f?.managerId == null ? null : entities.managers[String(f.managerId)]?.name;
    return [m, f?.teamName].filter(Boolean).join(" · ") || `Franchise ${id}`;
  };
  const owners = [...new Set(picks.map((p) => p.ownerFranchiseId))].sort((a, b) =>
    nameOf(a).localeCompare(nameOf(b))
  );
  const shown = picks.filter((p) => !owner || String(p.ownerFranchiseId) === owner);
  return (
    <Stack gap="md">
      <Stack gap={0}>
        <Title order={1}>Future Picks</Title>
        <Text c="dimmed">{league.name} · picks that have changed hands</Text>
      </Stack>
      <Stack gap={2}>
        <Text size="sm">Owner</Text>
        <Select
          aria-label="Owner"
          placeholder="Everyone"
          clearable
          w={260}
          data={owners.map((id) => ({ value: String(id), label: nameOf(id) }))}
          value={owner}
          onChange={(v) =>
            setSearch(
              (prev) => {
                const next = new URLSearchParams(prev);
                if (v) next.set("owner", v);
                else next.delete("owner");
                return next;
              },
              { replace: true, preventScrollReset: true }
            )
          }
        />
      </Stack>
      {shown.length === 0 ? (
        <EmptyState>No traded picks.</EmptyState>
      ) : (
        <Table.ScrollContainer minWidth={480} type="native">
          <Table withTableBorder className={classes.table}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th className={classes.sticky}>Pick</Table.Th>
                <Table.Th>Originally</Table.Th>
                <Table.Th>Now owned by</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {shown.map((p) => (
                <Table.Tr
                  key={`${p.season}-${p.round}-${p.originalFranchiseId}`}
                  className={classes.row}
                >
                  <Table.Td className={classes.sticky}>
                    {p.season} · {ordinal(p.round)} round
                  </Table.Td>
                  <Table.Td>
                    <FranchiseLabel
                      entities={entities}
                      id={p.originalFranchiseId}
                      slug={league.slug}
                    />
                  </Table.Td>
                  <Table.Td>
                    <FranchiseLabel
                      entities={entities}
                      id={p.ownerFranchiseId}
                      slug={league.slug}
                    />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Stack>
  );
}
