import { Button, Group, SegmentedControl, Skeleton, Stack, Text, Title } from "@mantine/core";
import { BackToTop } from "./BackToTop";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { placementsQuery } from "../../api/queries";
import type { PlacementHistory } from "../../api/schemas";
import { fmtPct, ordinal } from "../../lib/format";
import { useLeague } from "../../lib/league-context";
import { seriesColor, splitRuns, weightedPlacement } from "../../lib/placement-chart";
import { EmptyState, QueryError } from "../QueryState";
import classes from "./PlacementChart.module.css";

type Mode = "place" | "weighted";

const W = 820;
const H = 300;
const PAD = { left: 48, right: 16, top: 12, bottom: 28 };

/** A franchise is labeled with its current manager (owner decision), like the matchup heatmap. */
function labelOf(h: PlacementHistory, franchiseId: number) {
  const f = h.entities.franchises[String(franchiseId)];
  const manager = f?.managerId == null ? null : h.entities.managers[String(f.managerId)]?.name;
  return manager ?? f?.teamName ?? `Franchise ${franchiseId}`;
}

export function PlacementChart() {
  const { league } = useLeague();
  const q = useQuery(placementsQuery(league.slug));
  const h = q.data;
  const [mode, setMode] = useState<Mode>("weighted");
  const [hidden, setHidden] = useState<ReadonlySet<number>>(new Set());
  const [active, setActive] = useState<number | null>(null);

  const series = useMemo(() => {
    if (!h) return [];
    return h.franchises
      .map((id) => ({
        id,
        label: labelOf(h, id),
        points: h.points.filter((p) => p.franchiseId === id),
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((s, i) => ({ ...s, color: seriesColor(i) }));
  }, [h]);

  const toggle = (id: number) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Stack gap={10} component="section" aria-labelledby="h-placement-time">
      <Title order={2} id="h-placement-time">
        Placement Over Time
      </Title>
      {q.isPending && <Skeleton h={320} />}
      {q.isError && !h && <QueryError error={q.error} onRetry={() => void q.refetch()} />}
      {h && h.points.length === 0 && <EmptyState>No completed seasons yet.</EmptyState>}
      {h && h.points.length > 0 && (
        <>
          <Group justify="space-between" gap="sm">
            <SegmentedControl
              size="xs"
              value={mode}
              onChange={(v) => setMode(v as Mode)}
              data={[
                { value: "weighted", label: "Weighted placement" },
                { value: "place", label: "Final place" },
              ]}
              aria-label="Chart value"
            />
            {hidden.size > 0 && (
              <Button size="compact-xs" variant="subtle" onClick={() => setHidden(new Set())}>
                Show all
              </Button>
            )}
          </Group>
          <Chart
            h={h}
            mode={mode}
            series={series}
            hidden={hidden}
            active={active}
            onActive={setActive}
          />
          <div className={classes.legend} role="group" aria-label="Managers">
            {series.map((s) => (
              <button
                key={s.id}
                type="button"
                className={classes.chip}
                data-off={hidden.has(s.id) ? "" : undefined}
                aria-pressed={!hidden.has(s.id)}
                onClick={() => toggle(s.id)}
                onMouseEnter={() => setActive(s.id)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(s.id)}
                onBlur={() => setActive(null)}
              >
                <span className={classes.swatch} style={{ background: s.color }} />
                {s.label}
              </button>
            ))}
          </div>
          <Text size="sm" c="dimmed">
            {mode === "place"
              ? "Final place each completed season (1st at the top). League size changes between seasons, so the bottom of the chart is the largest league."
              : "Weighted placement: 100% for first, 0% for last, scaled to the size of the league that season, so a 2nd in a 14-team league counts for more than a 2nd in a 9-team league."}{" "}
            Click a name to hide or show a line.
          </Text>
        </>
      )}
      <BackToTop />
    </Stack>
  );
}

function Chart({
  h,
  mode,
  series,
  hidden,
  active,
  onActive,
}: {
  h: PlacementHistory;
  mode: Mode;
  series: { id: number; label: string; color: string; points: PlacementHistory["points"] }[];
  hidden: ReadonlySet<number>;
  active: number | null;
  onActive: (id: number | null) => void;
}) {
  const seasons = h.seasonsIncluded;
  const maxTeams = Math.max(...h.points.map((p) => p.teamCount));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const x = (season: number) => {
    const i = seasons.indexOf(season);
    return PAD.left + (seasons.length > 1 ? (i / (seasons.length - 1)) * innerW : innerW / 2);
  };
  const y = (place: number, teamCount: number) => {
    const t =
      mode === "place"
        ? maxTeams > 1
          ? (place - 1) / (maxTeams - 1)
          : 0
        : 1 - weightedPlacement(place, teamCount);
    return PAD.top + t * innerH;
  };
  const yTicks =
    mode === "place"
      ? Array.from({ length: maxTeams }, (_, i) => ({
          at: PAD.top + (maxTeams > 1 ? (i / (maxTeams - 1)) * innerH : 0),
          label: String(i + 1),
        }))
      : [1, 0.75, 0.5, 0.25, 0].map((v) => ({
          at: PAD.top + (1 - v) * innerH,
          label: `${Math.round(v * 100)}%`,
        }));

  return (
    <svg
      className={classes.chart}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Line chart of each manager's final placement by season"
    >
      {yTicks.map((t) => (
        <g key={t.label}>
          <line className={classes.grid} x1={PAD.left} x2={W - PAD.right} y1={t.at} y2={t.at} />
          <text className={classes.axis} x={PAD.left - 8} y={t.at} textAnchor="end" dy="0.32em">
            {t.label}
          </text>
        </g>
      ))}
      {seasons.map((s) => (
        <text key={s} className={classes.axis} x={x(s)} y={H - PAD.bottom + 18} textAnchor="middle">
          {s}
        </text>
      ))}
      {series
        .filter((s) => !hidden.has(s.id))
        .map((s) => {
          const dim = active !== null && active !== s.id;
          return (
            <g key={s.id} onMouseEnter={() => onActive(s.id)} onMouseLeave={() => onActive(null)}>
              {splitRuns(s.points, seasons).map((run, i) => (
                <polyline
                  key={i}
                  className={classes.line}
                  data-dim={dim ? "" : undefined}
                  data-active={active === s.id ? "" : undefined}
                  stroke={s.color}
                  points={run.map((p) => `${x(p.season)},${y(p.place, p.teamCount)}`).join(" ")}
                />
              ))}
              {s.points.map((p) => (
                <circle
                  key={p.season}
                  className={classes.dot}
                  data-dim={dim ? "" : undefined}
                  cx={x(p.season)}
                  cy={y(p.place, p.teamCount)}
                  r={active === s.id ? 5 : 3.5}
                  fill={s.color}
                >
                  <title>
                    {`${s.label}, ${p.season}: ${ordinal(p.place)} of ${p.teamCount}` +
                      (mode === "weighted"
                        ? ` (${fmtPct(weightedPlacement(p.place, p.teamCount))})`
                        : "")}
                  </title>
                </circle>
              ))}
            </g>
          );
        })}
    </svg>
  );
}
