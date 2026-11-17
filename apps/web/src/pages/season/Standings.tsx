import {
  Badge,
  Group,
  NativeSelect,
  SegmentedControl,
  Skeleton,
  Stack,
  Table,
  Text,
  Tooltip,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { standingsQuery } from "../../api/queries";
import type { Season, Standings as StandingsData } from "../../api/schemas";
import { EmptyState, QueryError } from "../../components/QueryState";
import { TeamAvatar } from "../../components/TeamAvatar";
import { TeamLabel } from "../../components/TeamLabel";
import classes from "../../components/DataTable.module.css";
import { fmtDecimal, fmtPlayoffOdds, ordinal } from "../../lib/format";
import { SeasonShell } from "./SeasonShell";

const record = (r: { wins: number; losses: number; ties: number }) =>
  `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ""}`;

/** A chance while the regular season is on (clinched / eliminated when certain), what happened once it is over. */
function PlayoffsCell({
  odds,
  made,
}: {
  odds: NonNullable<StandingsData["playoffOdds"]>[string] | undefined;
  made: boolean | null;
}) {
  if (odds) {
    return (
      <Text
        span
        fw={odds.clinched ? 700 : undefined}
        c={odds.clinched ? "green" : odds.eliminated ? "dimmed" : undefined}
      >
        {odds.clinched && "✓ "}
        {odds.eliminated && "✗ "}
        {fmtPlayoffOdds(odds)}
      </Text>
    );
  }
  if (made === null) return <>–</>;
  return made ? (
    <Text span c="green" fw={600}>
      ✓ Made
    </Text>
  ) : (
    <Text span c="dimmed">
      ✗ Missed
    </Text>
  );
}

const ODDS_HELP =
  "Chance of making the playoffs, from simulating the rest of the season: each team's projected scores, the remaining schedule, and the tiebreakers (record, then points for). 100% means clinched and 0% means eliminated: certain either way.";

function StandingsTable({
  rows,
  data,
  season,
  showCutoff,
}: {
  rows: StandingsData["rows"];
  data: StandingsData;
  season: Season;
  showCutoff: boolean;
}) {
  const complete = season.status === "complete";
  const odds = data.playoffOdds;
  // Once the regular season is over the column shows what happened instead of a chance.
  const settled = complete || data.season.last_completed_week >= data.season.regular_season_weeks;
  const showPlayoffs = odds !== null || settled;
  return (
    <Table.ScrollContainer minWidth={560} type="native">
      <Table withTableBorder className={classes.table}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={44} data-numeric="">
              #
            </Table.Th>
            <Table.Th className={classes.sticky}>Team</Table.Th>
            <Table.Th data-numeric="">W-L</Table.Th>
            <Table.Th data-numeric="">PF</Table.Th>
            <Table.Th data-numeric="">PA</Table.Th>
            <Table.Th data-numeric="">GB</Table.Th>
            {showPlayoffs && (
              <Table.Th data-numeric="">
                <Tooltip
                  multiline
                  w={300}
                  label={odds !== null ? ODDS_HELP : "Whether the team made the playoffs."}
                >
                  <span>Playoffs</span>
                </Tooltip>
              </Table.Th>
            )}
            <Table.Th>{complete ? "Finish" : "Status"}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((r) => (
            <Table.Tr
              key={r.team_season_id}
              className={classes.row}
              data-cutoff={showCutoff && r.rank === season.playoffTeams ? "" : undefined}
            >
              <Table.Td data-numeric="">{r.rank}</Table.Td>
              <Table.Td className={classes.sticky}>
                <Group gap={8} wrap="nowrap">
                  <TeamAvatar
                    src={r.avatar}
                    name={data.entities.teamSeasons[String(r.team_season_id)]?.name}
                  />
                  <div>
                    <TeamLabel entities={data.entities} teamSeasonId={r.team_season_id} />
                  </div>
                </Group>
              </Table.Td>
              <Table.Td data-numeric="">{record(r)}</Table.Td>
              <Table.Td data-numeric="">{fmtDecimal(r.pf)}</Table.Td>
              <Table.Td data-numeric="">{fmtDecimal(r.pa)}</Table.Td>
              <Table.Td data-numeric="">
                {r.games_back ? fmtDecimal(r.games_back).replace(/\.00$/, "") : "–"}
              </Table.Td>
              {showPlayoffs && (
                <Table.Td data-numeric="">
                  <PlayoffsCell
                    odds={odds?.[String(r.team_season_id)]}
                    made={settled ? r.made_playoffs : null}
                  />
                </Table.Td>
              )}
              <Table.Td>
                {complete && r.final_place !== null ? (
                  <Text span fw={r.final_place <= 3 ? 700 : undefined}>
                    {ordinal(r.final_place)}
                  </Text>
                ) : r.clinched ? (
                  <Badge size="xs" variant="light" color="green">
                    {r.clinched}
                  </Badge>
                ) : r.eliminated ? (
                  <Badge size="xs" variant="light" color="gray">
                    eliminated
                  </Badge>
                ) : r.made_playoffs ? (
                  <Badge size="xs" variant="light">
                    playoffs
                  </Badge>
                ) : (
                  "–"
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

function Body({ season }: { season: Season }) {
  const [search, setSearch] = useSearchParams();
  const week = Number(search.get("week")) || undefined;
  const view = search.get("view") === "divisions" ? "divisions" : "overall";
  const q = useQuery(standingsQuery(season.id, week));
  const data = q.data;
  const set = (key: string, value: string | null) =>
    setSearch(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === null) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true, preventScrollReset: true }
    );

  if (q.isPending)
    return (
      <Stack>
        <Skeleton h={36} w={240} />
        <Skeleton h={320} />
      </Stack>
    );
  if (q.isError) return <QueryError error={q.error} onRetry={() => void q.refetch()} />;
  if (!data || data.rows.length === 0)
    return <EmptyState>No games have been played yet.</EmptyState>;

  const divisions = [
    ...new Set(data.rows.map((r) => r.division).filter((d): d is string => d !== null)),
  ].sort();
  return (
    <Stack>
      <Group align="flex-end" gap="md">
        <Stack gap={2}>
          <Text size="sm">Standings after</Text>
          <NativeSelect
            aria-label="Week"
            value={String(data.week)}
            onChange={(e) =>
              set("week", Number(e.target.value) === data.weeks.at(-1) ? null : e.target.value)
            }
            data={data.weeks.map((w) => ({ value: String(w), label: `Week ${w}` }))}
          />
        </Stack>
        {divisions.length >= 2 && (
          <Stack gap={2}>
            <Text size="sm">View</Text>
            <SegmentedControl
              aria-label="View"
              value={view}
              onChange={(v) => set("view", v === "overall" ? null : v)}
              data={[
                { value: "overall", label: "Overall" },
                { value: "divisions", label: "By division" },
              ]}
            />
          </Stack>
        )}
      </Group>
      {view === "divisions" && divisions.length >= 2 ? (
        divisions.map((d) => (
          <Stack key={d} gap={4}>
            <Text fw={600}>{d}</Text>
            <StandingsTable
              rows={data.rows.filter((r) => r.division === d)}
              data={data}
              season={season}
              showCutoff={false}
            />
          </Stack>
        ))
      ) : (
        <StandingsTable
          rows={data.rows}
          data={data}
          season={season}
          showCutoff={season.status !== "complete"}
        />
      )}
      <Text size="sm" c="dimmed">
        {season.medianEnabled && "Each week also counts a win or loss against the league median. "}
        The line marks the last playoff spot ({season.playoffTeams} teams).
        {data.playoffOdds !== null &&
          " Playoff odds simulate the rest of the schedule from projected scores; a team is only shown at 100% or 0% when that is certain."}
      </Text>
    </Stack>
  );
}

export default function Standings() {
  return <SeasonShell title="Standings">{(season) => <Body season={season} />}</SeasonShell>;
}
