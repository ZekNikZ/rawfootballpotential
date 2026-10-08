import { Badge, Group, SegmentedControl, Skeleton, Stack, Table, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { draftsQuery } from "../../api/queries";
import type { Drafts, Season } from "../../api/schemas";
import { EmptyState, QueryError } from "../../components/QueryState";
import { TeamLabel } from "../../components/TeamLabel";
import { fmtMoney } from "../../lib/format";
import classes from "./Draft.module.css";
import { SeasonShell } from "./SeasonShell";

type Draft = Drafts["drafts"][number];

const POS_COLOR: Record<string, string> = {
  QB: "red",
  RB: "green",
  WR: "blue",
  TE: "orange",
  K: "grape",
  DEF: "gray",
};
const KIND: Record<string, string> = {
  startup: "Startup draft",
  rookie: "Rookie draft",
  redraft: "Draft",
};

function Board({ draft, entities }: { draft: Draft; entities: Drafts["entities"] }) {
  // Columns are draft slots (the order teams pick in round one); each cell is one pick.
  const slots = Object.entries(draft.slotOrder ?? {})
    .map(([slot, team]) => ({ slot: Number(slot), team }))
    .sort((a, b) => a.slot - b.slot);
  const rounds = draft.rounds ?? Math.max(0, ...draft.picks.map((p) => p.round));
  const bySlotRound = new Map(draft.picks.map((p) => [`${p.round}:${p.slot}`, p]));
  if (slots.length === 0)
    return <EmptyState>This draft has no slot order to build a board from.</EmptyState>;
  return (
    <Table.ScrollContainer minWidth={Math.max(520, slots.length * 128 + 52)} type="native">
      <Table withTableBorder withColumnBorders className={classes.board}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th className={classes.round}>Rd</Table.Th>
            {slots.map((s) => (
              <Table.Th key={s.slot} className={classes.head}>
                <Text size="xs" c="dimmed">
                  Pick {s.slot}
                </Text>
                <TeamLabel entities={entities} teamSeasonId={s.team} hideManager />
              </Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {Array.from({ length: rounds }, (_, r) => r + 1).map((round) => (
            <Table.Tr key={round}>
              <Table.Th className={classes.round}>{round}</Table.Th>
              {slots.map((s) => {
                const p = bySlotRound.get(`${round}:${s.slot}`);
                if (!p) return <Table.Td key={s.slot} className={classes.empty} />;
                const traded = p.teamSeasonId !== s.team;
                return (
                  <Table.Td
                    key={s.slot}
                    className={classes.cell}
                    data-pos={p.position ?? undefined}
                  >
                    <Text fz="sm" fw={600} lh={1.2}>
                      {p.player ?? "—"}
                    </Text>
                    <Group gap={4} wrap="nowrap">
                      {p.position && (
                        <Badge size="xs" variant="filled" color={POS_COLOR[p.position] ?? "gray"}>
                          {p.position}
                        </Badge>
                      )}
                      <Text fz="xs" c="dimmed">
                        {p.nflTeam ?? ""}
                      </Text>
                      {p.byeWeek !== null && (
                        <Text fz="xs" c="dimmed" title={`NFL bye week ${p.byeWeek}`}>
                          · Bye {p.byeWeek}
                        </Text>
                      )}
                      {p.isKeeper && (
                        <Badge size="xs" variant="outline">
                          keeper
                        </Badge>
                      )}
                    </Group>
                    {traded && (
                      <Text fz="xs" c="dimmed" lh={1.2}>
                        to{" "}
                        <TeamLabel
                          entities={entities}
                          teamSeasonId={p.teamSeasonId}
                          plain
                          hideManager
                        />
                      </Text>
                    )}
                  </Table.Td>
                );
              })}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

function AuctionList({ draft, entities }: { draft: Draft; entities: Drafts["entities"] }) {
  return (
    <Table.ScrollContainer minWidth={480} type="native">
      <Table withTableBorder className={classes.list} verticalSpacing={4}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th data-numeric="">#</Table.Th>
            <Table.Th>Player</Table.Th>
            <Table.Th>Team</Table.Th>
            <Table.Th data-numeric="">Price</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {draft.picks.map((p) => (
            <Table.Tr key={p.pickNo}>
              <Table.Td data-numeric="">{p.pickNo}</Table.Td>
              <Table.Td>
                {p.player ?? "—"}{" "}
                {p.position && (
                  <Badge size="xs" variant="light" color={POS_COLOR[p.position] ?? "gray"}>
                    {p.position}
                  </Badge>
                )}
              </Table.Td>
              <Table.Td>
                <TeamLabel entities={entities} teamSeasonId={p.teamSeasonId} />
              </Table.Td>
              <Table.Td data-numeric="">{p.amount === null ? "–" : fmtMoney(p.amount)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

function Body({ season }: { season: Season }) {
  const [search, setSearch] = useSearchParams();
  const q = useQuery(draftsQuery(season.id));
  if (q.isPending) return <Skeleton h={360} />;
  if (q.isError) return <QueryError error={q.error} onRetry={() => void q.refetch()} />;
  const drafts = q.data.drafts;
  if (drafts.length === 0) return <EmptyState>No draft on file for this season.</EmptyState>;
  const pickedId = Number(search.get("draft"));
  const draft = drafts.find((d) => d.id === pickedId) ?? drafts[0]!;
  return (
    <Stack>
      {drafts.length > 1 && (
        <SegmentedControl
          aria-label="Draft"
          w="fit-content"
          value={String(draft.id)}
          onChange={(v) =>
            setSearch((prev) => new URLSearchParams({ ...Object.fromEntries(prev), draft: v }), {
              replace: true,
              preventScrollReset: true,
            })
          }
          data={drafts.map((d) => ({ value: String(d.id), label: KIND[d.kind] ?? d.kind }))}
        />
      )}
      <Text size="sm" c="dimmed">
        {KIND[draft.kind] ?? draft.kind} · {draft.type} · {draft.picks.length} picks
        {draft.status !== "complete" ? ` · ${draft.status.replace("_", " ")}` : ""}
      </Text>
      {draft.picks.length === 0 ? (
        <EmptyState>The draft hasn't started.</EmptyState>
      ) : draft.type === "auction" ? (
        <AuctionList draft={draft} entities={q.data.entities} />
      ) : (
        <Board draft={draft} entities={q.data.entities} />
      )}
    </Stack>
  );
}

export default function DraftPage() {
  return (
    <SeasonShell title="Draft" needs="draft">
      {(season) => <Body season={season} />}
    </SeasonShell>
  );
}
