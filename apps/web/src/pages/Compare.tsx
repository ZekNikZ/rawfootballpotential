import {
  Accordion,
  ActionIcon,
  Avatar,
  Badge,
  Group,
  Paper,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { ArrowsLeftRight } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { catalogQuery, compareQuery, franchiseQuery, franchisesQuery } from "../api/queries";
import type {
  CatalogRecord,
  Compare as CompareData,
  Entities,
  FranchiseProfile,
} from "../api/schemas";
import { EmptyState, QueryError } from "../components/QueryState";
import { numberText } from "../components/records/cells";
import { fmtDecimal, fmtInt, fmtPct1, ordinal } from "../lib/format";
import { useLeague } from "../lib/league-context";
import { usePageTitle } from "../lib/page-title";

type Meeting = CompareData["meetings"][number];

const GREEN = "var(--mantine-color-green-light)";
const RED = "var(--mantine-color-red-light)";
/** Green for the side that came out ahead, red for the other; nothing when level or unknown. */
const shade = (side: "a" | "b", better: "a" | "b" | null) =>
  better === null ? undefined : better === side ? GREEN : RED;

const label = (entities: Entities | undefined, id: number) => {
  const f = entities?.franchises[String(id)];
  const manager = f?.managerId == null ? null : entities?.managers[String(f.managerId)]?.name;
  return {
    manager: manager ?? null,
    team: f?.teamName ?? `Franchise ${id}`,
    text: [manager, f?.teamName].filter(Boolean).join(" · ") || `Franchise ${id}`,
  };
};

const record = (w: number, l: number, t: number) => `${w}-${l}${t ? `-${t}` : ""}`;

interface Series {
  games: number;
  aWins: number;
  bWins: number;
  ties: number;
  aAvg: number | null;
  bAvg: number | null;
  aBiggest: Meeting | null;
  bBiggest: Meeting | null;
  aLongest: number;
  bLongest: number;
  current: { side: "a" | "b" | "tie"; length: number } | null;
}

function series(ms: Meeting[]): Series {
  const s: Series = {
    games: ms.length,
    aWins: ms.filter((m) => m.result === "W").length,
    bWins: ms.filter((m) => m.result === "L").length,
    ties: ms.filter((m) => m.result === "T").length,
    aAvg: ms.length ? ms.reduce((n, m) => n + m.aPoints / m.spanWeeks, 0) / ms.length : null,
    bAvg: ms.length ? ms.reduce((n, m) => n + m.bPoints / m.spanWeeks, 0) / ms.length : null,
    aBiggest: null,
    bBiggest: null,
    aLongest: 0,
    bLongest: 0,
    current: null,
  };
  let run = 0;
  let side: "a" | "b" | "tie" | null = null;
  for (const m of ms) {
    const margin = m.aPoints - m.bPoints;
    if (m.result === "W" && (!s.aBiggest || margin > s.aBiggest.aPoints - s.aBiggest.bPoints))
      s.aBiggest = m;
    if (m.result === "L" && (!s.bBiggest || -margin > s.bBiggest.bPoints - s.bBiggest.aPoints))
      s.bBiggest = m;
    const now = m.result === "W" ? "a" : m.result === "L" ? "b" : "tie";
    run = now === side ? run + 1 : 1;
    side = now;
    if (now === "a") s.aLongest = Math.max(s.aLongest, run);
    if (now === "b") s.bLongest = Math.max(s.bLongest, run);
  }
  if (side) s.current = { side, length: run };
  return s;
}

const marginText = (m: Meeting | null, side: "a" | "b") =>
  m
    ? `${fmtDecimal(side === "a" ? m.aPoints : m.bPoints)} – ${fmtDecimal(side === "a" ? m.bPoints : m.aPoints)} (${m.season} WK ${m.week})`
    : "–";

function Person({
  entities,
  id,
  avatar,
}: {
  entities: Entities | undefined;
  id: number;
  avatar: string | null | undefined;
}) {
  const l = label(entities, id);
  return (
    <Group gap="sm" wrap="nowrap" miw={0}>
      <Avatar src={avatar ?? undefined} name={l.team} color="initials" radius="md" size={56} />
      <Stack gap={0} miw={0}>
        <Text fw={700} fz="lg" lh={1.25} truncate>
          {l.manager ?? l.team}
        </Text>
        <Text c="dimmed" size="sm" truncate>
          {l.manager ? l.team : ""}
        </Text>
      </Stack>
    </Group>
  );
}

/** Headline records first; the full list sits in a collapsed section. */
const HEADLINE = [
  "career.power",
  "career.winpct",
  "career.wins",
  "career.place.avg",
  "career.pfpg",
  "career.iq",
  "career.allplay",
  "career.luck",
  "career.sos",
  "career.score.stddev",
  "career.trade-value.total",
  "career.perfect",
];

function RankCell({
  profile,
  id,
  catalog,
}: {
  profile: FranchiseProfile | undefined;
  id: string;
  catalog: CatalogRecord[] | undefined;
}) {
  const r = profile?.records.find((x) => x.id === id);
  if (!r) return <Text c="dimmed">–</Text>;
  const def = catalog?.find((c) => c.id === id);
  const col = def?.columns.find((c) => c.key === def.sortKey);
  const value = r.values[def?.sortKey ?? "value"];
  return (
    <Group gap={6} justify="flex-end" wrap="nowrap">
      <Text fw={r.rank <= 3 ? 700 : undefined}>
        {numberText({ type: col?.type ?? "decimal" }, value)}
      </Text>
      <Text c="dimmed" fz="sm">
        {ordinal(r.rank)} of {r.of}
      </Text>
    </Group>
  );
}

function RankTable({
  ids,
  catalog,
  a,
  b,
}: {
  ids: readonly string[];
  catalog: CatalogRecord[] | undefined;
  a: FranchiseProfile | undefined;
  b: FranchiseProfile | undefined;
}) {
  const title = (id: string) =>
    a?.records.find((r) => r.id === id)?.title ?? b?.records.find((r) => r.id === id)?.title ?? id;
  const better = (id: string) => {
    const ra = a?.records.find((r) => r.id === id)?.rank;
    const rb = b?.records.find((r) => r.id === id)?.rank;
    return ra === undefined || rb === undefined || ra === rb ? null : ra < rb ? "a" : "b";
  };
  return (
    <Table.ScrollContainer minWidth={520} type="native">
      <Table withTableBorder verticalSpacing={6}>
        <Table.Tbody>
          {ids
            .filter(
              (id) => a?.records.some((r) => r.id === id) || b?.records.some((r) => r.id === id)
            )
            .map((id) => (
              <Table.Tr key={id}>
                <Table.Td data-numeric="" bg={shade("a", better(id))}>
                  <RankCell profile={a} id={id} catalog={catalog} />
                </Table.Td>
                <Table.Td ta="center" fw={600}>
                  {title(id)}
                </Table.Td>
                <Table.Td data-numeric="" bg={shade("b", better(id))}>
                  <RankCell profile={b} id={id} catalog={catalog} />
                </Table.Td>
              </Table.Tr>
            ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

function SeasonTable({
  a,
  b,
  aName,
  bName,
}: {
  a: FranchiseProfile;
  b: FranchiseProfile;
  aName: string;
  bName: string;
}) {
  const years = [...new Set([...a.seasons, ...b.seasons].map((s) => s.season))].sort(
    (x, y) => y - x
  );
  /** The better final place wins the row (only when both finished the season). */
  const betterIn = (year: number) => {
    const pa = a.seasons.find((x) => x.season === year);
    const pb = b.seasons.find((x) => x.season === year);
    if (pa?.status !== "complete" || pb?.status !== "complete") return null;
    if (pa.finalPlace === null || pb.finalPlace === null || pa.finalPlace === pb.finalPlace)
      return null;
    return pa.finalPlace < pb.finalPlace ? "a" : "b";
  };
  const cell = (p: FranchiseProfile, year: number) => {
    const s = p.seasons.find((x) => x.season === year);
    if (!s) return <Text c="dimmed">–</Text>;
    const finish =
      s.status !== "complete" ? "in progress" : s.finalPlace === null ? "–" : ordinal(s.finalPlace);
    return (
      <Group gap={6} wrap="nowrap" justify="center">
        <Text fw={s.finalPlace === 1 ? 700 : undefined}>
          {s.finalPlace === 1 ? "🏆 " : ""}
          {finish}
        </Text>
        <Text c="dimmed" fz="sm">
          {record(s.record.wins, s.record.losses, s.record.ties)} · {fmtDecimal(s.pf)} PF
        </Text>
      </Group>
    );
  };
  return (
    <Table.ScrollContainer minWidth={520} type="native">
      <Table withTableBorder verticalSpacing={6}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Season</Table.Th>
            <Table.Th ta="center">{aName}</Table.Th>
            <Table.Th ta="center">{bName}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {years.map((y) => (
            <Table.Tr key={y}>
              <Table.Td>{y}</Table.Td>
              <Table.Td bg={shade("a", betterIn(y))}>{cell(a, y)}</Table.Td>
              <Table.Td bg={shade("b", betterIn(y))}>{cell(b, y)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

const GAME_LABEL: Record<string, string> = {
  regular: "Regular season",
  playoffs: "Playoffs",
  toilet_bowl: "Toilet bowl",
  none: "Other",
};

function Meetings({ ms, aName, bName }: { ms: Meeting[]; aName: string; bName: string }) {
  if (ms.length === 0) return <EmptyState>These two have never played each other.</EmptyState>;
  return (
    <Table.ScrollContainer minWidth={480} type="native">
      <Table withTableBorder verticalSpacing={6}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Game</Table.Th>
            <Table.Th>Type</Table.Th>
            <Table.Th ta="right">{aName}</Table.Th>
            <Table.Th ta="right">{bName}</Table.Th>
            <Table.Th>Winner</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {[...ms].reverse().map((m) => (
            <Table.Tr key={`${m.season}-${m.week}`}>
              <Table.Td>
                {m.season} WK {m.week}
                {m.spanWeeks > 1 ? `-${m.week + m.spanWeeks - 1}` : ""}
              </Table.Td>
              <Table.Td>{GAME_LABEL[m.gameType] ?? m.gameType}</Table.Td>
              <Table.Td
                ta="right"
                fw={m.result === "W" ? 700 : undefined}
                bg={m.result === "T" ? undefined : m.result === "W" ? GREEN : RED}
              >
                {fmtDecimal(m.aPoints)}
              </Table.Td>
              <Table.Td
                ta="right"
                fw={m.result === "L" ? 700 : undefined}
                bg={m.result === "T" ? undefined : m.result === "L" ? GREEN : RED}
              >
                {fmtDecimal(m.bPoints)}
              </Table.Td>
              <Table.Td>{m.result === "W" ? aName : m.result === "L" ? bName : "Tie"}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

function Trades({ data, aName, bName }: { data: CompareData; aName: string; bName: string }) {
  if (data.trades.length === 0) return <EmptyState>No trades between these two.</EmptyState>;
  const assets = (list: CompareData["trades"][number]["aGets"]) =>
    list.length === 0
      ? "nothing"
      : list
          .map(
            (x) =>
              `${x.label}${x.value !== null ? ` (${x.value > 0 ? "+" : ""}${fmtInt(Math.round(x.value))})` : ""}`
          )
          .join(", ");
  return (
    <Stack gap="xs">
      {[...data.trades].reverse().map((t) => (
        <Paper key={t.transactionId} withBorder radius="sm" p="sm">
          <Group justify="space-between" wrap="nowrap" align="flex-start">
            <Stack gap={2}>
              <Text size="xs" c="dimmed" fw={700}>
                {t.season} · WK {t.week}
              </Text>
              <Text size="sm">
                <b>{aName}</b> got {assets(t.aGets)}
              </Text>
              <Text size="sm">
                <b>{bName}</b> got {assets(t.bGets)}
              </Text>
            </Stack>
            {t.net !== null && (
              <Badge variant="light" color={t.net === 0 ? "gray" : t.net > 0 ? "green" : "red"}>
                {t.net === 0
                  ? "even"
                  : `${t.net > 0 ? aName : bName} +${fmtInt(Math.round(Math.abs(t.net)))} pts`}
              </Badge>
            )}
          </Group>
        </Paper>
      ))}
      <Text size="xs" c="dimmed">
        Values are estimated rest-of-season production, as on the Trade Value page.
      </Text>
    </Stack>
  );
}

function Stat({ title, a, b }: { title: string; a: string; b: string }) {
  return (
    <Paper withBorder radius="sm" p="sm">
      <Text size="xs" c="dimmed" tt="uppercase" fw={700} mb={4}>
        {title}
      </Text>
      <Group justify="space-between" wrap="nowrap" gap="xs">
        <Text fw={600} fz="sm">
          {a}
        </Text>
        <Text fw={600} fz="sm" ta="right">
          {b}
        </Text>
      </Group>
    </Paper>
  );
}

export default function Compare() {
  const { league } = useLeague();
  const [search, setSearch] = useSearchParams();
  const a = Number(search.get("a")) || null;
  const b = Number(search.get("b")) || null;
  const franchises = useQuery(franchisesQuery(league.slug));
  const both = a !== null && b !== null && a !== b;
  const compare = useQuery({ ...compareQuery(league.slug, a ?? 0, b ?? 0), enabled: both });
  const pa = useQuery({ ...franchiseQuery(league.slug, a ?? 0), enabled: both });
  const pb = useQuery({ ...franchiseQuery(league.slug, b ?? 0), enabled: both });
  const catalog = useQuery(catalogQuery(league.slug));

  const entities = franchises.data?.entities;
  const options = (franchises.data?.franchises ?? [])
    .map((id) => ({ value: String(id), label: label(entities, id).text }))
    .sort((x, y) => x.label.localeCompare(y.label));
  const set = (key: "a" | "b", value: string | null) =>
    setSearch(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true }
    );
  const swap = () =>
    setSearch(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (b) next.set("a", String(b));
        if (a) next.set("b", String(a));
        return next;
      },
      { replace: true }
    );

  const ents = compare.data?.entities ?? entities;
  const aName = a ? (label(ents, a).manager ?? label(ents, a).team) : "";
  const bName = b ? (label(ents, b).manager ?? label(ents, b).team) : "";
  usePageTitle(both && aName && bName ? `${aName} vs ${bName}` : null);

  const ms = compare.data?.meetings ?? [];
  const all = series(ms);
  const regular = series(ms.filter((m) => m.gameType === "regular"));
  const post = series(ms.filter((m) => m.gameType !== "regular"));
  const streak = (s: Series) =>
    s.current
      ? s.current.side === "tie"
        ? "Last game was a tie"
        : `${s.current.side === "a" ? aName : bName} has won ${s.current.length} in a row`
      : "–";

  return (
    <Stack gap={32}>
      <Stack gap="sm">
        <Title order={1}>Compare managers</Title>
        <Group align="flex-end" gap="xs" wrap="wrap">
          <Select
            label="Manager A"
            placeholder="Pick a manager"
            data={options}
            value={a ? String(a) : null}
            onChange={(v) => set("a", v)}
            miw={240}
            style={{ flex: 1 }}
          />
          <ActionIcon variant="default" size="lg" onClick={swap} aria-label="Swap managers" mb={1}>
            <ArrowsLeftRight size={18} />
          </ActionIcon>
          <Select
            label="Manager B"
            placeholder="Pick a manager"
            data={options.filter((o) => o.value !== String(a))}
            value={b ? String(b) : null}
            onChange={(v) => set("b", v)}
            miw={240}
            style={{ flex: 1 }}
          />
        </Group>
      </Stack>

      {!both && (
        <EmptyState>Pick two managers to see their series, careers, seasons and trades.</EmptyState>
      )}
      {both && compare.isPending && (
        <Stack gap="md">
          <Skeleton h={90} />
          <Skeleton h={200} />
        </Stack>
      )}
      {both && compare.isError && (
        <QueryError error={compare.error} onRetry={() => void compare.refetch()} />
      )}
      {both && compare.data && a && b && (
        <>
          <Paper withBorder radius="sm" p="md">
            <Group justify="space-between" wrap="wrap" gap="md">
              <Person entities={ents} id={a} avatar={pa.data?.seasons.at(-1)?.avatar} />
              <Stack gap={0} align="center">
                <Text fz={36} fw={800} lh={1} style={{ fontVariantNumeric: "tabular-nums" }}>
                  {record(all.aWins, all.bWins, all.ties)}
                </Text>
                <Text size="xs" c="dimmed">
                  {all.games} games · {aName} vs {bName}
                </Text>
              </Stack>
              <Person entities={ents} id={b} avatar={pb.data?.seasons.at(-1)?.avatar} />
            </Group>
          </Paper>

          <Stack gap="sm" component="section" aria-labelledby="h-series">
            <Title order={2} id="h-series">
              The series
            </Title>
            <SimpleGrid cols={{ base: 1, xs: 2, md: 3 }} spacing="sm">
              <Stat
                title="Regular season"
                a={`${aName} ${record(regular.aWins, regular.bWins, regular.ties)}`}
                b={`${bName} ${record(regular.bWins, regular.aWins, regular.ties)}`}
              />
              <Stat
                title="Postseason"
                a={`${aName} ${record(post.aWins, post.bWins, post.ties)}`}
                b={`${bName} ${record(post.bWins, post.aWins, post.ties)}`}
              />
              <Stat
                title="Average score"
                a={all.aAvg === null ? "–" : fmtDecimal(all.aAvg)}
                b={all.bAvg === null ? "–" : fmtDecimal(all.bAvg)}
              />
              <Stat
                title="Biggest win"
                a={marginText(all.aBiggest, "a")}
                b={marginText(all.bBiggest, "b")}
              />
              <Stat title="Longest win streak" a={String(all.aLongest)} b={String(all.bLongest)} />
              <Paper withBorder radius="sm" p="sm">
                <Text size="xs" c="dimmed" tt="uppercase" fw={700} mb={4}>
                  Right now
                </Text>
                <Text fw={600} fz="sm">
                  {streak(all)}
                </Text>
                {all.games > 0 && (
                  <Text size="xs" c="dimmed">
                    {aName} wins {fmtPct1((all.aWins + all.ties / 2) / all.games)} of the games
                  </Text>
                )}
              </Paper>
            </SimpleGrid>
            <Meetings ms={ms} aName={aName} bName={bName} />
            <Text size="xs" c="dimmed">
              Head-to-head games only (median games are not a matchup between the two). A two-week
              playoff game counts once, with both weeks' points.
            </Text>
          </Stack>

          <Stack gap="sm" component="section" aria-labelledby="h-careers">
            <Title order={2} id="h-careers">
              Careers side by side
            </Title>
            {(pa.isPending || pb.isPending) && <Skeleton h={240} />}
            {(pa.isError || pb.isError) && <QueryError error={pa.error ?? pb.error} />}
            {pa.data && pb.data && (
              <>
                <Group justify="space-between">
                  <Text fw={700}>{aName}</Text>
                  <Text fw={700}>{bName}</Text>
                </Group>
                <RankTable ids={HEADLINE} catalog={catalog.data?.records} a={pa.data} b={pb.data} />
                <Accordion variant="contained">
                  <Accordion.Item value="all">
                    <Accordion.Control>Every manager record</Accordion.Control>
                    <Accordion.Panel>
                      <RankTable
                        ids={pa.data.records.map((r) => r.id)}
                        catalog={catalog.data?.records}
                        a={pa.data}
                        b={pb.data}
                      />
                    </Accordion.Panel>
                  </Accordion.Item>
                </Accordion>
                <Text size="xs" c="dimmed">
                  Each cell is the manager's value and league rank; the better rank is shaded.
                </Text>
              </>
            )}
          </Stack>

          {pa.data && pb.data && (
            <Stack gap="sm" component="section" aria-labelledby="h-seasons">
              <Title order={2} id="h-seasons">
                Season by season
              </Title>
              <SeasonTable a={pa.data} b={pb.data} aName={aName} bName={bName} />
            </Stack>
          )}

          <Stack gap="sm" component="section" aria-labelledby="h-trades">
            <Title order={2} id="h-trades">
              Trades between them
            </Title>
            <Trades data={compare.data} aName={aName} bName={bName} />
          </Stack>
        </>
      )}
    </Stack>
  );
}
