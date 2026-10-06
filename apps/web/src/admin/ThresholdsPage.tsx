import { Button, Group, NumberInput, Select, Stack, Table } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { adminQuery, adminRequest, useAdminMutation } from "./api";
import { adminLeaguesSchema, okSchema, thresholdsSchema } from "./schemas";
import { AdminTable, Loaded, Notice, PageHeader, Panel } from "./ui";

const KEYS = [
  { value: "high_scorer", label: "High Scorer's Club: a team week above" },
  { value: "benchwarmer", label: "Benchwarmer's Club: a team week below" },
];

export default function ThresholdsPage() {
  const leagues = useQuery(adminQuery(["leagues"], "/leagues", adminLeaguesSchema));
  const [leagueId, setLeagueId] = useState<string | null>(null);
  const league = leagues.data?.leagues.find(
    (l) => String(l.id) === (leagueId ?? String(leagues.data.leagues[0]?.id))
  );
  const thresholds = useQuery({
    ...adminQuery(
      ["thresholds", league?.id],
      `/thresholds?leagueId=${league?.id}`,
      thresholdsSchema
    ),
    enabled: league !== undefined,
  });
  const [key, setKey] = useState<string | null>("high_scorer");
  const [seasonId, setSeasonId] = useState<string | null>("all");
  const [value, setValue] = useState<number | string>("");
  const tkey = [["thresholds"]];
  const save = useAdminMutation(
    () =>
      adminRequest("PUT", "/thresholds", okSchema, {
        leagueId: league!.id,
        leagueSeasonId: seasonId === "all" || seasonId === null ? null : Number(seasonId),
        key,
        value: Number(value),
      }),
    {
      success: "Saved. Trophies are being recomputed.",
      invalidate: tkey,
      onDone: () => setValue(""),
    }
  );
  const remove = useAdminMutation(
    (id: number) => adminRequest("DELETE", `/thresholds/${id}`, okSchema),
    { success: "Removed. Trophies are being recomputed.", invalidate: tkey }
  );
  const seasonLabel = (id: number | null) =>
    id === null ? "All seasons" : (league?.seasons.find((s) => s.id === id)?.year ?? id);

  return (
    <>
      <PageHeader title="Trophy thresholds">
        The score lines for the High Scorer's and Benchwarmer's clubs.
      </PageHeader>
      <Notice>
        A season-specific line beats the league-wide one. Changing a line recomputes the trophies.
      </Notice>
      <Stack>
        <Select
          label="League"
          w={220}
          allowDeselect={false}
          data={(leagues.data?.leagues ?? []).map((l) => ({ value: String(l.id), label: l.name }))}
          value={league ? String(league.id) : null}
          onChange={setLeagueId}
        />
        <Loaded query={thresholds}>
          {(d) => (
            <AdminTable minWidth={520}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Club</Table.Th>
                  <Table.Th>Applies to</Table.Th>
                  <Table.Th>Points</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {d.thresholds.map((t) => (
                  <Table.Tr key={t.id}>
                    <Table.Td>{KEYS.find((k) => k.value === t.key)?.label ?? t.key}</Table.Td>
                    <Table.Td>{seasonLabel(t.leagueSeasonId)}</Table.Td>
                    <Table.Td>{t.value}</Table.Td>
                    <Table.Td>
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        color="red"
                        onClick={() => remove.mutate(t.id)}
                      >
                        Remove
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </AdminTable>
          )}
        </Loaded>
        <Panel title="Set a line">
          <Group align="flex-end" wrap="wrap">
            <Select
              label="Club"
              w={320}
              data={KEYS}
              value={key}
              onChange={setKey}
              allowDeselect={false}
            />
            <Select
              label="Applies to"
              w={160}
              allowDeselect={false}
              data={[
                { value: "all", label: "All seasons" },
                ...(league?.seasons ?? []).map((s) => ({
                  value: String(s.id),
                  label: String(s.year),
                })),
              ]}
              value={seasonId}
              onChange={setSeasonId}
            />
            <NumberInput
              label="Points"
              w={110}
              min={0}
              decimalScale={2}
              value={value}
              onChange={setValue}
            />
            <Button
              disabled={value === "" || !league}
              loading={save.isPending}
              onClick={() => save.mutate()}
            >
              Save
            </Button>
          </Group>
        </Panel>
      </Stack>
    </>
  );
}
