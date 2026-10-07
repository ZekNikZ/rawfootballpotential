import { Anchor, Group, Pagination, Skeleton, Stack, Table, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { trophiesQuery } from "../api/queries";
import type { Entities, Trophy, TrophyType } from "../api/schemas";
import { EmptyState, QueryError } from "../components/QueryState";
import { SegmentedOrSelect } from "../components/records/filters";
import { fmtDecimal, fmtInt, fmtPct } from "../lib/format";
import { useLeague } from "../lib/league-context";
import classes from "./Trophies.module.css";

interface Ctx {
  leagueSlug: string;
  entities: Entities;
}

/** "Team (Manager)" for the team a trophy was won with that season. */
function TeamLabel({ ctx, trophy }: { ctx: Ctx; trophy: Trophy }) {
  const ts = ctx.entities.teamSeasons[String(trophy.teamSeasonId)];
  const manager =
    trophy.managerId === null ? null : ctx.entities.managers[String(trophy.managerId)]?.name;
  return (
    <Group gap={6} wrap="nowrap" align="baseline">
      <Anchor component={Link} to={`/${ctx.leagueSlug}/franchises/${trophy.franchiseId}`}>
        {ts?.name ?? "Unknown team"}
      </Anchor>
      {manager && (
        <Text span c="dimmed" fz="sm">
          ({manager})
        </Text>
      )}
    </Group>
  );
}

/** A franchise's current manager (the label used when a row isn't tied to one season). */
function currentManager(entities: Entities, franchiseId: number) {
  const f = entities.franchises[String(franchiseId)];
  const manager = f?.managerId == null ? null : entities.managers[String(f.managerId)]?.name;
  return { manager: manager ?? "Unknown", team: f?.teamName ?? null };
}

const byType = (trophies: Trophy[], type: TrophyType) => trophies.filter((t) => t.type === type);

function Podium({ trophies, ctx }: { trophies: Trophy[]; ctx: Ctx }) {
  const placements = byType(trophies, "placement");
  const seasons = [...new Set(placements.map((t) => t.season))].sort((a, b) => b - a);
  return (
    <Stack gap={10}>
      <Title order={2}>Champions & Podiums</Title>
      <Table.ScrollContainer minWidth={640} type="native">
        <Table withTableBorder className={classes.table}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th className={classes.sticky}>Season</Table.Th>
              <Table.Th>🥇 Champion</Table.Th>
              <Table.Th>🥈 Runner-up</Table.Th>
              <Table.Th>🥉 Third</Table.Th>
              <Table.Th>💩 Last place</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {seasons.map((season) => {
              const rows = placements.filter((t) => t.season === season);
              const last = Math.max(...rows.map((t) => t.value));
              const at = (place: number) => rows.filter((t) => t.value === place);
              return (
                <Table.Tr key={season} className={classes.row}>
                  <Table.Td className={classes.sticky}>{season}</Table.Td>
                  {[at(1), at(2), at(3), last > 3 ? at(last) : []].map((ts, i) => (
                    <Table.Td key={i}>
                      {ts.length === 0
                        ? "–"
                        : ts.map((t) => <TeamLabel key={t.teamSeasonId} ctx={ctx} trophy={t} />)}
                    </Table.Td>
                  ))}
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}

function Cabinet({ trophies, ctx }: { trophies: Trophy[]; ctx: Ctx }) {
  const rows = useMemo(() => {
    const by = new Map<
      number,
      {
        franchiseId: number;
        gold: number;
        silver: number;
        bronze: number;
        last: number;
        high: number;
        bench: number;
        smart: number;
        awards: number;
      }
    >();
    const lastPlace = new Map<number, number>();
    for (const t of byType(trophies, "placement"))
      lastPlace.set(t.season, Math.max(lastPlace.get(t.season) ?? 0, t.value));
    for (const t of trophies) {
      const r = by.get(t.franchiseId) ?? {
        franchiseId: t.franchiseId,
        gold: 0,
        silver: 0,
        bronze: 0,
        last: 0,
        high: 0,
        bench: 0,
        smart: 0,
        awards: 0,
      };
      by.set(t.franchiseId, r);
      if (t.type === "placement") {
        if (t.value === 1) r.gold++;
        else if (t.value === 2) r.silver++;
        else if (t.value === 3) r.bronze++;
        else if (t.value === lastPlace.get(t.season)) r.last++;
      } else if (t.type === "high-scorer-club") r.high++;
      else if (t.type === "benchwarmer-club") r.bench++;
      else if (t.type === "smartypants-club") r.smart++;
      else if (t.type !== "season-high-iq") r.awards++;
    }
    return [...by.values()].sort(
      (a, b) => b.gold - a.gold || b.silver - a.silver || b.bronze - a.bronze || a.last - b.last
    );
  }, [trophies]);
  const head = [
    "🥇",
    "🥈",
    "🥉",
    "💩",
    "High Scorer's",
    "Benchwarmer's",
    "Smartypants",
    "Season awards",
  ];
  return (
    <Stack gap={10}>
      <Title order={2}>Trophy Cabinet</Title>
      <Table.ScrollContainer minWidth={640} type="native">
        <Table withTableBorder className={classes.table}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th className={classes.sticky}>Manager</Table.Th>
              {head.map((h) => (
                <Table.Th key={h} data-numeric="">
                  {h}
                </Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((r) => {
              const who = currentManager(ctx.entities, r.franchiseId);
              return (
                <Table.Tr key={r.franchiseId} className={classes.row}>
                  <Table.Td className={classes.sticky}>
                    <Anchor component={Link} to={`/${ctx.leagueSlug}/franchises/${r.franchiseId}`}>
                      {who.manager}
                    </Anchor>
                  </Table.Td>
                  {[r.gold, r.silver, r.bronze, r.last, r.high, r.bench, r.smart, r.awards].map(
                    (n, i) => (
                      <Table.Td key={i} data-numeric="">
                        {n || "–"}
                      </Table.Td>
                    )
                  )}
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}

const PAGE = 10;

function Club({
  title,
  blurb,
  trophies,
  ctx,
  format,
}: {
  title: string;
  blurb: string;
  trophies: Trophy[];
  ctx: Ctx;
  format: (t: Trophy) => string;
}) {
  const [page, setPage] = useState(1);
  const sorted = [...trophies].sort((a, b) => b.season - a.season || (b.week ?? 0) - (a.week ?? 0));
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE));
  return (
    <Stack gap={10}>
      <Title order={2}>{title}</Title>
      <Text size="sm" c="dimmed">
        {blurb}
      </Text>
      {sorted.length === 0 ? (
        <EmptyState>Nobody yet.</EmptyState>
      ) : (
        <>
          <Table.ScrollContainer minWidth={520} type="native">
            <Table withTableBorder className={classes.table}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th className={classes.sticky}>Team</Table.Th>
                  <Table.Th>Week</Table.Th>
                  <Table.Th data-numeric="">Score</Table.Th>
                  <Table.Th>Opponent</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {sorted.slice((page - 1) * PAGE, page * PAGE).map((t) => {
                  const opp =
                    t.opponentTeamSeasonId === null
                      ? null
                      : ctx.entities.teamSeasons[String(t.opponentTeamSeasonId)];
                  const oppManager =
                    t.opponentManagerId === null
                      ? null
                      : ctx.entities.managers[String(t.opponentManagerId)]?.name;
                  return (
                    <Table.Tr key={`${t.teamSeasonId}-${t.week}`} className={classes.row}>
                      <Table.Td className={classes.sticky}>
                        <TeamLabel ctx={ctx} trophy={t} />
                      </Table.Td>
                      <Table.Td>
                        {t.season} WK {t.week}
                      </Table.Td>
                      <Table.Td data-numeric="">{format(t)}</Table.Td>
                      <Table.Td>
                        {opp ? (
                          <>
                            {opp.name}
                            {oppManager && (
                              <Text span c="dimmed" fz="sm">
                                {" "}
                                ({oppManager})
                              </Text>
                            )}
                          </>
                        ) : (
                          "–"
                        )}
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {pages > 1 && <Pagination total={pages} value={page} onChange={setPage} size="sm" />}
        </>
      )}
    </Stack>
  );
}

const AWARDS: { type: TrophyType; title: string; format: (t: Trophy) => string }[] = [
  { type: "season-high-score", title: "High score", format: (t) => fmtDecimal(t.value) },
  {
    type: "season-largest-blowout",
    title: "Biggest blowout",
    format: (t) => `Δ ${fmtDecimal(t.value)}`,
  },
  {
    type: "season-narrowest-win",
    title: "Narrowest win",
    format: (t) => `Δ ${fmtDecimal(t.value)}`,
  },
  { type: "season-points-for", title: "Most points for", format: (t) => fmtDecimal(t.value) },
  {
    type: "season-points-against",
    title: "Most points against",
    format: (t) => fmtDecimal(t.value),
  },
];

function SeasonAwards({ trophies, ctx }: { trophies: Trophy[]; ctx: Ctx }) {
  const seasons = [...new Set(trophies.map((t) => t.season))].sort((a, b) => b - a);
  return (
    <Stack gap={10}>
      <Title order={2}>Season Awards</Title>
      <Table.ScrollContainer minWidth={760} type="native">
        <Table withTableBorder className={classes.table}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th className={classes.sticky}>Season</Table.Th>
              {AWARDS.map((a) => (
                <Table.Th key={a.type}>{a.title}</Table.Th>
              ))}
              <Table.Th>Lineup IQ</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {seasons.map((season) => {
              const iq = trophies.filter((t) => t.season === season && t.type === "season-high-iq");
              return (
                <Table.Tr key={season} className={classes.row}>
                  <Table.Td className={classes.sticky}>{season}</Table.Td>
                  {AWARDS.map((a) => (
                    <Table.Td key={a.type}>
                      {trophies
                        .filter((t) => t.season === season && t.type === a.type)
                        .map((t) => (
                          <Stack key={`${t.teamSeasonId}-${t.week}`} gap={0}>
                            <TeamLabel ctx={ctx} trophy={t} />
                            <Text span fz="sm" c="dimmed">
                              {a.format(t)}
                              {t.week ? ` · WK ${t.week}` : ""}
                            </Text>
                          </Stack>
                        ))}
                    </Table.Td>
                  ))}
                  <Table.Td>
                    {iq.length === 0 ? (
                      "–"
                    ) : iq.length > 2 ? (
                      <Text span fz="sm" c="dimmed">
                        {iq.length} perfect lineups ({fmtPct(iq[0]?.value ?? 1)})
                      </Text>
                    ) : (
                      iq.map((t) => (
                        <Stack key={`${t.teamSeasonId}-${t.week}`} gap={0}>
                          <TeamLabel ctx={ctx} trophy={t} />
                          <Text span fz="sm" c="dimmed">
                            {fmtPct(t.value)} · WK {t.week}
                          </Text>
                        </Stack>
                      ))
                    )}
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}

export default function Trophies() {
  const { league } = useLeague();
  const [search, setSearch] = useSearchParams();
  const q = useQuery(trophiesQuery(league.slug));

  if (q.isPending)
    return (
      <Stack gap="lg">
        <Skeleton h={28} w="30%" />
        <Skeleton h={220} />
        <Skeleton h={28} w="30%" />
        <Skeleton h={220} />
      </Stack>
    );
  if (q.isError) return <QueryError error={q.error} onRetry={() => void q.refetch()} />;

  const { trophies, entities, seasonsIncluded } = q.data;
  const season = Number(search.get("season")) || null;
  const shown = season ? trophies.filter((t) => t.season === season) : trophies;
  const ctx: Ctx = { leagueSlug: league.slug, entities };
  const iqNote = shown.filter((t) => t.type === "smartypants-club").length;

  return (
    <Stack gap={40}>
      <SegmentedOrSelect
        label="Season"
        value={season ? String(season) : "all"}
        options={[
          { value: "all", label: "All" },
          ...[...seasonsIncluded]
            .sort((a, b) => b - a)
            .map((y) => ({ value: String(y), label: String(y) })),
        ]}
        onChange={(v) =>
          setSearch(
            (prev) => {
              const next = new URLSearchParams(prev);
              if (v === "all") next.delete("season");
              else next.set("season", v);
              return next;
            },
            { replace: true }
          )
        }
      />
      {shown.length === 0 ? (
        <EmptyState>No trophies have been awarded yet.</EmptyState>
      ) : (
        <>
          <Podium trophies={shown} ctx={ctx} />
          <Cabinet trophies={shown} ctx={ctx} />
          <Club
            title="High Scorer's Club"
            blurb="Every team week that cleared the league's high-score line."
            trophies={byType(shown, "high-scorer-club")}
            ctx={ctx}
            format={(t) => fmtDecimal(t.value)}
          />
          <Club
            title="Benchwarmer's Club"
            blurb="Every team week that fell under the league's low-score line."
            trophies={byType(shown, "benchwarmer-club")}
            ctx={ctx}
            format={(t) => fmtDecimal(t.value)}
          />
          <Club
            title="Smartypants Club"
            blurb={`A perfect lineup: the best possible score, set to the point (${fmtInt(iqNote)} so far).`}
            trophies={byType(shown, "smartypants-club")}
            ctx={ctx}
            format={(t) => fmtPct(t.value)}
          />
          <SeasonAwards trophies={shown} ctx={ctx} />
        </>
      )}
    </Stack>
  );
}
