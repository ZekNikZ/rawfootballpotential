import { Anchor, Skeleton, Stack, Table, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { h2hQuery } from "../../api/queries";
import type { HeadToHead } from "../../api/schemas";
import { fmtPct1 } from "../../lib/format";
import { useLeague } from "../../lib/league-context";
import { EmptyState, QueryError } from "../QueryState";
import { FilterBar } from "./filters";
import { useSectionState } from "./section-state";
import classes from "./Heatmap.module.css";

const HEAT_FILTERS = ["seasons", "scope", "median"] as const;

/** A franchise is labeled with its current manager (owner decision). */
function labelOf(h: HeadToHead, franchiseId: number) {
  const f = h.entities.franchises[String(franchiseId)];
  const manager = f?.managerId == null ? null : h.entities.managers[String(f.managerId)]?.name;
  return manager ?? f?.teamName ?? `Franchise ${franchiseId}`;
}

export function Heatmap() {
  const { league } = useLeague();
  const state = useSectionState("matchups");
  const q = useQuery(h2hQuery(league.slug, state.apiParams));
  const h = q.data;

  const ids = h ? [...h.franchises].sort((a, b) => labelOf(h, a).localeCompare(labelOf(h, b))) : [];
  const hasMedian = h ? ids.some((a) => h.matrix[String(a)]?.median) : false;

  return (
    <Stack gap={10} component="section" aria-labelledby="h-matchups">
      <Title order={2} id="h-matchups">
        Career Manager Matchups
      </Title>
      <FilterBar
        filters={HEAT_FILTERS}
        league={league}
        availableFrom={h?.availableFrom ?? null}
        values={state.filters}
        params={undefined}
        minGamesDefault={undefined}
        onChange={(patch) => state.update(patch)}
      />
      {q.isPending && <Skeleton h={320} />}
      {q.isError && !h && <QueryError error={q.error} onRetry={() => void q.refetch()} />}
      {h && ids.length === 0 && <EmptyState>No games for these filters.</EmptyState>}
      {h && ids.length > 0 && (
        <>
          <Table.ScrollContainer minWidth={420} type="native">
            <Table
              withTableBorder
              withColumnBorders
              className={classes.table}
              data-fetching={q.isFetching ? "" : undefined}
            >
              <Table.Thead>
                <Table.Tr>
                  <Table.Th className={classes.corner} />
                  {ids.map((id) => (
                    <Table.Th key={id} scope="col" className={classes.colHead}>
                      <span>{labelOf(h, id)}</span>
                    </Table.Th>
                  ))}
                  {hasMedian && (
                    <Table.Th scope="col" className={classes.colHead}>
                      <span>(MEDIAN)</span>
                    </Table.Th>
                  )}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {ids.map((a) => (
                  <Table.Tr key={a}>
                    <Table.Th scope="row" className={classes.rowHead}>
                      <Anchor component={Link} to={`/${league.slug}/franchises/${a}`} c="inherit">
                        {labelOf(h, a)}
                      </Anchor>
                    </Table.Th>
                    {[...ids, ...(hasMedian ? (["median"] as const) : [])].map((b) => (
                      <HeatCell
                        key={b}
                        cell={a === b ? undefined : h.matrix[String(a)]?.[String(b)]}
                      />
                    ))}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          <Text size="sm" c="dimmed">
            Share of games the row's manager won against the column's manager (ties count half).
            Data available from {h.availableFrom}.
          </Text>
        </>
      )}
    </Stack>
  );
}

function HeatCell({ cell }: { cell: HeadToHead["matrix"][string][string] | undefined }) {
  if (!cell || cell.games === 0) return <Table.Td className={classes.empty}>—</Table.Td>;
  const share = (cell.w + cell.t / 2) / cell.games;
  const strength = Math.abs(share - 0.5) * 2;
  const record = `${cell.w}-${cell.l}${cell.t ? `-${cell.t}` : ""}`;
  return (
    <Table.Td
      className={classes.cell}
      data-side={share >= 0.5 ? "win" : "loss"}
      style={{ "--heat-strength": String(strength) }}
      title={`${record} in ${cell.games} games`}
    >
      {fmtPct1(share)}
    </Table.Td>
  );
}
