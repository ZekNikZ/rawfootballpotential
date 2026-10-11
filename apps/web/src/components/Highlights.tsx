import { Anchor, Badge, Group, Paper, Stack, Text } from "@mantine/core";
import { Link } from "react-router";
import type { Highlight } from "../api/schemas";
import { fmtDecimal, fmtInt, fmtMoney, fmtPct1 } from "../lib/format";
import { useLeague } from "../lib/league-context";

/** A highlight's ranked value in the format of its record's column. */
export function highlightValue(h: Pick<Highlight, "value" | "valueType">): string {
  switch (h.valueType) {
    case "pct":
      return fmtPct1(h.value);
    case "int":
      return fmtInt(h.value);
    case "currency":
      return fmtMoney(h.value);
    default:
      return fmtDecimal(h.value);
  }
}

/** "2024 · WK 5", or just the season. */
export function whenText(h: Pick<Highlight, "season" | "week">): string | null {
  if (h.season === null) return null;
  return h.week === null ? String(h.season) : `${h.season} · WK ${h.week}`;
}

/** The score line of a game highlight: "202.14 – 116.12 vs Team". */
export function scoreText(h: Highlight): string | null {
  if (h.points === null || h.opponentPoints === null) return null;
  return `${fmtDecimal(h.points)} – ${fmtDecimal(h.opponentPoints)}${h.opponent ? ` vs ${h.opponent}` : ""}`;
}

export function TeamLink({
  franchiseId,
  team,
  manager,
  lead = "team",
}: {
  franchiseId: number | null;
  team: string | null;
  manager?: string | null;
  /** Which name is the link; the other one is shown in brackets. */
  lead?: "team" | "manager";
}) {
  const { league } = useLeague();
  const byManager = lead === "manager" && !!manager;
  const name = (byManager ? manager : team) ?? "Unknown team";
  const other = byManager ? team : manager;
  return (
    <Text span>
      {franchiseId === null ? (
        name
      ) : (
        <Anchor component={Link} to={`/${league.slug}/franchises/${franchiseId}`} fw={600}>
          {name}
        </Anchor>
      )}
      {other && (
        <Text span c="dimmed" fz="sm">
          {" "}
          ({other})
        </Text>
      )}
    </Text>
  );
}

/** One highlight as a tile: what it is, the number, who earned it and when. */
export function HighlightTile({
  h,
  unit,
  showRank = false,
}: {
  h: Highlight;
  unit?: string | null | undefined;
  showRank?: boolean;
}) {
  const when = whenText(h);
  const score = scoreText(h);
  return (
    <Paper withBorder radius="sm" p="sm" style={{ minWidth: 0 }}>
      <Group justify="space-between" wrap="nowrap" gap="xs" align="flex-start">
        <Text size="xs" c="dimmed" tt="uppercase" fw={700} lh={1.2}>
          {h.label}
        </Text>
        {showRank && (
          <Badge size="xs" variant="light" color={h.rank === 1 ? "green" : "gray"}>
            {h.rank === 1 ? "record" : `#${h.rank} all time`}
          </Badge>
        )}
        {h.tied && (
          <Badge size="xs" variant="light" color="orange">
            tied
          </Badge>
        )}
      </Group>
      <Group gap={6} align="baseline" mt={6}>
        <Text fw={800} fz={28} lh={1} style={{ fontVariantNumeric: "tabular-nums" }}>
          {highlightValue(h)}
        </Text>
        {unit && (
          <Text size="xs" c="dimmed">
            {unit}
          </Text>
        )}
      </Group>
      <Stack gap={2} mt="xs">
        {h.player && (
          <Text fw={600} lh={1.25}>
            {h.player}
            {h.position && (
              <Text span c="dimmed" fz="sm">
                {" "}
                · {h.position}
              </Text>
            )}
          </Text>
        )}
        {(h.team || h.franchiseId !== null) && (
          <TeamLink franchiseId={h.franchiseId} team={h.team} manager={h.manager} />
        )}
        {score && (
          <Text size="sm" c="dimmed">
            {score}
          </Text>
        )}
        {when && (
          <Text size="xs" c="dimmed">
            {when}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}
