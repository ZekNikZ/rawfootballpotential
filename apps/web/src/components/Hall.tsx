import { Card, Group, SimpleGrid, Skeleton, Stack, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { hallQuery } from "../api/queries";
import type { HallEntry, Highlight } from "../api/schemas";
import { useLeague } from "../lib/league-context";
import { highlightValue, scoreText, TeamLink, whenText } from "./Highlights";
import { EmptyState, QueryError } from "./QueryState";

const MEDAL = ["🥇", "🥈", "🥉"];

function Holder({ h, unit, by }: { h: Highlight; unit: string | null; by: HallEntry["by"] }) {
  const context = [h.player ? `${h.player}${h.position ? ` (${h.position})` : ""}` : null]
    .concat([scoreText(h), whenText(h)])
    .filter(Boolean)
    .join(" · ");
  return (
    <Group gap="xs" wrap="nowrap" align="flex-start" justify="space-between">
      <Group gap="xs" wrap="nowrap" align="flex-start" miw={0}>
        <Text w={24} ta="center" lh={1.4}>
          {MEDAL[h.rank - 1] ?? h.rank}
        </Text>
        <Stack gap={0} miw={0}>
          <TeamLink franchiseId={h.franchiseId} team={h.team} manager={h.manager} lead={by} />
          {context && (
            <Text size="xs" c="dimmed">
              {context}
            </Text>
          )}
        </Stack>
      </Group>
      <Text fw={700} style={{ fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
        {highlightValue(h)}
        {unit && (
          <Text span c="dimmed" fz="xs" fw={400}>
            {" "}
            {unit}
          </Text>
        )}
      </Text>
    </Group>
  );
}

function EntryCard({ entry }: { entry: HallEntry }) {
  return (
    <Card withBorder radius="sm" padding="md">
      <Title order={4} mb="xs">
        {entry.title}
      </Title>
      <Stack gap={8}>
        {entry.holders.map((h, i) => (
          <Holder
            key={`${h.franchiseId}-${h.teamSeasonId}-${h.week}-${h.player}-${i}`}
            h={h}
            unit={entry.unit}
            by={entry.by}
          />
        ))}
      </Stack>
    </Card>
  );
}

/** The Hall of Fame (the league's best marks) or the Hall of Shame (its worst), built from the record engines. */
export function Hall({ side }: { side: "fame" | "shame" }) {
  const { league } = useLeague();
  const q = useQuery(hallQuery(league.slug));
  if (q.isPending)
    return (
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} h={170} />
        ))}
      </SimpleGrid>
    );
  if (q.isError) return <QueryError error={q.error} onRetry={() => void q.refetch()} />;
  const entries = q.data[side];
  return (
    <Stack gap="md">
      <Text c="dimmed" size="sm">
        {side === "fame"
          ? "The best marks in league history: championships, ratings, streaks and the biggest single games and moves. Each list is the top of a record, so it always matches the Records pages."
          : "The cautionary tales: last places, droughts, the unluckiest seasons, the costliest lineup mistakes and the worst beatings. Each list is the top of a record (sorted the unflattering way)."}
      </Text>
      {entries.length === 0 ? (
        <EmptyState>Nothing here yet.</EmptyState>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
          {entries.map((e) => (
            <EntryCard key={e.id} entry={e} />
          ))}
        </SimpleGrid>
      )}
    </Stack>
  );
}
