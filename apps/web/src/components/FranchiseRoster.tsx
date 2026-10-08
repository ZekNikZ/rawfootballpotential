import { Badge, Group, Select, Skeleton, Stack, Table, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { franchiseRosterQuery } from "../api/queries";
import type { FranchiseRoster as RosterData } from "../api/schemas";
import { fmtDecimal, irMissingNote } from "../lib/format";
import { useLeague } from "../lib/league-context";
import classes from "./DataTable.module.css";
import { PositionBadge } from "./PositionBadge";
import { EmptyState, QueryError } from "./QueryState";

type Player = RosterData["players"][number];

const GROUPS = [
  { kinds: ["starter"], title: "Starters" },
  { kinds: ["bench"], title: "Bench" },
  { kinds: ["ir", "taxi"], title: "IR / taxi" },
];

function caption(r: RosterData): string {
  if (r.source === "live") return "Current roster, as of the latest sync.";
  if (r.source === "final-week") return `Roster as of week ${r.week}, the last week played.`;
  return "";
}

function RosterTable({ players, irUnrecorded }: { players: Player[]; irUnrecorded: number }) {
  return (
    <Table.ScrollContainer minWidth={460} type="native">
      <Table className={classes.table} verticalSpacing={5} withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={64}>Slot</Table.Th>
            <Table.Th>Player</Table.Th>
            <Table.Th>NFL</Table.Th>
            <Table.Th>Status</Table.Th>
            <Table.Th data-numeric="">Starts</Table.Th>
            <Table.Th data-numeric="">Season pts</Table.Th>
          </Table.Tr>
        </Table.Thead>
        {GROUPS.map((g) => {
          const rows = players.filter((p) => g.kinds.includes(p.slotKind));
          if (rows.length === 0) return null;
          return (
            <Table.Tbody key={g.title}>
              <Table.Tr className={classes.group}>
                <Table.Td colSpan={6}>
                  {g.title}
                  {g.title === "Bench" && irUnrecorded > 0 ? "*" : ""} · {rows.length}
                </Table.Td>
              </Table.Tr>
              {rows.map((p) => (
                <Table.Tr
                  key={p.playerId}
                  className={g.kinds[0] === "starter" ? undefined : classes.secondary}
                >
                  <Table.Td c="dimmed">{p.slotKind === "bench" ? "BN" : (p.slot ?? "–")}</Table.Td>
                  <Table.Td>
                    <Group gap={8} wrap="nowrap">
                      <PositionBadge position={p.position} />
                      <Text span>{p.name}</Text>
                    </Group>
                  </Table.Td>
                  <Table.Td>{p.nflTeam ?? "FA"}</Table.Td>
                  <Table.Td>
                    {p.injuryStatus && (
                      <Badge size="xs" variant="light" color="red">
                        {p.injuryStatus}
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td data-numeric="">{p.starts}</Table.Td>
                  <Table.Td data-numeric="">
                    {p.points === null ? "–" : fmtDecimal(p.points)}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          );
        })}
      </Table>
    </Table.ScrollContainer>
  );
}

/** A franchise's roster for one season, picked with a dropdown (newest season with lineup data first). */
export function FranchiseRoster({
  franchiseId,
  seasons,
}: {
  franchiseId: number;
  seasons: number[];
}) {
  const { league } = useLeague();
  const [picked, setPicked] = useState<string | null>(null);
  const year = Number(picked ?? seasons[0]);
  const q = useQuery({
    ...franchiseRosterQuery(league.slug, franchiseId, year),
    enabled: seasons.length > 0,
  });
  if (seasons.length === 0) return null;
  return (
    <Stack gap={10}>
      <Group justify="space-between" align="flex-end">
        <Title order={2}>Roster</Title>
        <Select
          aria-label="Season"
          w={130}
          allowDeselect={false}
          value={String(year)}
          onChange={setPicked}
          data={seasons.map((s) => ({ value: String(s), label: String(s) }))}
        />
      </Group>
      {q.isPending ? (
        <Skeleton h={240} />
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.players.length === 0 ? (
        <EmptyState>No roster on file for {year}.</EmptyState>
      ) : (
        <>
          <RosterTable players={q.data.players} irUnrecorded={q.data.irUnrecorded} />
          <Text size="sm" c="dimmed">
            {caption(q.data)} Points and starts count only weeks the player was on this team.
          </Text>
          {q.data.irUnrecorded > 0 && (
            <Text size="xs" c="dimmed">
              * {irMissingNote(q.data.irUnrecorded)}
            </Text>
          )}
        </>
      )}
    </Stack>
  );
}
