import { Badge, Card, Group, Pagination, Select, Skeleton, Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import { useSearchParams } from "react-router";
import { teamsQuery, transactionsQuery } from "../../api/queries";
import type { Entities, Season, Transactions as TxData } from "../../api/schemas";
import { EmptyState, QueryError } from "../../components/QueryState";
import { SegmentedOrSelect } from "../../components/records/filters";
import { TeamLabel } from "../../components/TeamLabel";
import { fmtMoney } from "../../lib/format";
import { SeasonShell } from "./SeasonShell";

type Tx = TxData["transactions"][number];
type Item = Tx["items"][number];

const PAGE = 25;
const TYPES = [
  { value: "all", label: "All" },
  { value: "trade", label: "Trades" },
  { value: "waiver", label: "Waivers" },
  { value: "free_agent", label: "Free agents" },
  { value: "commissioner", label: "Commissioner" },
];
const TYPE_COLOR: Record<string, string> = {
  trade: "grape",
  waiver: "blue",
  free_agent: "teal",
  commissioner: "orange",
};
const TYPE_LABEL: Record<string, string> = {
  trade: "Trade",
  waiver: "Waiver",
  free_agent: "Free agent",
  commissioner: "Commissioner",
};

function itemText(i: Item, entities: Entities): string {
  if (i.kind === "pick") {
    const from =
      i.originalFranchiseId === null
        ? null
        : entities.franchises[String(i.originalFranchiseId)]?.teamName;
    return `${i.pickSeason ?? ""} round ${i.pickRound ?? "?"} pick${from ? ` (originally ${from})` : ""}`;
  }
  if (i.kind === "faab") return `${fmtMoney(i.amount ?? 0)} FAAB`;
  return `${i.player ?? "Unknown player"}${i.position ? ` (${i.position})` : ""}`;
}

function Body({ tx, entities }: { tx: Tx; entities: Entities }) {
  if (tx.type === "trade") {
    const sides = new Map<number, Item[]>();
    for (const i of tx.items) {
      if (i.toTeamSeasonId === null) continue;
      sides.set(i.toTeamSeasonId, [...(sides.get(i.toTeamSeasonId) ?? []), i]);
    }
    return (
      <Stack gap={4}>
        {[...sides].map(([team, items]) => (
          <Text key={team} size="sm">
            <Text span fw={600}>
              <TeamLabel entities={entities} teamSeasonId={team} hideManager />
            </Text>{" "}
            gets {items.map((i) => itemText(i, entities)).join(", ")}
          </Text>
        ))}
      </Stack>
    );
  }
  const added = tx.items.filter((i) => i.direction === "add");
  const dropped = tx.items.filter((i) => i.direction === "drop");
  const bid = tx.items.find((i) => i.faabBid !== null)?.faabBid ?? null;
  return (
    <Stack gap={2}>
      {added.map((i, n) => (
        <Text key={`a${n}`} size="sm">
          <Text span c="green" fw={600}>
            +{" "}
          </Text>
          {itemText(i, entities)}
          {bid !== null && n === 0 ? ` · ${fmtMoney(bid)} bid` : ""}
        </Text>
      ))}
      {dropped.map((i, n) => (
        <Text key={`d${n}`} size="sm" c="dimmed">
          <Text span c="red" fw={600}>
            −{" "}
          </Text>
          {itemText(i, entities)}
        </Text>
      ))}
    </Stack>
  );
}

function List({ season }: { season: Season }) {
  const [search, setSearch] = useSearchParams();
  const type = search.get("type") ?? "all";
  const team = search.get("team");
  const page = Math.max(1, Number(search.get("page")) || 1);
  const teams = useQuery(teamsQuery(season.id, false));
  const q = useQuery(
    transactionsQuery(season.id, {
      limit: PAGE,
      offset: (page - 1) * PAGE,
      ...(type !== "all" ? { type } : {}),
      ...(team ? { team } : {}),
    })
  );
  const set = (patch: Record<string, string | null>, keepPage = false) =>
    setSearch(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v === null) next.delete(k);
          else next.set(k, v);
        }
        if (!keepPage) next.delete("page");
        return next;
      },
      { replace: true, preventScrollReset: true }
    );
  const data = q.data;
  return (
    <Stack>
      <Group align="flex-end" gap="md" wrap="wrap">
        <SegmentedOrSelect
          label="Type"
          value={type}
          options={TYPES}
          onChange={(v) => set({ type: v === "all" ? null : v })}
        />
        <Stack gap={2}>
          <Text size="sm">Team</Text>
          <Select
            aria-label="Team"
            placeholder="All teams"
            searchable
            clearable
            w={240}
            data={(teams.data?.teams ?? []).map((t) => ({
              value: String(t.team_season_id),
              label: t.name,
            }))}
            value={team}
            onChange={(v) => set({ team: v })}
          />
        </Stack>
      </Group>
      {q.isPending && (
        <Stack>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} h={64} />
          ))}
        </Stack>
      )}
      {q.isError && !data && <QueryError error={q.error} onRetry={() => void q.refetch()} />}
      {data && data.transactions.length === 0 && <EmptyState>No transactions match.</EmptyState>}
      {data?.transactions.map((tx) => (
        <Card
          key={tx.id}
          withBorder
          radius="sm"
          padding="sm"
          opacity={tx.status === "failed" ? 0.7 : 1}
        >
          <Stack gap={6}>
            <Group gap={6} wrap="wrap">
              <Badge size="xs" variant="light" color={TYPE_COLOR[tx.type] ?? "gray"}>
                {TYPE_LABEL[tx.type] ?? tx.type}
              </Badge>
              {tx.status === "failed" && (
                <Badge size="xs" variant="light" color="red">
                  failed{tx.failureReason ? `: ${tx.failureReason}` : ""}
                </Badge>
              )}
              {tx.type !== "trade" && tx.creatorTeamSeasonId !== null && (
                <Text size="sm" fw={600}>
                  <TeamLabel entities={data.entities} teamSeasonId={tx.creatorTeamSeasonId} />
                </Text>
              )}
              <Text size="xs" c="dimmed">
                {tx.week !== null ? `Week ${tx.week}` : ""}
                {tx.executedAt ? ` · ${dayjs(tx.executedAt).format("MMM D, YYYY h:mm A")}` : ""}
              </Text>
            </Group>
            <Body tx={tx} entities={data.entities} />
          </Stack>
        </Card>
      ))}
      {data && data.total > PAGE && (
        <Pagination
          total={Math.ceil(data.total / PAGE)}
          value={page}
          onChange={(p) => set({ page: p === 1 ? null : String(p) }, true)}
          size="sm"
        />
      )}
      {data && (
        <Text size="sm" c="dimmed">
          {data.total} transaction{data.total === 1 ? "" : "s"}. Failed claims are listed but never
          counted in records.
        </Text>
      )}
    </Stack>
  );
}

export default function Transactions() {
  return (
    <SeasonShell title="Transactions" needs="transactions">
      {(season) => <List season={season} />}
    </SeasonShell>
  );
}
