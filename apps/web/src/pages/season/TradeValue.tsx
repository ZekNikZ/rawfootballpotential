import {
  Accordion,
  Badge,
  Card,
  Group,
  Paper,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import { useSearchParams } from "react-router";
import { teamsQuery, tradeValueQuery } from "../../api/queries";
import type { Entities, Season, TradeBreakdown } from "../../api/schemas";
import { EmptyState, QueryError } from "../../components/QueryState";
import { PositionBadge } from "../../components/PositionBadge";
import { TeamLabel } from "../../components/TeamLabel";
import { SeasonShell } from "./SeasonShell";

type Trade = TradeBreakdown["trades"][number];
type Item = Trade["received"][number];
type Detail = NonNullable<Item["player"]>;
type Players = TradeBreakdown["players"];

const pts = (n: number) => n.toFixed(1);
const signed = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "") + pts(Math.abs(n));
const tone = (n: number) => (n > 0 ? "green" : n < 0 ? "red" : "dimmed");

const NOTE: Record<string, string> = {
  next_season_pending:
    "Next season has not been played yet; it will add to his value (at half) once it is.",
};

/** Who had him that week: "Team" or "Free agent". */
const holderName = (entities: Entities, holder: number | null) =>
  holder === null ? "Free agent" : (entities.teamSeasons[String(holder)]?.name ?? "A team");

