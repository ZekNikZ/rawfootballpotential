import { Anchor, Group, Stack, Text } from "@mantine/core";
import { Link } from "react-router";
import type { Column, Entities, RecordRow } from "../../api/schemas";
import { asNumber, fmtDecimal, fmtInt, fmtMoney, fmtPct } from "../../lib/format";

export const NUMERIC_TYPES: ReadonlySet<Column["type"]> = new Set([
  "int",
  "decimal",
  "points",
  "pct",
  "currency",
]);

/** Columns the API can order by (entity columns are resolved after the query); mirrors SORTABLE_COLUMN_TYPES in core. */
export const SORTABLE_TYPES: ReadonlySet<Column["type"]> = new Set([
  "int",
  "decimal",
  "points",
  "pct",
  "currency",
  "text",
  "player",
  "season",
  "week",
  "scoreline",
]);

interface CellContext {
  leagueSlug: string;
  entities: Entities;
}

const ref = (row: RecordRow, key: string) => asNumber(row.refs[key]);

function TeamCell({
  leagueSlug,
  franchiseId,
  teamName,
  manager,
}: {
  leagueSlug: string;
  franchiseId: number | null;
  teamName: string;
  manager: string | null;
}) {
  return (
    <Group gap={6} wrap="nowrap" align="baseline">
      {franchiseId === null ? (
        <Text span>{teamName}</Text>
      ) : (
        <Anchor component={Link} to={`/${leagueSlug}/franchises/${franchiseId}`}>
          {teamName}
        </Anchor>
      )}
      {manager && (
        <Text span c="dimmed" fz="sm">
          ({manager})
        </Text>
      )}
    </Group>
  );
}

function teamOf(
  ctx: CellContext,
  teamSeasonId: number | null,
  franchiseId: number | null,
  managerId: number | null
) {
  const ts = teamSeasonId === null ? undefined : ctx.entities.teamSeasons[String(teamSeasonId)];
  const franchise = franchiseId === null ? undefined : ctx.entities.franchises[String(franchiseId)];
  const name = ts?.name ?? franchise?.teamName ?? "Unknown team";
  const manager =
    managerId === null ? null : (ctx.entities.managers[String(managerId)]?.name ?? null);
  return { name, manager };
}

function formatHint(value: unknown): string | null {
  if (Array.isArray(value)) return value.length ? value.join(", ") : null;
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

export function numberText(col: Pick<Column, "type">, value: unknown): string {
  const n = asNumber(value);
  if (n === null) return "–";
  switch (col.type) {
    case "int":
      return fmtInt(n);
    case "pct":
      return fmtPct(n);
    case "currency":
      return fmtMoney(n);
    default:
      return fmtDecimal(n);
  }
}

/** One table cell for a column type; entity names come from the response's entity maps. */
export function renderCell(col: Column, row: RecordRow, ctx: CellContext) {
  const value = row.values[col.key];
  switch (col.type) {
    case "team": {
      const t = teamOf(
        ctx,
        ref(row, "teamSeasonId"),
        ref(row, "franchiseId"),
        ref(row, "managerId")
      );
      return (
        <TeamCell
          leagueSlug={ctx.leagueSlug}
          franchiseId={ref(row, "franchiseId")}
          teamName={t.name}
          manager={t.manager}
        />
      );
    }
    case "opponent": {
      const t = teamOf(
        ctx,
        ref(row, "opponentTeamSeasonId"),
        ref(row, "opponentFranchiseId"),
        ref(row, "opponentManagerId")
      );
      return (
        <TeamCell
          leagueSlug={ctx.leagueSlug}
          franchiseId={ref(row, "opponentFranchiseId")}
          teamName={t.name}
          manager={t.manager}
        />
      );
    }
    case "manager": {
      const id = ref(row, "managerId");
      const name = id === null ? "Unknown" : (ctx.entities.managers[String(id)]?.name ?? "Unknown");
      const franchiseId = ref(row, "franchiseId");
      const team =
        franchiseId === null ? null : ctx.entities.franchises[String(franchiseId)]?.teamName;
      return (
        <Stack gap={0}>
          {franchiseId === null ? (
            <Text span>{name}</Text>
          ) : (
            <Anchor component={Link} to={`/${ctx.leagueSlug}/franchises/${franchiseId}`}>
              {name}
            </Anchor>
          )}
          {team && (
            <Text span c="dimmed" fz="xs">
              {team}
            </Text>
          )}
        </Stack>
      );
    }
    case "week":
      return `${row.values.season} WK ${row.values.week}`;
    case "season":
      return String(value ?? "–");
    case "seasons":
      return Array.isArray(value) ? value.join(", ") : "–";
    case "player":
    case "text":
      return value === null || value === undefined || value === "" ? "–" : String(value);
    case "teams": {
      const ids = Array.isArray(row.refs.teamSeasonIds) ? row.refs.teamSeasonIds : [];
      return (
        <Stack gap={0}>
          {ids.map((id) => {
            const ts = ctx.entities.teamSeasons[String(id)];
            const mgr =
              ts?.managerId == null ? null : ctx.entities.managers[String(ts.managerId)]?.name;
            return (
              <Text key={String(id)} span>
                {ts?.name ?? "Unknown team"}
                {mgr && (
                  <Text span c="dimmed" fz="sm">
                    {" "}
                    ({mgr})
                  </Text>
                )}
              </Text>
            );
          })}
        </Stack>
      );
    }
    case "scoreline": {
      const points = asNumber(row.values.points);
      const opp = asNumber(row.values.opponentPoints);
      const margin = asNumber(row.values.margin);
      if (points === null) return "–";
      const rankedMargin = col.key === "margin";
      return (
        <Group gap={6} wrap="nowrap" align="baseline">
          <Text span fw={rankedMargin ? undefined : 600}>
            {fmtDecimal(points)}
            {opp !== null && ` - ${fmtDecimal(opp)}`}
          </Text>
          {margin !== null && (
            <Text
              span
              fz="sm"
              c={rankedMargin ? undefined : "dimmed"}
              fw={rankedMargin ? 600 : undefined}
            >
              (Δ {fmtDecimal(margin)})
            </Text>
          )}
        </Group>
      );
    }
    default: {
      const text = numberText(col, value);
      const hint = col.hint ? formatHint(row.values[col.hint]) : null;
      return hint ? (
        <Group gap={4} wrap="nowrap" justify="flex-end" align="baseline">
          {text}
          <Text span c="dimmed" fz="sm">
            ({hint})
          </Text>
        </Group>
      ) : (
        text
      );
    }
  }
}
