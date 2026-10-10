import { Group, Select, Skeleton, Stack, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { transactionsQuery } from "../api/queries";
import { EmptyState, QueryError } from "./QueryState";
import { SegmentedOrSelect } from "./records/filters";
import { TransactionCard, TX_TYPES } from "./TransactionCard";

export interface TransactionSeason {
  year: number;
  /** league_season id, for the transactions endpoint. */
  seasonId: number;
  /** This franchise's team in that season. */
  teamSeasonId: number;
  /** The season has player data, so trades show their estimated value. */
  playerData: boolean;
}

/** Every transaction a franchise made in one season (newest first), picked with a year dropdown. */
export function FranchiseTransactions({ seasons }: { seasons: TransactionSeason[] }) {
  const [picked, setPicked] = useState<string | null>(null);
  const [type, setType] = useState("all");
  const season = seasons.find((s) => String(s.year) === picked) ?? seasons[0];
  const q = useQuery({
    ...transactionsQuery(season?.seasonId ?? 0, {
      team: String(season?.teamSeasonId ?? 0),
      limit: 200,
      ...(type !== "all" ? { type } : {}),
    }),
    enabled: season !== undefined,
  });
  if (!season) return null;
  const data = q.data;
  return (
    <Stack gap={10}>
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <Title order={2}>Transactions</Title>
        <Group align="flex-end" gap="md" wrap="wrap">
          <SegmentedOrSelect label="Type" value={type} options={TX_TYPES} onChange={setType} />
          <Select
            aria-label="Season"
            w={130}
            allowDeselect={false}
            value={String(season.year)}
            onChange={setPicked}
            data={seasons.map((s) => ({ value: String(s.year), label: String(s.year) }))}
          />
        </Group>
      </Group>
      {q.isPending && (
        <Stack>
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} h={64} />
          ))}
        </Stack>
      )}
      {q.isError && !data && <QueryError error={q.error} onRetry={() => void q.refetch()} />}
      {data && data.transactions.length === 0 && (
        <EmptyState>No transactions in {season.year}.</EmptyState>
      )}
      {data?.transactions.map((tx) => (
        <TransactionCard
          key={tx.id}
          tx={tx}
          entities={data.entities}
          showValue={season.playerData}
        />
      ))}
      {data && data.transactions.length > 0 && (
        <Text size="sm" c="dimmed">
          {data.total} transaction{data.total === 1 ? "" : "s"} in {season.year}
          {data.total > data.transactions.length
            ? `, showing the newest ${data.transactions.length}`
            : ""}
          . Failed claims are listed but never counted in records.
        </Text>
      )}
    </Stack>
  );
}