function Segments({ detail, entities }: { detail: Detail; entities: Entities }) {
  return (
    <Stack gap="sm">
      {detail.segments.map((g, n) => {
        const sub = g.weeks.reduce((t, w) => t + w.points, 0);
        return (
          <Stack key={n} gap={4}>
            <Text size="sm" fw={600}>
              {g.weight === 1
                ? `${g.year} season`
                : `${g.year} season, counted at ${g.weight * 100}%`}
            </Text>
            {g.weeks.length > 0 && (
              <Table.ScrollContainer minWidth={320}>
                <Table withRowBorders verticalSpacing={2} fz="xs">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Week</Table.Th>
                      <Table.Th>On</Table.Th>
                      <Table.Th ta="right">Points</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {g.weeks.map((w) => (
                      <Table.Tr key={w.week}>
                        <Table.Td>{w.week}</Table.Td>
                        <Table.Td c={w.holder === null ? "dimmed" : undefined}>
                          {holderName(entities, w.holder)}
                        </Table.Td>
                        <Table.Td ta="right">{pts(w.points)}</Table.Td>
                      </Table.Tr>
                    ))}
                    <Table.Tr fw={700}>
                      <Table.Td colSpan={2}>
                        {g.weight === 1 ? "Season total" : `Season total × ${g.weight}`}
                      </Table.Td>
                      <Table.Td ta="right">{pts(sub * g.weight)}</Table.Td>
                    </Table.Tr>
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}
          </Stack>
        );
      })}
      {detail.note && (
        <Text size="xs" c="dimmed">
          {NOTE[detail.note]}
        </Text>
      )}
    </Stack>
  );
}

function ItemName({
  item,
  players,
  entities,
}: {
  item: Item;
  players: Players;
  entities: Entities;
}) {
  if (item.kind === "pick") {
    const from =
      item.pickFranchiseId === null
        ? null
        : entities.franchises[String(item.pickFranchiseId)]?.teamName;
    return (
      <Text size="sm">
        {item.pickSeason} round {item.pickRound} pick
        {from && (
          <Text span c="dimmed">
            {" "}
            (from {from})
          </Text>
        )}
      </Text>
    );
  }
  const p = item.playerId === null ? undefined : players[String(item.playerId)];
  return (
    <Group gap={6} wrap="nowrap">
      <PositionBadge position={p?.position ?? null} />
      <Text size="sm">{p?.name ?? "Unknown player"}</Text>
    </Group>
  );
}

function ItemBody({
  item,
  players,
  entities,
}: {
  item: Item;
  players: Players;
  entities: Entities;
}) {
  const name = (id: number | null) => (id === null ? "?" : (players[String(id)]?.name ?? "?"));
  return (
    <Stack gap="sm">
      {item.player && <Segments detail={item.player} entities={entities} />}
      {item.pick && (
        <Stack gap="xs">
          {item.pick.made ? (
            <>
              <Text size="sm">
                Became <b>{name(item.pick.made.playerId)}</b> in the draft; a pick is worth what
                that player scored, wherever he was.
              </Text>
              {item.pick.made.detail && (
                <Segments detail={item.pick.made.detail} entities={entities} />
              )}
            </>
          ) : (
            <Text size="sm">
              Not drafted yet, so it is worth the average of the {item.pick.averageOf ?? 0} earlier
              round {item.pickRound} picks in this league ({pts(item.pick.value)} each).
            </Text>
          )}
        </Stack>
      )}
      <Text size="sm">
        Value: <b>{pts(item.value)}</b>
      </Text>
    </Stack>
  );
}

function ItemList({
  title,
  items,
  players,
  entities,
  total,
}: {
  title: string;
  items: Item[];
  players: Players;
  entities: Entities;
  total: number;
}) {
  return (
    <Paper withBorder radius="sm" p="xs">
      <Group justify="space-between" mb={4}>
        <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
          {title}
        </Text>
        <Text size="xs" fw={700}>
          {pts(total)}
        </Text>
      </Group>
      {items.length === 0 ? (
        <Text size="sm" c="dimmed">
          Nothing
        </Text>
      ) : (
        <Accordion multiple variant="default" chevronPosition="left">
          {[...items]
            .sort((a, b) => b.value - a.value)
            .map((i) => (
              <Accordion.Item key={i.itemId} value={String(i.itemId)}>
                <Accordion.Control>
                  <Group justify="space-between" wrap="nowrap" pr="xs">
                    <ItemName item={i} players={players} entities={entities} />
                    <Text size="sm" fw={600}>
                      {pts(i.value)}
                    </Text>
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  <ItemBody item={i} players={players} entities={entities} />
                </Accordion.Panel>
              </Accordion.Item>
            ))}
        </Accordion>
      )}
    </Paper>
  );
}

function TradeCard({ trade, data }: { trade: Trade; data: TradeBreakdown }) {
  return (
    <Card withBorder radius="sm" padding="sm">
      <Stack gap="xs">
        <Group justify="space-between" wrap="wrap">
          <Group gap={6} wrap="wrap">
            <Badge size="xs" variant="light" color="grape">
              Trade
            </Badge>
            <Text size="sm" fw={600}>
              with{" "}
              {trade.partners.map((p, n) => (
                <span key={p}>
                  {n > 0 && ", "}
                  <TeamLabel entities={data.entities} teamSeasonId={p} />
                </span>
              ))}
            </Text>
            <Text size="xs" c="dimmed">
              Week {trade.week}
              {trade.executedAt ? ` · ${dayjs(trade.executedAt).format("MMM D, YYYY h:mm A")}` : ""}
            </Text>
          </Group>
          <Text size="sm">
            Net{" "}
            <Text span fw={700} c={tone(trade.net)}>
              {signed(trade.net)}
            </Text>
          </Text>
        </Group>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
          <ItemList
            title="Received"
            items={trade.received}
            players={data.players}
            entities={data.entities}
            total={trade.gained}
          />
          <ItemList
            title="Sent away"
            items={trade.sent}
            players={data.players}
            entities={data.entities}
            total={trade.lost}
          />
        </SimpleGrid>
      </Stack>
    </Card>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Paper withBorder radius="sm" p="xs">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text fz="xl" fw={700} c={color}>
        {value}
      </Text>
    </Paper>
  );
}

function Breakdown({ seasonId, team }: { seasonId: number; team: string }) {
  const q = useQuery(tradeValueQuery(seasonId, team));
  const data = q.data;
  if (q.isPending)
    return (
      <Stack>
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} h={120} />
        ))}
      </Stack>
    );
  if (q.isError && !data) return <QueryError error={q.error} onRetry={() => void q.refetch()} />;
  if (!data) return null;
  const s = data.summary;
  if (s.trades === 0) return <EmptyState>This team made no trades this season.</EmptyState>;
  return (
    <Stack>
      <SimpleGrid cols={{ base: 2, sm: 5 }} spacing="xs">
        <Stat label="Trades" value={String(s.trades)} />
        <Stat label="Value received" value={pts(s.gained)} />
        <Stat label="Value sent away" value={pts(s.lost)} />
        <Stat label="Net value" value={signed(s.net)} color={tone(s.net)} />
        <Stat
          label="Net per trade"
          value={s.netPerTrade === null ? "–" : signed(s.netPerTrade)}
          color={s.netPerTrade === null ? undefined : tone(s.netPerTrade)}
        />
      </SimpleGrid>
      {data.trades.map((t) => (
        <TradeCard key={t.id} trade={t} data={data} />
      ))}
      <Text size="sm" c="dimmed">
        Each player is worth the points he scored from the trade week to the end of the season,
        wherever he was: on the team that received him, on someone else's roster after a later
        trade, or on nobody's after being dropped. What the team did with him afterward never
        changes it, so a quick flip or drop cannot shrink a trade's value. Points are scored under
        this league's scoring from Sleeper's stat lines. In dynasty the next season also counts, at
        half. A pick is worth the player it became, or before the draft the average of earlier picks
        in that round. Net value is received minus sent away; net per trade divides it by the number
        of trades. Figures are rounded to one decimal.
      </Text>
    </Stack>
  );
}

function Page({ season }: { season: Season }) {
  const [search, setSearch] = useSearchParams();
  const teams = useQuery(teamsQuery(season.id, false));
  const options = (teams.data?.teams ?? [])
    .map((t) => {
      const e = teams.data?.entities;
      const m = e?.teamSeasons[String(t.team_season_id)]?.managerId;
      const manager = m == null ? null : e?.managers[String(m)]?.name;
      return {
        value: String(t.team_season_id),
        label: [manager, t.name].filter(Boolean).join(" · "),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
  const team = search.get("team") ?? options[0]?.value ?? null;
  return (
    <Stack>
      <Stack gap={2}>
        <Text size="sm">Manager</Text>
        <Select
          aria-label="Manager"
          allowDeselect={false}
          w={280}
          data={options}
          value={team}
          onChange={(v) =>
            setSearch(
              (prev) => {
                const next = new URLSearchParams(prev);
                if (v) next.set("team", v);
                return next;
              },
              { replace: true, preventScrollReset: true }
            )
          }
        />
      </Stack>
      {team && <Breakdown seasonId={season.id} team={team} />}
    </Stack>
  );
}

export default function TradeValue() {
  return (
    <SeasonShell title="Trade Value" needs="playerData">
      {(season) => <Page season={season} />}
    </SeasonShell>
  );
}
