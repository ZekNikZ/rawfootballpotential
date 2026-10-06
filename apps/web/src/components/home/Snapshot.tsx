import {
  Anchor,
  Badge,
  Card,
  Group,
  Paper,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { matchupsQuery, recentTransactionsQuery, standingsQuery } from "../../api/queries";
import type { Entities, Matchups, Standings, Transactions } from "../../api/schemas";
import { fmtDecimal, ordinal, seasonLabel } from "../../lib/format";
import { useLeague } from "../../lib/league-context";
import { EmptyState, QueryError } from "../QueryState";
import classes from "./Snapshot.module.css";

const record = (r: { wins: number; losses: number; ties: number }) =>
  `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ""}`;

function teamName(entities: Entities, teamSeasonId: number | null) {
  return teamSeasonId === null
    ? "Unknown team"
    : (entities.teamSeasons[String(teamSeasonId)]?.name ?? "Unknown team");
}

function managerOf(entities: Entities, teamSeasonId: number | null) {
  const ts = teamSeasonId === null ? undefined : entities.teamSeasons[String(teamSeasonId)];
  return ts?.managerId == null ? null : (entities.managers[String(ts.managerId)]?.name ?? null);
}

function Panel({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card withBorder radius="sm" padding="md" className={classes.panel}>
      <Group justify="space-between" mb="xs" wrap="nowrap">
        <Title order={3}>{title}</Title>
        {aside}
      </Group>
      {children}
    </Card>
  );
}

function PanelState({
  query,
  empty,
}: {
  query: { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  empty?: string;
}) {
  if (query.isPending)
    return (
      <Stack gap={6}>
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} h={18} />
        ))}
      </Stack>
    );
  if (query.isError) return <QueryError error={query.error} onRetry={() => void query.refetch()} />;
  return empty ? <EmptyState>{empty}</EmptyState> : null;
}

// ---- in season ----

