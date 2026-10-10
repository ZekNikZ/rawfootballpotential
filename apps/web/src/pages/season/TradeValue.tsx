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

const SLOT: Record<string, string> = { starter: "Started", bench: "Bench", ir: "IR", taxi: "Taxi" };
const END: Record<string, (week: number) => string> = {
  dropped: (w) => `Dropped in week ${w}, so nothing counts after that`,
  traded: (w) => `Traded away in week ${w}, so nothing counts after that`,
  commissioner: (w) => `Moved by the commissioner in week ${w}, so nothing counts after that`,
  season_end: (w) => `Kept to the end of the season (week ${w})`,
  ongoing: (w) => `Still on the roster through week ${w} (season in progress)`,
};
const NOTE: Record<string, string> = {
  not_rostered: "He was not on this team's roster after the trade, so no weeks count.",
  next_season_pending:
    "Next season has not been played yet; if he is kept it will count at half once it is.",
  not_kept: "He was not on this franchise's roster the next season, so nothing more counts.",
};

function Segments({ detail }: { detail: Detail }) {
  return (
    <Stack gap="sm">
      {detail.segments.map((g, n) => {
        const sub = g.weeks.reduce((t, w) => t + w.lineup + w.depth, 0);
        return (
          <Stack key={n} gap={4}>
            <Text size="sm" fw={600}>
              {g.weight === 1
                ? `${g.year} season`
                : `${g.year} season, counted at ${g.weight * 100}%`}
            </Text>
            {g.weeks.length > 0 && (
              <Table.ScrollContainer minWidth={420}>
                <Table withRowBorders verticalSpacing={2} fz="xs">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Week</Table.Th>
                      <Table.Th>Role</Table.Th>
                      <Table.Th ta="right">Points</Table.Th>
                      <Table.Th ta="right">Lineup</Table.Th>
                      <Table.Th ta="right">Depth</Table.Th>
                      <Table.Th ta="right">Value</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {g.weeks.map((w) => (
                      <Table.Tr key={w.week}>
                        <Table.Td>{w.week}</Table.Td>
                        <Table.Td>{SLOT[w.slot] ?? w.slot}</Table.Td>
                        <Table.Td ta="right">{pts(w.points)}</Table.Td>
                        <Table.Td ta="right">{pts(w.lineup)}</Table.Td>
                        <Table.Td ta="right">{pts(w.depth)}</Table.Td>
                        <Table.Td ta="right">{pts(w.lineup + w.depth)}</Table.Td>
                      </Table.Tr>
                    ))}
                    <Table.Tr fw={700}>
                      <Table.Td colSpan={5}>
                        {g.weight === 1 ? "Season total" : `Season total × ${g.weight}`}
                      </Table.Td>
                      <Table.Td ta="right">{pts(sub * g.weight)}</Table.Td>
                    </Table.Tr>
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}
            <Text size="xs" c="dimmed">
              {(END[g.end.reason] ?? (() => ""))(g.end.week)}
            </Text>
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

function pickLabel(i: { pickSeason: number | null; pickRound: number | null }) {
  return `${i.pickSeason} round ${i.pickRound} pick`;
}

function ItemBody({ item, players }: { item: Item; players: Players }) {
  const name = (id: number | null) => (id === null ? "?" : (players[String(id)]?.name ?? "?"));
  return (
    <Stack gap="sm">
      {item.player && <Segments detail={item.player} />}
      {item.pick && (
        <Stack gap="xs">
          {item.pick.made ? (
            <>
              <Text size="sm">
                Became <b>{name(item.pick.made.playerId)}</b> in the draft; a pick is worth what
                that player gave the team that made it.
              </Text>
              {item.pick.made.detail && <Segments detail={item.pick.made.detail} />}
            </>
          ) : (
            <Text size="sm">
              Not drafted yet, so it is worth the average of the {item.pick.averageOf ?? 0} earlier
              round {item.pickRound} picks in this league ({pts(item.pick.value)} each).
            </Text>
          )}
        </Stack>
      )}
      {item.chain && (
        <Paper withBorder p="xs" radius="sm">
          <Text size="sm" fw={600}>
            Traded on in week {item.chain.week}
          </Text>
          <Text size="sm">
            The team that received him traded him again. He is credited with{" "}
            {(item.chain.share * 100).toFixed(0)}% of the {pts(item.chain.returned)} points the
            return was worth (
            {item.chain.returnedItems
              .map((r) =>
                r.kind === "pick"
                  ? `${pickLabel(r)} ${pts(r.value)}`
                  : `${name(r.playerId)} ${pts(r.value)}`
              )
              .join(", ")}
            ), which adds <b>{signed(item.value - item.direct)}</b>.
          </Text>
        </Paper>
      )}
      <Text size="sm">
        Value to the team that received him: <b>{pts(item.direct)}</b>
        {item.chain && (
          <>
            . Counting the re-trade: {pts(item.direct)} {signed(item.value - item.direct)} ={" "}
            <b>{pts(item.value)}</b>, the figure on the Transactions page (left out of the totals,
            since the later trade already counts it)
          </>
        )}
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
                      {pts(i.direct)}
                      {i.chain && (
                        <Text span c="dimmed" fz="xs">
                          {" "}
                          {signed(i.value - i.direct)} re-trade
                        </Text>
                      )}
                    </Text>
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  <ItemBody item={i} players={players} />
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
            {Math.abs(trade.chainedNet - trade.net) >= 0.05 && (
              <Text span c="dimmed" fz="xs">
                {" "}
                ({signed(trade.chainedNet)} counting re-trades)
              </Text>
            )}
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
        Each player is worth, for every week he was on the roster after the trade, the points he
        added to the team's best possible lineup (Lineup) plus half of the rest of his points
        (Depth, starters and bench only). Counting stops when he left the team, one week after the
        move; in dynasty, a player kept through the season end also counts next season at half. A
        pick is worth the player it became, or before the draft the average of earlier picks in that
        round. Net value is received minus sent away; net per trade divides it by the number of
        trades. A player traded on again is also credited with his share of what came back
        (re-trade), which the Transactions page includes but these totals leave out so it is not
        counted twice. Figures are rounded to one decimal.
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
