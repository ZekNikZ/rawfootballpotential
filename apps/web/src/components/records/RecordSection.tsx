import { Group, Select, Stack, Text, Title } from "@mantine/core";
import { Check } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { recordQuery } from "../../api/queries";
import type { CatalogRecord } from "../../api/schemas";
import { useLeague } from "../../lib/league-context";
import { BackToTop } from "./BackToTop";
import { FilterBar } from "./filters";
import { RecordTable } from "./RecordTable";
import { DEFAULT_PAGE_SIZE, useSectionState } from "./section-state";

interface Props {
  sectionKey: string;
  title: string;
  records: CatalogRecord[];
}

/** One record category: a title, a picker for the record, its filters and the table. */
export function RecordSection({ sectionKey, title, records }: Props) {
  const { league } = useLeague();
  const state = useSectionState(sectionKey);
  const def = records.find((r) => r.id === state.rec) ?? records[0];
  if (!def) return null;

  return (
    <Stack gap={10} component="section" aria-labelledby={`h-${sectionKey}`}>
      <Title order={2} id={`h-${sectionKey}`}>
        {title}
      </Title>
      {records.length > 1 && (
        <Select
          aria-label={`${title} record`}
          value={def.id}
          allowDeselect={false}
          maxDropdownHeight={420}
          data={records.map((r) => ({ value: r.id, label: r.title }))}
          renderOption={({ option, checked }) => (
            <Group gap="xs" wrap="nowrap" justify="space-between" w="100%">
              <div>
                <Text size="sm" fw={checked ? 600 : 400}>
                  {option.label}
                </Text>
                <Text size="xs" c="dimmed">
                  {records.find((r) => r.id === option.value)?.summary}
                </Text>
              </div>
              {checked && <Check size={14} weight="bold" aria-hidden />}
            </Group>
          )}
          onChange={(value) => {
            if (!value) return;
            state.update({
              rec: value === records[0]?.id ? undefined : value,
              sort: undefined,
              dir: undefined,
            });
          }}
        />
      )}
      {def.description && (
        <Text size="sm" c="dimmed">
          {def.description}
        </Text>
      )}
      <SectionBody
        key={def.id}
        sectionKey={sectionKey}
        def={def}
        state={state}
        leagueSlug={league.slug}
      />
      <BackToTop />
    </Stack>
  );
}

function SectionBody({
  def,
  state,
  leagueSlug,
}: {
  sectionKey: string;
  def: CatalogRecord;
  state: ReturnType<typeof useSectionState>;
  leagueSlug: string;
}) {
  const { league } = useLeague();
  // Share the table's query (same key) so the filter bar can show server-side defaults without a second request.
  const params = useQuery({
    ...recordQuery(leagueSlug, def.id, {
      ...state.apiParams,
      limit: def.displayAll ? 500 : state.size,
      offset: def.displayAll ? 0 : (state.page - 1) * state.size,
    }),
  }).data?.params;
  return (
    <>
      <FilterBar
        filters={def.filters}
        preset={def.preset}
        league={league}
        availableFrom={def.availableFrom}
        values={state.filters}
        params={params}
        minGamesDefault={def.qualifier?.minGames}
        positionOptions={def.positionOptions}
        onChange={(patch) => state.update(patch)}
      />
      <RecordTable
        leagueSlug={leagueSlug}
        def={def}
        filters={state.apiParams}
        sort={state.sort}
        dir={state.dir}
        onSort={(key, dir) =>
          state.update(
            key === def.sortKey && dir === def.direction
              ? { sort: undefined, dir: undefined }
              : { sort: key, dir }
          )
        }
        page={state.page}
        size={state.size === DEFAULT_PAGE_SIZE ? DEFAULT_PAGE_SIZE : state.size}
        onPage={(p) => state.update({ page: p === 1 ? undefined : String(p) }, { keepPage: true })}
        onSize={(n) => state.update({ size: n === DEFAULT_PAGE_SIZE ? undefined : String(n) })}
      />
    </>
  );
}
