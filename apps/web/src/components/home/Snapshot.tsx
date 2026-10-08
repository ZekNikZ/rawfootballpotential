import {
  Anchor,
  Avatar,
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
import {
  matchupsQuery,
  recentTransactionsQuery,
  recordQuery,
  standingsQuery,
  superlativesQuery,
  topPerformersQuery,
} from "../../api/queries";
import type { Entities, Matchups, Standings, Superlatives, Transactions } from "../../api/schemas";
import { fmtDecimal, fmtInt, ordinal, seasonLabel } from "../../lib/format";
import { useLeague } from "../../lib/league-context";
import { PositionBadge } from "../PositionBadge";
import { EmptyState, QueryError } from "../QueryState";
import { TeamAvatar } from "../TeamAvatar";
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
                    <Group gap={8} wrap="nowrap">
                      <TeamAvatar src={r.avatar} name={teamName(d.entities, r.team_season_id)} />
                      <div>
                        <Anchor
                          component={Link}
                          to={`/${league.slug}/franchises/${r.franchise_id}`}
                        >
                          {teamName(d.entities, r.team_season_id)}
                        </Anchor>{" "}
                        <Text span c="dimmed" fz="sm">
                          ({managerOf(d.entities, r.team_season_id)})
                        </Text>
                      </div>
                    </Group>
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
              <Stack gap={6}>
                {g.teams.map((t) => (
                  <Group key={t.teamSeasonId} justify="space-between" wrap="nowrap" gap="xs">
                    <Group gap={8} wrap="nowrap" miw={0}>
                      <TeamAvatar src={t.avatar} name={teamName(d.entities, t.teamSeasonId)} />
                      <Text
                        truncate
                        fw={t.result === "W" ? 700 : undefined}
                        c={t.result === "L" ? "dimmed" : undefined}
                      >
                        {teamName(d.entities, t.teamSeasonId)}
                      </Text>
                    </Group>
                    <Text className={classes.num} fw={t.result === "W" ? 700 : undefined}>
                      {fmtDecimal(t.points)}
                    </Text>
                  </Group>
                ))}
              </Stack>
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

const SUPER_ICON: Record<string, string> = {
  high: "🔥",
  low: "🥶",
  blowout: "💥",
  closest: "😅",
  iq: "🧠",
  bench: "🪑",
};

function superValue(unit: "points" | "margin" | "pct", v: number): string {
  if (unit === "pct") return v >= 0.9995 ? "100%" : `${(v * 100).toFixed(1)}%`;
  return fmtDecimal(v);
}

const SUPER_UNIT: Record<string, string> = {
  points: "pts",
  margin: "margin",
  pct: "of the best lineup",
};

function SuperlativeTile({
  item,
  entities,
}: {
  item: Superlatives["items"][number];
  entities: Entities;
}) {
  const holders = item.holders;
  const names = holders.map((h) => teamName(entities, h.teamSeasonId));
  const opponent = holders[0]?.opponentTeamSeasonId ?? null;
  return (
    <Paper withBorder radius="sm" p="sm" className={classes.tile}>
      <Group gap={6} wrap="nowrap">
        <Text span fz="lg" lh={1}>
          {SUPER_ICON[item.key] ?? ""}
        </Text>
        <Text size="xs" c="dimmed" tt="uppercase" fw={700} lh={1.2}>
          {item.label}
        </Text>
      </Group>
      <Group gap="sm" wrap="nowrap" mt="sm" align="center">
        {holders.length === 1 ? (
          <TeamAvatar src={holders[0]?.avatar} name={names[0]} size={52} />
        ) : (
          <Avatar.Group spacing="md">
            {holders.slice(0, 3).map((h, i) => (
              <TeamAvatar key={h.teamSeasonId} src={h.avatar} name={names[i]} size={44} />
            ))}
          </Avatar.Group>
        )}
        <Stack gap={0} miw={0}>
          <Text fw={700} lh={1.25} className={classes.tileName}>
            {names.join(" & ")}
          </Text>
          {item.unit === "margin" && opponent !== null && (
            <Text size="xs" c="dimmed" truncate>
              over {teamName(entities, opponent)}
            </Text>
          )}
        </Stack>
      </Group>
      <Group gap={6} align="baseline" mt="sm">
        <Text className={classes.num} fw={800} fz={28} lh={1}>
          {superValue(item.unit, holders[0]?.value ?? 0)}
        </Text>
        <Text size="xs" c="dimmed">
          {SUPER_UNIT[item.unit]}
        </Text>
      </Group>
    </Paper>
  );
}

function SuperlativesPanel({ seasonId }: { seasonId: number }) {
  const q = useQuery(superlativesQuery(seasonId));
  const d = q.data;
  return (
    <Panel
      title={d?.week ? `Week ${d.week} superlatives` : "Weekly superlatives"}
      aside={
        d?.week ? (
          <Text c="dimmed" fz="sm">
            Latest finished week
          </Text>
        ) : null
      }
    >
      {!d && <PanelState query={q} />}
      {d && d.items.length === 0 && <EmptyState>No finished week yet.</EmptyState>}
      {d && d.items.length > 0 && (
        <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="sm">
          {d.items.map((item) => (
            <SuperlativeTile key={item.key} item={item} entities={d.entities} />
          ))}
        </SimpleGrid>
      )}
    </Panel>
  );
}

const SLOT_BADGE: Record<string, { label: string; color: string }> = {
  starter: { label: "Started", color: "green" },
  bench: { label: "Benched", color: "gray" },
  ir: { label: "IR", color: "orange" },
};

function TopPerformersPanel({ seasonId }: { seasonId: number }) {
  const q = useQuery(topPerformersQuery(seasonId));
  const d = q.data;
  return (
    <Panel
      title={d?.week ? `Week ${d.week} top performers` : "Top performers"}
      aside={
        d?.week ? (
          <Text c="dimmed" fz="sm">
            Latest finished week
          </Text>
        ) : null
      }
    >
      {!d && <PanelState query={q} />}
      {d && d.players.length === 0 && <EmptyState>No finished week yet.</EmptyState>}
      {d && d.players.length > 0 && (
        <Stack gap={8}>
          {d.players.map((p, i) => (
            <Group
              key={`${p.playerId}-${p.teamSeasonId}`}
              wrap="nowrap"
              gap="xs"
              justify="space-between"
            >
              <Group gap={8} wrap="nowrap" miw={0}>
                <Text c="dimmed" w={18} ta="right" className={classes.num}>
                  {i + 1}
                </Text>
                <PositionBadge position={p.position} />
                <Stack gap={0} miw={0}>
                  <Text truncate fw={600}>
                    {p.name}
                  </Text>
                  <Text size="xs" c="dimmed" truncate>
                    {teamName(d.entities, p.teamSeasonId)}
                  </Text>
                </Stack>
              </Group>
              <Group gap={8} wrap="nowrap" style={{ flexShrink: 0 }}>
                <Badge
                  size="xs"
                  variant="light"
                  color={SLOT_BADGE[p.slotKind]?.color ?? "gray"}
                  visibleFrom="xs"
                >
                  {SLOT_BADGE[p.slotKind]?.label ?? p.slotKind}
                </Badge>
                <Text className={classes.num} fw={700}>
                  {fmtDecimal(p.points)}
                </Text>
              </Group>
            </Group>
          ))}
        </Stack>
      )}
    </Panel>
  );
}

function PowerRankingsPanel({ seasonId }: { seasonId: number }) {
  const { league } = useLeague();
  const q = useQuery(recordQuery(league.slug, "career.power", { limit: 10 }));
  // Franchise logos come from this season's standings (already fetched by the Standings panel).
  const standings = useQuery(standingsQuery(seasonId));
  const logo = new Map((standings.data?.rows ?? []).map((r) => [r.franchise_id, r.avatar]));
  const d = q.data;
  return (
    <Panel
      title="Power rankings"
      aside={
        <Anchor component={Link} to={`/${league.slug}/records/power-rankings`} fz="sm">
          All rankings
        </Anchor>
      }
    >
      {!d && <PanelState query={q} />}
      {d && d.rows.length === 0 && <EmptyState>No rankings yet.</EmptyState>}
      {d && d.rows.length > 0 && (
        <Stack gap={8}>
          {d.rows.map((r) => {
            const fid = Number(r.refs.franchiseId);
            const f = d.entities.franchises[String(fid)];
            const manager =
              f?.managerId == null
                ? null
                : (d.entities.managers[String(f.managerId)]?.name ?? null);
            return (
              <Group key={fid} wrap="nowrap" gap="xs" justify="space-between">
                <Group gap={8} wrap="nowrap" miw={0}>
                  <Text c="dimmed" w={18} ta="right" className={classes.num}>
                    {r.rank}
                  </Text>
                  <TeamAvatar src={logo.get(fid)} name={f?.teamName ?? undefined} />
                  <Stack gap={0} miw={0}>
                    <Anchor
                      component={Link}
                      to={`/${league.slug}/franchises/${fid}`}
                      fw={600}
                      truncate
                    >
                      {f?.teamName ?? `Franchise ${fid}`}
                    </Anchor>
                    {manager && (
                      <Text size="xs" c="dimmed" truncate>
                        {manager}
                      </Text>
                    )}
                  </Stack>
                </Group>
                <Text className={classes.num} fw={700} style={{ flexShrink: 0 }}>
                  {fmtInt(Number(r.values.rating))}
                </Text>
              </Group>
            );
          })}
        </Stack>
      )}
    </Panel>
  );
}

export function InSeasonSnapshot({ seasonId }: { seasonId: number }) {
  return (
    <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
      <StandingsPanel seasonId={seasonId} />
      <MatchupsPanel seasonId={seasonId} />
      <SuperlativesPanel seasonId={seasonId} />
      <TopPerformersPanel seasonId={seasonId} />
      <TransactionsPanel seasonId={seasonId} />
      <PowerRankingsPanel seasonId={seasonId} />
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
      <Group justify="space-between" wrap="nowrap" w="100%">
        <Text fz="2rem" lh={1}>
          {medal}
        </Text>
        <TeamAvatar src={row.avatar} name={teamName(d.entities, row.team_season_id)} size={44} />
      </Group>
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
