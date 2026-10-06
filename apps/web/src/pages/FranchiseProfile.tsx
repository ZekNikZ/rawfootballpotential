import { Anchor, Badge, Group, Skeleton, Stack, Table, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { catalogQuery, franchiseQuery } from "../api/queries";
import type { CatalogRecord, FranchiseProfile as Profile, Trophy } from "../api/schemas";
import { QueryError } from "../components/QueryState";
import { numberText } from "../components/records/cells";
import { fmtDecimal, fmtInt, ordinal } from "../lib/format";
import { useLeague, useLeaguePath } from "../lib/league-context";
import { usePageTitle } from "../lib/page-title";
import classes from "./Trophies.module.css";

const TROPHY_NAMES: Record<Trophy["type"], string> = {
  placement: "Placement",
  "high-scorer-club": "High Scorer's Club",
  "benchwarmer-club": "Benchwarmer's Club",
  "smartypants-club": "Smartypants Club",
  "season-high-score": "Season high score",
  "season-narrowest-win": "Narrowest win of the season",
  "season-largest-blowout": "Biggest blowout of the season",
  "season-points-for": "Most points for",
  "season-points-against": "Most points against",
  "season-high-iq": "Best lineup IQ of the season",
};

function trophyDetail(t: Trophy, lastPlace: ReadonlyMap<number, number>): string {
  switch (t.type) {
    case "placement":
      if (t.value === 1) return "🥇 Champion";
      if (t.value === 2) return "🥈 Runner-up";
      if (t.value === 3) return "🥉 Third place";
      return t.value === lastPlace.get(t.season) ? "💩 Last place" : ordinal(t.value);
    case "season-high-iq":
    case "smartypants-club":
      return `Perfect lineup · WK ${t.week}`;
    case "season-points-for":
    case "season-points-against":
      return fmtDecimal(t.value);
    default:
      return `${fmtDecimal(t.value)}${t.week ? ` · WK ${t.week}` : ""}`;
  }
}

export default function FranchiseProfile() {
  const { league } = useLeague();
  const id = Number(useParams().franchise);
  const profile = useQuery({ ...franchiseQuery(league.slug, id), enabled: Number.isInteger(id) });
  const catalog = useQuery(catalogQuery(league.slug));

  const entity = profile.data?.entities.franchises[String(id)];
  const manager =
    entity?.managerId == null
      ? null
      : profile.data?.entities.managers[String(entity.managerId)]?.name;
  usePageTitle(entity?.teamName ? `${entity.teamName}${manager ? ` (${manager})` : ""}` : null);

  if (profile.isPending)
    return (
      <Stack gap="lg">
        <Skeleton h={40} w="40%" />
        <Skeleton h={220} />
        <Skeleton h={220} />
      </Stack>
    );
  if (profile.isError)
    return <QueryError error={profile.error} onRetry={() => void profile.refetch()} />;

  const data = profile.data;
  return (
    <Stack gap={40}>
      <Stack gap={2}>
        <Title order={1}>{entity?.teamName ?? `Franchise ${id}`}</Title>
        <Text c="dimmed">
          {manager ?? "Unknown manager"} · {data.seasons.length} season
          {data.seasons.length === 1 ? "" : "s"} · since {data.seasons[0]?.season}
        </Text>
      </Stack>
      <Seasons data={data} />
      <Standings data={data} columns={catalog.data?.records} />
      <Trophies data={data} />
    </Stack>
  );
}

function Seasons({ data }: { data: Profile }) {
  return (
    <Stack gap={10}>
      <Title order={2}>Seasons</Title>
      <Table.ScrollContainer minWidth={640} type="native">
        <Table withTableBorder className={classes.table}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th className={classes.sticky}>Season</Table.Th>
              <Table.Th>Team</Table.Th>
              <Table.Th>Manager</Table.Th>
              <Table.Th data-numeric="">Record</Table.Th>
              <Table.Th data-numeric="">PF</Table.Th>
              <Table.Th data-numeric="">PA</Table.Th>
              <Table.Th>Finish</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {[...data.seasons].reverse().map((s) => (
              <Table.Tr key={s.teamSeasonId} className={classes.row}>
                <Table.Td className={classes.sticky}>{s.season}</Table.Td>
                <Table.Td>{s.teamName}</Table.Td>
                <Table.Td>
                  {s.managerId === null
                    ? "–"
                    : (data.entities.managers[String(s.managerId)]?.name ?? "–")}
                </Table.Td>
                <Table.Td data-numeric="">
                  {s.record.wins}-{s.record.losses}
                  {s.record.ties ? `-${s.record.ties}` : ""}
                </Table.Td>
                <Table.Td data-numeric="">{fmtDecimal(s.pf)}</Table.Td>
                <Table.Td data-numeric="">{fmtDecimal(s.pa)}</Table.Td>
                <Table.Td>
                  {s.status !== "complete" ? (
                    <Badge size="xs" variant="light" color="orange">
                      in progress
                    </Badge>
                  ) : s.finalPlace === null ? (
                    s.madePlayoffs ? (
                      "Playoffs"
                    ) : (
                      "–"
                    )
                  ) : (
                    `${ordinal(s.finalPlace)} of ${s.teamCount}`
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}

function Standings({ data, columns }: { data: Profile; columns: CatalogRecord[] | undefined }) {
  const sections = new Map<string, Profile["records"]>();
  for (const r of data.records) sections.set(r.section, [...(sections.get(r.section) ?? []), r]);
  return (
    <Stack gap={10}>
      <Title order={2}>Where this franchise ranks</Title>
      <Table.ScrollContainer minWidth={480} type="native">
        <Table withTableBorder className={classes.table}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th className={classes.sticky}>Record</Table.Th>
              <Table.Th data-numeric="">Value</Table.Th>
              <Table.Th data-numeric="">Rank</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {[...sections].flatMap(([section, records]) => [
              <Table.Tr key={`s-${section}`} className={classes.row}>
                <Table.Td colSpan={3} fw={600}>
                  {section}
                </Table.Td>
              </Table.Tr>,
              ...records.map((r) => {
                const def = columns?.find((c) => c.id === r.id);
                const col = def?.columns.find((c) => c.key === def.sortKey);
                const value = r.values[def?.sortKey ?? "value"];
                return (
                  <Table.Tr key={r.id} className={classes.row}>
                    <Table.Td className={classes.sticky}>{r.title}</Table.Td>
                    <Table.Td data-numeric="">
                      {numberText({ type: col?.type ?? "decimal" }, value)}
                    </Table.Td>
                    <Table.Td data-numeric="">
                      {ordinal(r.rank)}{" "}
                      <Text span c="dimmed" fz="sm">
                        of {r.of}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                );
              }),
            ])}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}

function Trophies({ data }: { data: Profile }) {
  const path = useLeaguePath();
  const lastPlace = new Map<number, number>();
  for (const s of data.seasons) lastPlace.set(s.season, s.teamCount);
  const counted = data.trophies.filter(
    (t) => t.type !== "season-high-iq" && t.type !== "smartypants-club"
  );
  const perfect = data.trophies.filter((t) => t.type === "smartypants-club").length;
  const rows = [...counted]
    .filter((t) => t.type !== "placement" || t.value <= 3 || t.value === lastPlace.get(t.season))
    .sort((a, b) => b.season - a.season || a.type.localeCompare(b.type));
  return (
    <Stack gap={10}>
      <Title order={2}>Trophies</Title>
      <Group gap="xs">
        <Badge variant="light">{fmtInt(perfect)} perfect lineups</Badge>
      </Group>
      {rows.length === 0 ? (
        <Text c="dimmed">No trophies yet.</Text>
      ) : (
        <Table.ScrollContainer minWidth={480} type="native">
          <Table withTableBorder className={classes.table}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th className={classes.sticky}>Season</Table.Th>
                <Table.Th>Trophy</Table.Th>
                <Table.Th>Detail</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((t) => (
                <Table.Tr
                  key={`${t.type}-${t.season}-${t.week}-${t.value}`}
                  className={classes.row}
                >
                  <Table.Td className={classes.sticky}>{t.season}</Table.Td>
                  <Table.Td>{TROPHY_NAMES[t.type]}</Table.Td>
                  <Table.Td>{trophyDetail(t, lastPlace)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      <Anchor component={Link} to={path("/records")} size="sm">
        All trophies
      </Anchor>
    </Stack>
  );
}
