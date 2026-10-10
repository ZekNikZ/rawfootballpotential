import { Group, Pagination, Select, Skeleton, Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { teamsQuery, transactionsQuery } from "../../api/queries";
import type { Season } from "../../api/schemas";
import { EmptyState, QueryError } from "../../components/QueryState";
import { SegmentedOrSelect } from "../../components/records/filters";
import { TransactionCard, TX_TYPES } from "../../components/TransactionCard";
import { SeasonShell } from "./SeasonShell";

const PAGE = 25;
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
          options={TX_TYPES}
          onChange={(v) => set({ type: v === "all" ? null : v })}
        />
        <Stack gap={2}>
          <Text size="sm">Team</Text>
          <Select
            aria-label="Team"
            placeholder="All teams"
            clearable
            w={240}
            data={(teams.data?.teams ?? []).map((t) => {
              const e = teams.data?.entities;
              const m = e?.teamSeasons[String(t.team_season_id)]?.managerId;
              const manager = m == null ? null : e?.managers[String(m)]?.name;
              return {
                value: String(t.team_season_id),
                label: manager ? `${t.name} (${manager})` : t.name,
              };
            })}
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
        <TransactionCard
          key={tx.id}
          tx={tx}
          entities={data.entities}
          showValue={season.data.playerData}
        />
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
          {season.data.playerData &&
            " Estimated trade value is how many points a side's players added to its best possible lineups from the trade to the end of the season, plus half of the other points they scored for it (depth); a dynasty player kept into next season also counts, at half, draft picks as the player they became, plus what the team received when it traded one of them on again. The number beside each player or pick is his share of that value. FAAB is not valued."}
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