function StandingsPanel({ seasonId }: { seasonId: number }) {
  const { league } = useLeague();
  const q = useQuery(standingsQuery(seasonId));
  const d: Standings | undefined = q.data;
  return (
    <Panel
      title="Standings"
      aside={
        d?.week ? (
          <Text c="dimmed" fz="sm">
            After week {d.week}
          </Text>
        ) : null
      }
    >
      {!d && <PanelState query={q} />}
      {d && d.rows.length === 0 && <EmptyState>No games played yet.</EmptyState>}
      {d && d.rows.length > 0 && (
        <Table.ScrollContainer minWidth={300} type="native">
          <Table className={classes.table} verticalSpacing={4}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={36} data-numeric="">
                  #
                </Table.Th>
                <Table.Th>Team</Table.Th>
                <Table.Th data-numeric="">W-L</Table.Th>
                <Table.Th data-numeric="">PF</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {d.rows.map((r) => (
                <Table.Tr key={r.team_season_id} className={classes.row}>
                  <Table.Td data-numeric="">{r.rank}</Table.Td>
                  <Table.Td>
                    <Anchor component={Link} to={`/${league.slug}/franchises/${r.franchise_id}`}>
                      {teamName(d.entities, r.team_season_id)}
                    </Anchor>{" "}
                    <Text span c="dimmed" fz="sm">
                      ({managerOf(d.entities, r.team_season_id)})
                    </Text>
                  </Table.Td>
                  <Table.Td data-numeric="">{record(r)}</Table.Td>
                  <Table.Td data-numeric="">{fmtDecimal(r.pf)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Panel>
  );
}

function MatchupsPanel({ seasonId }: { seasonId: number }) {
  const q = useQuery({ ...matchupsQuery(seasonId), refetchInterval: 60_000 });
  const d: Matchups | undefined = q.data;
  const live = d?.weekStatus === "in_progress";
  return (
    <Panel
      title={d?.week ? `Week ${d.week} matchups` : "Matchups"}
      aside={
        live ? (
          <Badge color="green" variant="light" size="sm">
            live
          </Badge>
        ) : null
      }
    >
      {!d && <PanelState query={q} />}
      {d && d.games.length === 0 && <EmptyState>No games scheduled.</EmptyState>}
      {d && d.games.length > 0 && (
        <Stack gap="xs">
          {d.games.map((g) => (
            <Paper key={g.matchupId} withBorder p="xs" radius="sm">
              {g.teams.map((t) => (
                <Group key={t.teamSeasonId} justify="space-between" wrap="nowrap" gap="xs">
                  <Text
                    truncate
                    fw={t.result === "W" ? 700 : undefined}
                    c={t.result === "L" ? "dimmed" : undefined}
                  >
                    {teamName(d.entities, t.teamSeasonId)}
                  </Text>
                  <Text className={classes.num} fw={t.result === "W" ? 700 : undefined}>
                    {fmtDecimal(t.points)}
                  </Text>
                </Group>
              ))}
            </Paper>
          ))}
        </Stack>
      )}
    </Panel>
  );
}

const TYPE_LABEL: Record<string, string> = {
  trade: "Trade",
  waiver: "Waiver",
  free_agent: "Free agent",
  commissioner: "Commissioner",
};

function describe(tx: Transactions["transactions"][number]): string {
  const parts = tx.items.map((i) => {
    if (i.kind === "pick")
      return `${i.direction === "drop" ? "−" : "+"} ${i.pickSeason ?? ""} round ${i.pickRound ?? "?"} pick`;
    const mark = i.direction === "add" ? "+" : i.direction === "drop" ? "−" : "→";
    return `${mark} ${i.player ?? "Unknown player"}${i.position ? ` (${i.position})` : ""}`;
  });
  return parts.join(", ");
}

function TransactionsPanel({ seasonId }: { seasonId: number }) {
  const q = useQuery(recentTransactionsQuery(seasonId));
  const d = q.data;
  return (
    <Panel title="Recent transactions">
      {!d && <PanelState query={q} />}
      {d && d.transactions.length === 0 && <EmptyState>No transactions yet.</EmptyState>}
      {d && d.transactions.length > 0 && (
        <Stack gap="xs">
          {d.transactions.map((tx) => (
            <Stack key={tx.id} gap={2}>
              <Group gap={6} wrap="nowrap">
                <Badge size="xs" variant="light" color={tx.type === "trade" ? "grape" : "gray"}>
                  {TYPE_LABEL[tx.type] ?? tx.type}
                </Badge>
                <Text fw={600} truncate>
                  {teamName(d.entities, tx.creatorTeamSeasonId)}
                </Text>
                {tx.week !== null && (
                  <Text c="dimmed" fz="sm">
                    WK {tx.week}
                  </Text>
                )}
              </Group>
              <Text fz="sm" c="dimmed">
                {describe(tx)}
              </Text>
            </Stack>
          ))}
        </Stack>
      )}
    </Panel>
  );
}

export function InSeasonSnapshot({ seasonId }: { seasonId: number }) {
  return (
    <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing="md">
      <StandingsPanel seasonId={seasonId} />
      <MatchupsPanel seasonId={seasonId} />
      <TransactionsPanel seasonId={seasonId} />
    </SimpleGrid>
  );
}

// ---- off season ----

function PodiumCard({
  medal,
  place,
  row,
  d,
  slug,
}: {
  medal: string;
  place: number;
  row: Standings["rows"][number];
  d: Standings;
  slug: string;
}) {
  return (
    <Card withBorder radius="sm" padding="md" className={classes.podium} data-place={place}>
      <Text fz="2rem" lh={1}>
        {medal}
      </Text>
      <Text c="dimmed" fz="sm">
        {ordinal(place)} place
      </Text>
      <Anchor component={Link} to={`/${slug}/franchises/${row.franchise_id}`} fw={700} fz="lg">
        {teamName(d.entities, row.team_season_id)}
      </Anchor>
      <Text>{managerOf(d.entities, row.team_season_id)}</Text>
      <Text c="dimmed" fz="sm">
        {record(row)} · {fmtDecimal(row.pf)} PF
      </Text>
    </Card>
  );
}

export function FinalResults({ seasonId, year }: { seasonId: number; year: number }) {
  const { league } = useLeague();
  const q = useQuery(standingsQuery(seasonId));
  const d = q.data;
  const placed = d?.rows.filter((r) => r.final_place !== null) ?? [];
  const last = placed.length ? Math.max(...placed.map((r) => r.final_place ?? 0)) : null;
  const at = (n: number) => placed.find((r) => r.final_place === n);

  return (
    <Stack gap="sm" component="section" aria-labelledby="h-final">
      <Title order={2} id="h-final">
        {seasonLabel(year)} final results
      </Title>
      {!d && <PanelState query={q} />}
      {d && placed.length === 0 && <EmptyState>Final placements aren't available yet.</EmptyState>}
      {d && placed.length > 0 && (
        <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} spacing="md">
          {([1, 2, 3] as const).map((place) => {
            const row = at(place);
            return row ? (
              <PodiumCard
                key={place}
                medal={["🥇", "🥈", "🥉"][place - 1] ?? ""}
                place={place}
                row={row}
                d={d}
                slug={league.slug}
              />
            ) : null;
          })}
          {last !== null && last > 3 && at(last) && (
            <PodiumCard medal="💩" place={last} row={at(last)!} d={d} slug={league.slug} />
          )}
        </SimpleGrid>
      )}
    </Stack>
  );
}
