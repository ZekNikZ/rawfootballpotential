import {
  Anchor,
  Avatar,
  Badge,
  Group,
  Paper,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router";
import { franchiseQuery, wrappedQuery } from "../api/queries";
import type { Wrapped as WrappedData } from "../api/schemas";
import { HighlightTile } from "../components/Highlights";
import { QueryError } from "../components/QueryState";
import { SegmentedOrSelect } from "../components/records/filters";
import { numberText } from "../components/records/cells";
import { fmtDecimal, fmtInt, fmtPct1, ordinal, seasonLabel } from "../lib/format";
import { useLeague } from "../lib/league-context";
import { usePageTitle } from "../lib/page-title";

type Line = NonNullable<WrappedData["weeks"]["best"]>;

function Slide({
  title,
  emoji,
  children,
}: {
  title: string;
  emoji: string;
  children: React.ReactNode;
}) {
  return (
    <Stack gap="sm" component="section" aria-label={title}>
      <Title order={2}>
        <Text span inherit mr={8}>
          {emoji}
        </Text>
        {title}
      </Title>
      {children}
    </Stack>
  );
}

function Big({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string | null | undefined;
  accent?: boolean;
}) {
  return (
    <Paper
      withBorder
      radius="sm"
      p="md"
      style={accent ? { borderColor: "var(--mantine-color-yellow-5)" } : undefined}
    >
      <Text size="xs" c="dimmed" tt="uppercase" fw={700} lh={1.2}>
        {label}
      </Text>
      <Text fz={32} fw={800} lh={1.15} mt={4} style={{ fontVariantNumeric: "tabular-nums" }}>
        {value}
      </Text>
      {sub && (
        <Text size="sm" c="dimmed" mt={2}>
          {sub}
        </Text>
      )}
    </Paper>
  );
}

const lineSub = (l: Line) =>
  `WK ${l.week}${l.opponent ? ` vs ${l.opponent}` : ""}${l.opponentPoints !== null ? ` (${fmtDecimal(l.opponentPoints)})` : ""}`;

function finishText(d: WrappedData): { value: string; sub: string | null; champion: boolean } {
  const { finalPlace, teams, madePlayoffs, seed } = d.summary;
  const seedText = seed === null ? null : `${ordinal(seed)} seed`;
  if (d.inProgress) return { value: "In progress", sub: seedText, champion: false };
  if (finalPlace === null)
    return { value: madePlayoffs ? "Playoffs" : "Missed", sub: seedText, champion: false };
  return {
    value:
      finalPlace === 1
        ? "🏆 Champion"
        : finalPlace === 2
          ? "🥈 Runner-up"
          : finalPlace === 3
            ? "🥉 Third"
            : finalPlace === teams
              ? "💩 Last place"
              : ordinal(finalPlace),
    sub: [`of ${teams} teams`, seedText].filter(Boolean).join(" · "),
    champion: finalPlace === 1,
  };
}

function placeChange(d: WrappedData): string | null {
  const prev = d.summary.previous;
  const now = d.summary.finalPlace;
  if (!prev || prev.place === null || now === null) return null;
  const delta = prev.place - now;
  if (delta === 0) return `Same finish as ${prev.season} (${ordinal(prev.place)})`;
  return `${delta > 0 ? "Up" : "Down"} ${Math.abs(delta)} from ${ordinal(prev.place)} in ${prev.season}`;
}

export default function Wrapped() {
  const { league, latestSeason } = useLeague();
  const franchise = Number(useParams().franchise);
  const [search, setSearch] = useSearchParams();
  const profile = useQuery({ ...franchiseQuery(league.slug, franchise), enabled: franchise > 0 });
  const seasons = profile.data?.seasons.map((s) => s.season) ?? [];
  const picked = Number(search.get("season"));
  const year = seasons.includes(picked) ? picked : (seasons.at(-1) ?? latestSeason.year);
  const q = useQuery({
    ...wrappedQuery(league.slug, franchise, year),
    enabled: franchise > 0 && profile.isSuccess,
  });
  const d = q.data;
  usePageTitle(d ? `${d.team.manager ?? d.team.team} · ${seasonLabel(d.season)} Wrapped` : null);

  if (profile.isError) return <QueryError error={profile.error} />;
  if (profile.isPending || q.isPending)
    return (
      <Stack gap="lg">
        <Skeleton h={80} />
        <Skeleton h={160} />
        <Skeleton h={160} />
      </Stack>
    );
  if (q.isError) return <QueryError error={q.error} onRetry={() => void q.refetch()} />;
  if (!d) return null;

  const finish = finishText(d);
  const change = placeChange(d);
  const s = d.summary;
  const diff = s.pf - s.pa;
  const games = d.weeks.games;

  return (
    <Stack gap={36}>
      <Stack gap="md">
        <Group wrap="nowrap" gap="md">
          <Avatar
            src={d.team.avatar ?? undefined}
            name={d.team.team}
            color="initials"
            radius="md"
            size={72}
          />
          <Stack gap={2} miw={0}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
              Manager Wrapped · {seasonLabel(d.season)}
            </Text>
            <Title order={1}>{d.team.manager ?? d.team.team}</Title>
            <Anchor component={Link} to={`/${league.slug}/franchises/${franchise}`} c="dimmed">
              {d.team.team}
            </Anchor>
          </Stack>
        </Group>
        <SegmentedOrSelect
          label="Season"
          value={String(year)}
          options={[...seasons].reverse().map((y) => ({ value: String(y), label: String(y) }))}
          onChange={(v) =>
            setSearch(
              (prev) => {
                const next = new URLSearchParams(prev);
                next.set("season", v);
                return next;
              },
              { replace: true }
            )
          }
        />
        {d.inProgress && (
          <Badge variant="light" color="orange" style={{ alignSelf: "flex-start" }}>
            Season in progress: numbers are through the latest finished week
          </Badge>
        )}
      </Stack>

      <Slide title="The year" emoji="📖">
        <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} spacing="sm">
          <Big
            label="Record"
            value={`${s.wins}-${s.losses}${s.ties ? `-${s.ties}` : ""}`}
            sub="Head-to-head and median games"
          />
          <Big
            label="Finish"
            value={finish.value}
            sub={[finish.sub, change].filter(Boolean).join(" · ")}
            accent={finish.champion}
          />
          <Big
            label="Points scored"
            value={fmtDecimal(s.pf)}
            sub={`${fmtDecimal(s.pa)} against (${diff >= 0 ? "+" : ""}${fmtDecimal(diff)})`}
          />
          <Big
            label="Average week"
            value={d.weeks.average === null ? "–" : fmtDecimal(d.weeks.average)}
            sub={
              games
                ? `${games} games${d.weeks.topScorerWeeks ? ` · top scorer ${d.weeks.topScorerWeeks}×` : ""}`
                : null
            }
          />
        </SimpleGrid>
      </Slide>

      {(d.weeks.best || d.weeks.worst) && (
        <Slide title="Highs and lows" emoji="🎢">
          <SimpleGrid cols={{ base: 1, xs: 2, md: 3 }} spacing="sm">
            {d.weeks.best && (
              <Big
                label="Best week"
                value={fmtDecimal(d.weeks.best.points)}
                sub={lineSub(d.weeks.best)}
              />
            )}
            {d.weeks.worst && (
              <Big
                label="Worst week"
                value={fmtDecimal(d.weeks.worst.points)}
                sub={lineSub(d.weeks.worst)}
              />
            )}
            {d.weeks.biggestWin && (
              <Big
                label="Biggest win"
                value={`+${fmtDecimal(d.weeks.biggestWin.points - (d.weeks.biggestWin.opponentPoints ?? 0))}`}
                sub={lineSub(d.weeks.biggestWin)}
              />
            )}
            {d.weeks.closestWin && (
              <Big
                label="Closest win"
                value={`+${fmtDecimal(d.weeks.closestWin.points - (d.weeks.closestWin.opponentPoints ?? 0))}`}
                sub={lineSub(d.weeks.closestWin)}
              />
            )}
            {d.weeks.toughestLoss && (
              <Big
                label="Toughest loss"
                value={fmtDecimal(
                  d.weeks.toughestLoss.points - (d.weeks.toughestLoss.opponentPoints ?? 0)
                )}
                sub={lineSub(d.weeks.toughestLoss)}
              />
            )}
          </SimpleGrid>
        </Slide>
      )}

      {d.ranks.length > 0 && (
        <Slide title="Where you ranked" emoji="📊">
          <SimpleGrid cols={{ base: 1, xs: 2, md: 3 }} spacing="sm">
            {d.ranks.map((r) => (
              <Big
                key={r.key}
                label={r.label}
                value={`${ordinal(r.rank)} of ${r.of}`}
                sub={numberText({ type: r.valueType === "pct" ? "pct" : "decimal" }, r.value)}
                accent={r.rank === 1}
              />
            ))}
          </SimpleGrid>
          <Text size="xs" c="dimmed">
            Luck is wins above what the all-play record predicts. Strength of schedule ranks the
            toughest schedule first. Score swings rank the most volatile team first.
          </Text>
        </Slide>
      )}

      {d.lineup.averageIq !== null && (
        <Slide title="Lineup decisions" emoji="🧠">
          <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} spacing="sm">
            <Big
              label="Average lineup IQ"
              value={fmtPct1(d.lineup.averageIq)}
              sub="Share of the best possible lineup"
            />
            <Big label="Perfect lineups" value={fmtInt(d.lineup.perfectWeeks)} />
            {d.lineup.pointsLeft !== null && (
              <Big
                label="Points left on the bench"
                value={fmtDecimal(d.lineup.pointsLeft)}
                sub="Best lineup minus actual"
              />
            )}
            {d.lineup.costliest && d.lineup.costliest.left !== null && (
              <Big
                label="Costliest mistake"
                value={fmtDecimal(d.lineup.costliest.left)}
                sub={`${lineSub(d.lineup.costliest)}${d.lineup.costliest.result ? ` · ${d.lineup.costliest.result}` : ""}`}
              />
            )}
          </SimpleGrid>
        </Slide>
      )}

      {(d.players.top.length > 0 || d.players.bestGame) && (
        <Slide title="The players" emoji="🏈">
          <SimpleGrid cols={{ base: 1, xs: 2, md: 3 }} spacing="sm">
            {d.players.top.map((p, i) => (
              <Big
                key={p.name}
                label={i === 0 ? "Team MVP" : `#${i + 1} producer`}
                value={p.name}
                sub={`${fmtDecimal(p.points)} points as a starter · ${p.starts} starts${p.position ? ` · ${p.position}` : ""}`}
                accent={i === 0}
              />
            ))}
            {d.players.bestGame && (
              <Big
                label="Biggest single game"
                value={`${fmtDecimal(d.players.bestGame.points)}`}
                sub={`${d.players.bestGame.name} · WK ${d.players.bestGame.week}`}
              />
            )}
            {d.players.benchRegret && (
              <Big
                label="The one on the bench"
                value={`${fmtDecimal(d.players.benchRegret.points)}`}
                sub={`${d.players.benchRegret.name} · WK ${d.players.benchRegret.week}`}
              />
            )}
          </SimpleGrid>
        </Slide>
      )}

      <Slide title="The moves" emoji="🔁">
        <SimpleGrid cols={{ base: 1, xs: 3 }} spacing="sm">
          <Big label="Trades" value={fmtInt(d.moves.trades)} />
          <Big label="Waiver claims" value={fmtInt(d.moves.claims)} />
          {d.moves.faabSpent > 0 && (
            <Big label="FAAB spent" value={`$${fmtInt(d.moves.faabSpent)}`} />
          )}
        </SimpleGrid>
        {d.moves.highlights.length > 0 && (
          <SimpleGrid cols={{ base: 1, xs: 2, md: 3 }} spacing="sm">
            {d.moves.highlights.map((h) => (
              <HighlightTile key={`${h.recordId}-${h.week}`} h={h} />
            ))}
          </SimpleGrid>
        )}
      </Slide>

      {d.opponents.length > 0 && (
        <Slide title="Head to head" emoji="🥊">
          <Table.ScrollContainer minWidth={420} type="native">
            <Table withTableBorder verticalSpacing={6}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Opponent</Table.Th>
                  <Table.Th ta="right">Result</Table.Th>
                  <Table.Th ta="right">Points</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {d.opponents.map((o) => (
                  <Table.Tr key={o.team.teamSeasonId}>
                    <Table.Td>
                      <Anchor
                        component={Link}
                        to={`/${league.slug}/compare?a=${franchise}&b=${o.team.franchiseId}`}
                      >
                        {o.team.team}
                      </Anchor>
                      {o.team.manager && (
                        <Text span c="dimmed" fz="sm">
                          {" "}
                          ({o.team.manager})
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td ta="right">
                      {o.wins}-{o.losses}
                      {o.ties ? `-${o.ties}` : ""}
                    </Table.Td>
                    <Table.Td ta="right">
                      {fmtDecimal(o.pointsFor)} – {fmtDecimal(o.pointsAgainst)}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Slide>
      )}
    </Stack>
  );
}
