import { Button, Group, Paper, SimpleGrid, Skeleton, Stack, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { recapQuery, standingsQuery } from "../../api/queries";
import type { Recap } from "../../api/schemas";
import { fmtDecimal, fmtInt, ordinal, seasonLabel } from "../../lib/format";
import { useLeague } from "../../lib/league-context";
import { HighlightTile, TeamLink } from "../Highlights";
import { QueryError } from "../QueryState";
import { TeamAvatar } from "../TeamAvatar";
import { FinalResults } from "./Snapshot";

function TitleGame({ recap }: { recap: Recap }) {
  const c = recap.championship;
  if (!c) return null;
  return (
    <Paper withBorder radius="sm" p="md" style={{ borderColor: "var(--mantine-color-yellow-5)" }}>
      <Group gap="md" wrap="nowrap" align="center">
        <TeamAvatar src={c.winner.avatar} name={c.winner.team} size={56} />
        <Stack gap={2} miw={0}>
          <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
            🏆 The title game · week {c.week}
          </Text>
          <Text fz="lg" lh={1.3}>
            <TeamLink
              franchiseId={c.winner.franchiseId}
              team={c.winner.team}
              manager={c.winner.manager}
            />{" "}
            beat{" "}
            {c.loser ? (
              <TeamLink
                franchiseId={c.loser.franchiseId}
                team={c.loser.team}
                manager={c.loser.manager}
              />
            ) : (
              "the field"
            )}{" "}
            <Text span fw={800}>
              {fmtDecimal(c.winnerPoints)} – {fmtDecimal(c.loserPoints)}
            </Text>
          </Text>
        </Stack>
      </Group>
    </Paper>
  );
}

function Mover({ title, m }: { title: string; m: Recap["mostImproved"] }) {
  if (!m) return null;
  return (
    <Paper withBorder radius="sm" p="sm">
      <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
        {title}
      </Text>
      <Group gap="sm" mt="xs" wrap="nowrap">
        <TeamAvatar src={m.team.avatar} name={m.team.team} size={44} />
        <Stack gap={0} miw={0}>
          <TeamLink franchiseId={m.team.franchiseId} team={m.team.team} manager={m.team.manager} />
          <Text size="sm" c="dimmed">
            {ordinal(m.from)} → {ordinal(m.to)} place
          </Text>
        </Stack>
      </Group>
    </Paper>
  );
}

function Wrapped({ seasonId, year }: { seasonId: number; year: number }) {
  const { league } = useLeague();
  const q = useQuery(standingsQuery(seasonId));
  const rows = q.data?.rows ?? [];
  if (rows.length === 0) return null;
  const name = (id: number | null) =>
    id === null ? "?" : (q.data?.entities.teamSeasons[String(id)]?.name ?? "?");
  const manager = (id: number | null) => {
    const ts = id === null ? undefined : q.data?.entities.teamSeasons[String(id)];
    return ts?.managerId == null
      ? null
      : (q.data?.entities.managers[String(ts.managerId)]?.name ?? null);
  };
  return (
    <Stack gap="xs" component="section" aria-labelledby="h-wrapped">
      <Title order={2} id="h-wrapped">
        Manager Wrapped
      </Title>
      <Text c="dimmed" size="sm">
        A year in review for each manager: record, best and worst weeks, luck, lineup decisions, and
        the players who carried them.
      </Text>
      <Group gap="xs">
        {[...rows]
          .sort((a, b) => (a.final_place ?? 99) - (b.final_place ?? 99))
          .map((r) => (
            <Button
              key={r.team_season_id}
              component={Link}
              to={`/${league.slug}/franchises/${r.franchise_id}/wrapped?season=${year}`}
              variant="light"
              size="compact-sm"
              title={name(r.team_season_id)}
            >
              {manager(r.team_season_id) ?? name(r.team_season_id)}
            </Button>
          ))}
      </Group>
    </Stack>
  );
}

/** Home page of a finished season: final results, the title game, awards, movers, records set, totals. */
export function SeasonRecap({ seasonId, year }: { seasonId: number; year: number }) {
  const q = useQuery(recapQuery(seasonId));
  const d = q.data;
  return (
    <Stack gap={40}>
      <FinalResults seasonId={seasonId} year={year} />
      {q.isPending && (
        <Stack gap="sm">
          <Skeleton h={28} w="30%" />
          <SimpleGrid cols={{ base: 1, xs: 2, md: 3 }} spacing="sm">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} h={130} />
            ))}
          </SimpleGrid>
        </Stack>
      )}
      {q.isError && <QueryError error={q.error} onRetry={() => void q.refetch()} />}
      {d && (
        <>
          <Stack gap="sm" component="section" aria-labelledby="h-recap">
            <Title order={2} id="h-recap">
              {seasonLabel(year)} season recap
            </Title>
            <TitleGame recap={d} />
            {d.totals.games > 0 && (
              <Text c="dimmed" size="sm">
                {fmtInt(d.totals.games)} games
                {d.totals.averageScore !== null &&
                  ` · ${fmtDecimal(d.totals.averageScore)} points per team per week`}
                {d.totals.totalPoints !== null &&
                  ` · ${fmtInt(d.totals.totalPoints)} points scored`}
                {` · ${fmtInt(d.totals.trades)} trades · ${fmtInt(d.totals.claims)} waiver claims`}
              </Text>
            )}
          </Stack>

          {d.awards.length > 0 && (
            <Stack gap="sm" component="section" aria-labelledby="h-awards">
              <Title order={2} id="h-awards">
                Season awards
              </Title>
              <SimpleGrid cols={{ base: 1, xs: 2, md: 3 }} spacing="sm">
                {d.awards.map((h) => (
                  <HighlightTile key={`${h.recordId}-${h.label}`} h={h} />
                ))}
              </SimpleGrid>
              {(d.mostImproved || d.biggestFall) && (
                <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="sm">
                  <Mover title="Most improved (final place)" m={d.mostImproved} />
                  <Mover title="Biggest fall (final place)" m={d.biggestFall} />
                </SimpleGrid>
              )}
            </Stack>
          )}

          {d.recordsSet.length > 0 && (
            <Stack gap="sm" component="section" aria-labelledby="h-records-set">
              <Title order={2} id="h-records-set">
                League records set this season
              </Title>
              <Text c="dimmed" size="sm">
                Single-game marks from this season that rank in the league's all-time top three.
              </Text>
              <SimpleGrid cols={{ base: 1, xs: 2, md: 3 }} spacing="sm">
                {d.recordsSet.map((h) => (
                  <HighlightTile
                    key={`${h.recordId}-${h.label}-${h.teamSeasonId}-${h.week}-${h.player}`}
                    h={h}
                    showRank
                  />
                ))}
              </SimpleGrid>
            </Stack>
          )}
        </>
      )}
      <Wrapped seasonId={seasonId} year={year} />
    </Stack>
  );
}
