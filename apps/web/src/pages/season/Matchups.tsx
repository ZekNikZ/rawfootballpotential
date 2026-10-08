import {
  ActionIcon,
  Avatar,
  Badge,
  Card,
  Collapse,
  Group,
  NativeSelect,
  Paper,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { CaretDown, CaretLeft, CaretRight } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router";
import { matchupsQuery } from "../../api/queries";
import type {
  Entities,
  LineupEntry,
  MatchupTeam,
  Matchups as MatchupsData,
  Season,
} from "../../api/schemas";
import { PositionBadge } from "../../components/PositionBadge";
import { EmptyState, QueryError } from "../../components/QueryState";
import { TeamLabel } from "../../components/TeamLabel";
import classes from "./Matchups.module.css";
import { fmtDecimal, irMissingNote } from "../../lib/format";
import { useLeague } from "../../lib/league-context";
import { SeasonShell } from "./SeasonShell";

type Game = MatchupsData["games"][number];

const GAME_LABEL: Record<string, string> = {
  playoffs: "Playoffs",
  toilet_bowl: "Toilet bowl",
  regular: "Regular season",
  none: "Doesn't count",
};

function gameBadges(g: Game) {
  const out: { label: string; color: string }[] = [];
  if (g.isChampionship) out.push({ label: "Championship", color: "yellow" });
  else if (g.gameType && g.gameType !== "regular")
    out.push({
      label: GAME_LABEL[g.gameType] ?? g.gameType,
      color: g.gameType === "toilet_bowl" ? "orange" : "blue",
    });
  if (g.spanWeeks > 1) out.push({ label: `${g.spanWeeks}-week game`, color: "violet" });
  if (g.placementAtStake && !g.isChampionship)
    out.push({
      label: `Plays for ${g.placementAtStake}${suffix(g.placementAtStake)}`,
      color: "gray",
    });
  return out;
}

const suffix = (n: number) =>
  n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");

function LineupTable({ team, entities }: { team: MatchupTeam; entities: Entities }) {
  const lineup = team.lineup ?? [];
  const groups: { title: string; rows: LineupEntry[] }[] = [
    { title: "Starters", rows: lineup.filter((l) => l.slotKind === "starter") },
    { title: "Bench", rows: lineup.filter((l) => l.slotKind === "bench") },
    {
      title: "IR / taxi",
      rows: lineup.filter((l) => l.slotKind === "ir" || l.slotKind === "taxi"),
    },
  ].filter((g) => g.rows.length > 0);
  return (
    <Stack gap={4}>
      <Text fw={600} truncate>
        <TeamLabel entities={entities} teamSeasonId={team.teamSeasonId} plain hideManager />
      </Text>
      {lineup.length === 0 ? (
        <Text size="sm" c="dimmed">
          No lineup data.
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={300} type="native">
          <Table className={classes.lineup} verticalSpacing={2}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={52}>Slot</Table.Th>
                <Table.Th>Player</Table.Th>
                <Table.Th data-numeric="">Pts</Table.Th>
                <Table.Th data-numeric="">Proj</Table.Th>
              </Table.Tr>
            </Table.Thead>
            {groups.map((g) => (
              <Table.Tbody key={g.title}>
                <Table.Tr className={classes.group}>
                  <Table.Td colSpan={4}>
                    {g.title}
                    {g.title === "Bench" && team.irUnrecorded > 0 ? "*" : ""} · {g.rows.length}
                  </Table.Td>
                </Table.Tr>
                {g.rows.map((l) => (
                  <Table.Tr
                    key={`${l.slot}-${l.playerId}`}
                    className={l.slotKind === "starter" ? undefined : classes.secondary}
                  >
                    <Table.Td c="dimmed">{l.slot === "BN" ? "BN" : l.slot}</Table.Td>
                    <Table.Td>
                      <Group gap={6} wrap="nowrap">
                        <PositionBadge position={l.position} />
                        <Text span>{l.name}</Text>
                        <Text span c="dimmed" fz="xs">
                          {l.nflTeam}
                        </Text>
                        {l.onBye && (
                          <Badge ml={4} size="xs" variant="light" color="gray">
                            bye
                          </Badge>
                        )}
                        {l.nflStatus && l.nflStatus.toUpperCase() !== "ACT" && !l.onBye && (
                          <Badge ml={4} size="xs" variant="light" color="red">
                            {l.nflStatus}
                          </Badge>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td data-numeric="">
                      {l.points === null ? "–" : fmtDecimal(l.points)}
                    </Table.Td>
                    <Table.Td data-numeric="" c="dimmed">
                      {l.projected === null ? "–" : fmtDecimal(l.projected)}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            ))}
          </Table>
        </Table.ScrollContainer>
      )}
      {team.irUnrecorded > 0 && (
        <Text size="xs" c="dimmed">
          * {irMissingNote(team.irUnrecorded)}
        </Text>
      )}
    </Stack>
  );
}

function Side({
  team,
  entities,
  right,
}: {
  team: MatchupTeam;
  entities: Entities;
  right: boolean;
}) {
  const ts = entities.teamSeasons[String(team.teamSeasonId)];
  const manager =
    ts?.managerId == null ? null : (entities.managers[String(ts.managerId)]?.name ?? null);
  const won = team.result === "W";
  const dim = team.result === "L" ? "dimmed" : undefined;
  const extra = [
    team.projected !== null ? `proj ${fmtDecimal(team.projected)}` : null,
    team.pointsOverridden ? "adjusted" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const avatar = (
    <Avatar
      src={team.avatar}
      name={ts?.name}
      color="initials"
      radius="sm"
      size={40}
      className={classes.avatar}
    />
  );
  const names = (
    <Stack gap={0} miw={0} flex={1} ta={right ? "right" : "left"}>
      <Text fw={won ? 700 : 600} c={dim} truncate>
        {ts?.name ?? "Unknown team"}
      </Text>
      <Text size="xs" c="dimmed" truncate>
        {manager ?? " "}
      </Text>
    </Stack>
  );
  const score = (
    <Stack gap={0} className={classes.score} ta={right ? "left" : "right"}>
      <Text fw={won ? 700 : 600} fz="xl" lh={1.2} c={dim}>
        {fmtDecimal(team.points)}
      </Text>
      <Text size="xs" c="dimmed">
        {extra || " "}
      </Text>
    </Stack>
  );
  return (
    <Group wrap="nowrap" gap="sm" miw={0} align="center">
      {right ? (
        <>
          {score}
          {names}
          {avatar}
        </>
      ) : (
        <>
          {avatar}
          {names}
          {score}
        </>
      )}
    </Group>
  );
}

function GameCard({ game, entities }: { game: Game; entities: Entities }) {
  const [open, { toggle }] = useDisclosure(false);
  const badges = gameBadges(game);
  const tie = game.teams.length === 2 && game.teams[0]?.result === "T";
  const [home, away] = game.teams;
  return (
    <Card withBorder radius="sm" padding={0}>
      <UnstyledButton
        onClick={toggle}
        aria-expanded={open}
        aria-label={open ? "Hide lineups" : "Show lineups"}
        className={classes.head}
      >
        <Stack gap={6}>
          {(badges.length > 0 || tie) && (
            <Group gap={6}>
              {badges.map((b) => (
                <Badge key={b.label} size="xs" variant="light" color={b.color}>
                  {b.label}
                </Badge>
              ))}
              {tie && (
                <Badge size="xs" variant="light" color="gray">
                  Tied
                </Badge>
              )}
            </Group>
          )}
          <div className={classes.versus}>
            {home && <Side team={home} entities={entities} right={false} />}
            {away ? <Side team={away} entities={entities} right /> : <div />}
          </div>
        </Stack>
        <CaretDown size={16} className={classes.caret} data-open={open ? "" : undefined} />
      </UnstyledButton>
      <Collapse expanded={open}>
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md" p="sm" className={classes.lineups}>
          {game.teams.map((t) => (
            <LineupTable key={t.teamSeasonId} team={t} entities={entities} />
          ))}
        </SimpleGrid>
      </Collapse>
    </Card>
  );
}

function WeekPicker({ season, week, current }: { season: Season; week: number; current: number }) {
  const navigate = useNavigate();
  const { league } = useLeague();
  const go = (w: number) => navigate(`/${league.slug}/${season.year}/matchups/${w}`);
  const weeks = Array.from({ length: season.lastWeek }, (_, i) => i + 1);
  return (
    <Group gap="xs" align="center">
      <ActionIcon
        variant="default"
        size="lg"
        aria-label="Previous week"
        disabled={week <= 1}
        onClick={() => go(week - 1)}
      >
        <CaretLeft size={18} />
      </ActionIcon>
      <NativeSelect
        aria-label="Week"
        value={String(week)}
        onChange={(e) => go(Number(e.target.value))}
        data={weeks.map((w) => ({
          value: String(w),
          label: `Week ${w}${season.playoffWeekStart !== null && w >= season.playoffWeekStart ? " · playoffs" : ""}${w === current ? " (current)" : ""}`,
        }))}
      />
      <ActionIcon
        variant="default"
        size="lg"
        aria-label="Next week"
        disabled={week >= season.lastWeek}
        onClick={() => go(week + 1)}
      >
        <CaretRight size={18} />
      </ActionIcon>
    </Group>
  );
}

function Body({ season }: { season: Season }) {
  const weekParam = Number(useParams().week) || undefined;
  const q = useQuery({
    ...matchupsQuery(season.id, weekParam, true),
    // Scores move while games are on; the worker updates them every few minutes.
    refetchInterval: (query) => (query.state.data?.weekStatus === "in_progress" ? 30_000 : false),
  });
  const data = q.data;
  if (q.isPending)
    return (
      <Stack>
        <Skeleton h={36} w={260} />
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} h={120} />
          ))}
        </SimpleGrid>
      </Stack>
    );
  if (q.isError && !data) return <QueryError error={q.error} onRetry={() => void q.refetch()} />;
  if (!data) return null;
  const current = Math.max(1, Math.min(season.lastWeek, (season.lastCompletedWeek ?? 0) + 1));
  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <WeekPicker
          season={season}
          week={data.week}
          current={season.status === "complete" ? season.lastWeek : current}
        />
        <Badge
          variant="light"
          color={
            data.weekStatus === "in_progress"
              ? "green"
              : data.weekStatus === "complete"
                ? "gray"
                : "blue"
          }
        >
          {data.weekStatus === "in_progress"
            ? "live"
            : data.weekStatus === "complete"
              ? "final"
              : "upcoming"}
        </Badge>
      </Group>
      {data.games.length === 0 ? (
        <EmptyState>No games this week.</EmptyState>
      ) : (
        <Stack gap="sm">
          {data.games.map((g) => (
            <GameCard key={g.matchupId} game={g} entities={data.entities} />
          ))}
        </Stack>
      )}
      {data.idle.length > 0 && (
        <Paper withBorder p="sm" radius="sm">
          <Text fw={600} size="sm" mb={4}>
            Not playing this week
          </Text>
          <Stack gap={2}>
            {data.idle.map((t) => (
              <Text key={t.teamSeasonId} size="sm" c="dimmed">
                <TeamLabel entities={data.entities} teamSeasonId={t.teamSeasonId} />
                {t.points ? ` · scored ${fmtDecimal(t.points)} (doesn't count)` : ""}
              </Text>
            ))}
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}

export default function Matchups() {
  return <SeasonShell title="Matchups">{(season) => <Body season={season} />}</SeasonShell>;
}
