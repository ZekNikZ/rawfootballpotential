import {
  Group,
  MultiSelect,
  NativeSelect,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { useQuery } from "@tanstack/react-query";
import { franchisesQuery } from "../../api/queries";
import type { Entities, FilterKey, League, RecordResponse } from "../../api/schemas";

export const SCOPE_OPTIONS = [
  { value: "all", label: "🏈 All" },
  { value: "regular", label: "📅 Regular Season" },
  { value: "playoffs", label: "🏆 Playoffs" },
  { value: "toilet_bowl", label: "💩 Toilet Bowl" },
  { value: "postseason", label: "🏅 Postseason" },
];

export const MEDIAN_OPTIONS = [
  { value: "default", label: "🧡 Season Default" },
  { value: "include", label: "✅ Include" },
  { value: "only", label: "🔷 Only Medians" },
  { value: "exclude", label: "⛔ Exclude" },
];

const POSITION_OPTIONS = ["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"];
const SLOT_OPTIONS = [
  { value: "starter", label: "Starters" },
  { value: "bench", label: "Bench" },
  { value: "ir", label: "IR" },
  { value: "taxi", label: "Taxi" },
];
const ONE_PER_OPTIONS = [
  { value: "", label: "All results" },
  { value: "season", label: "Best per season" },
  { value: "franchise", label: "Best per franchise" },
];

/** Most options a SegmentedControl shows before it becomes a dropdown; below `sm` it is always a dropdown. */
const MAX_SEGMENTS = 6;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Stack gap={2}>
      <Text size="sm">{label}</Text>
      {children}
    </Stack>
  );
}

interface SegProps {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}

/** A SegmentedControl that turns into a select when there are many options or the screen is narrow. */
export function SegmentedOrSelect({ label, value, options, onChange }: SegProps) {
  const narrow = useMediaQuery("(max-width: 48em)");
  const known = options.some((o) => o.value === value);
  const all = known ? options : [...options, { value, label: `Custom (${value})` }];
  return (
    <Field label={label}>
      {narrow || all.length > MAX_SEGMENTS ? (
        <NativeSelect
          aria-label={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          data={all}
        />
      ) : (
        <SegmentedControl aria-label={label} value={value} onChange={onChange} data={all} />
      )}
    </Field>
  );
}

export interface FilterValues {
  [key: string]: string | undefined;
}

interface Props {
  filters: readonly FilterKey[];
  /** Filters fixed by the record (hidden). */
  preset?: Record<string, unknown> | undefined;
  league: League;
  availableFrom: number | null;
  /** Values currently in the URL. */
  values: FilterValues;
  /** The server's normalized params, used to show defaults (e.g. exclude zero for "lowest"). */
  params: RecordResponse["params"] | undefined;
  minGamesDefault: number | undefined;
  /** Positions the Position filter offers (default: all). */
  positionOptions?: readonly string[] | undefined;
  onChange: (patch: FilterValues) => void;
}

function franchiseOptions(entities: Entities | undefined, ids: number[]) {
  return ids
    .map((id) => {
      const f = entities?.franchises[String(id)];
      const manager = f?.managerId == null ? null : entities?.managers[String(f.managerId)]?.name;
      return {
        value: String(id),
        label: [manager, f?.teamName].filter(Boolean).join(" · ") || `Franchise ${id}`,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** The filter controls a record supports (from the catalog), reading and writing URL-backed values. */
export function FilterBar({
  filters,
  preset,
  league,
  availableFrom,
  values,
  params,
  minGamesDefault,
  positionOptions,
  onChange,
}: Props) {
  const has = (k: FilterKey) => filters.includes(k) && !(preset && k in preset);
  const needsFranchises = has("franchise") || has("opponent");
  const franchises = useQuery({ ...franchisesQuery(league.slug), enabled: needsFranchises });

  const years = league.seasons
    .map((s) => s.year)
    .filter((y) => availableFrom === null || y >= availableFrom);
  const hasMedians = league.seasons.some((s) => s.medianEnabled);
  const fOptions = franchiseOptions(franchises.data?.entities, franchises.data?.franchises ?? []);

  const bool = (key: "excludeZero" | "countedOnly" | "combineTeams") =>
    values[key] !== undefined ? values[key] === "true" : (params?.[key] ?? false);
  const weeks = values.weeks?.match(/^(\d+)-(\d+)$/);

  return (
    <Group gap="md" align="flex-end" wrap="wrap">
      {has("seasons") && years.length >= 2 && (
        <SegmentedOrSelect
          label="Season"
          value={values.seasons ?? "all"}
          options={[
            { value: "all", label: "All" },
            ...years.map((y) => ({ value: String(y), label: String(y) })),
          ]}
          onChange={(v) => onChange({ seasons: v === "all" ? undefined : v })}
        />
      )}
      {has("scope") && (
        <SegmentedOrSelect
          label="Time"
          value={values.scope ?? "all"}
          options={SCOPE_OPTIONS}
          onChange={(v) => onChange({ scope: v === "all" ? undefined : v })}
        />
      )}
      {has("median") && hasMedians && (
        <SegmentedOrSelect
          label="Medians"
          value={values.median ?? "default"}
          options={MEDIAN_OPTIONS}
          onChange={(v) => onChange({ median: v === "default" ? undefined : v })}
        />
      )}
      {has("weeks") && (
        <Field label="Weeks">
          <Group gap={6} wrap="nowrap">
            <NumberInput
              aria-label="From week"
              w={72}
              min={1}
              max={18}
              placeholder="From"
              hideControls
              value={weeks ? Number(weeks[1]) : ""}
              onChange={(v) => {
                const from = typeof v === "number" ? v : undefined;
                const to = weeks ? Number(weeks[2]) : from;
                onChange({
                  weeks: from === undefined ? undefined : `${from}-${Math.max(from, to ?? from)}`,
                });
              }}
            />
            <Text size="sm">to</Text>
            <NumberInput
              aria-label="To week"
              w={72}
              min={1}
              max={18}
              placeholder="To"
              hideControls
              value={weeks ? Number(weeks[2]) : ""}
              onChange={(v) => {
                const to = typeof v === "number" ? v : undefined;
                const from = weeks ? Number(weeks[1]) : to;
                onChange({
                  weeks: to === undefined ? undefined : `${Math.min(from ?? to, to)}-${to}`,
                });
              }}
            />
          </Group>
        </Field>
      )}
      {has("franchise") && (
        <Field label="Team">
          <Select
            aria-label="Team"
            placeholder="All teams"
            searchable
            clearable
            w={220}
            data={fOptions}
            value={values.franchise ?? null}
            onChange={(v) => onChange({ franchise: v ?? undefined })}
          />
        </Field>
      )}
      {has("opponent") && (
        <Field label="Opponent">
          <Select
            aria-label="Opponent"
            placeholder="Any opponent"
            searchable
            clearable
            w={220}
            data={fOptions}
            value={values.opponent ?? null}
            onChange={(v) => onChange({ opponent: v ?? undefined })}
          />
        </Field>
      )}
      {has("positions") && (
        <Field label="Position">
          <MultiSelect
            aria-label="Position"
            placeholder={values.positions ? undefined : "All positions"}
            w={220}
            data={positionOptions ? [...positionOptions] : POSITION_OPTIONS}
            value={values.positions ? values.positions.split(",") : []}
            onChange={(v) => onChange({ positions: v.length ? v.join(",") : undefined })}
            checkIconPosition="right"
          />
        </Field>
      )}
      {has("slots") && (
        <Field label="Lineup slot">
          <MultiSelect
            aria-label="Lineup slot"
            placeholder={values.slots ? undefined : "Any slot"}
            w={220}
            data={SLOT_OPTIONS}
            value={values.slots ? values.slots.split(",") : []}
            onChange={(v) => onChange({ slots: v.length ? v.join(",") : undefined })}
            checkIconPosition="right"
          />
        </Field>
      )}
      {has("onePer") && (
        <Field label="Show">
          <NativeSelect
            aria-label="Show"
            value={values.onePer ?? ""}
            onChange={(e) => onChange({ onePer: e.target.value || undefined })}
            data={ONE_PER_OPTIONS}
          />
        </Field>
      )}
      {has("minGames") && (
        <Field label="Minimum games">
          <NumberInput
            aria-label="Minimum games"
            w={110}
            min={1}
            max={40}
            placeholder={minGamesDefault ? String(minGamesDefault) : "Any"}
            value={values.minGames ? Number(values.minGames) : ""}
            onChange={(v) => onChange({ minGames: typeof v === "number" ? String(v) : undefined })}
          />
        </Field>
      )}
      {has("excludeZero") && (
        <Switch
          label="Exclude zero-point weeks"
          checked={bool("excludeZero")}
          onChange={(e) => onChange({ excludeZero: String(e.currentTarget.checked) })}
          pb={6}
        />
      )}
      {has("countedOnly") && (
        <Switch
          label="Only weeks the team played"
          checked={bool("countedOnly")}
          onChange={(e) => onChange({ countedOnly: String(e.currentTarget.checked) })}
          pb={6}
        />
      )}
      {has("combineTeams") && (
        <Switch
          label="Combine a player's teams"
          checked={bool("combineTeams")}
          onChange={(e) => onChange({ combineTeams: String(e.currentTarget.checked) })}
          pb={6}
        />
      )}
    </Group>
  );
}
