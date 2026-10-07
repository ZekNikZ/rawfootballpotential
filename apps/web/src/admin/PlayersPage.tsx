import { Button, Group, Modal, Select, Stack, Table, Tabs, Text } from "@mantine/core";
import { useDebouncedValue, useDisclosure } from "@mantine/hooks";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { adminQuery, adminRequest, useAdminMutation } from "./api";
import { okSchema, playerSearchSchema, unmatchedSchema } from "./schemas";
import { AdminTable, Loaded, Notice, PageHeader, shortDate } from "./ui";

type Row = (typeof unmatchedSchema)["_output"]["unmatched"][number];
const ukey = [["unmatched"]];

function MapModal({ row }: { row: Row }) {
  const [opened, { open, close }] = useDisclosure(false);
  const [search, setSearch] = useState(row.name ?? "");
  const [debounced] = useDebouncedValue(search, 300);
  const [pick, setPick] = useState<string | null>(null);
  const results = useQuery({
    ...adminQuery(
      ["player-search", debounced],
      `/players/search?q=${encodeURIComponent(debounced)}`,
      playerSearchSchema
    ),
    enabled: opened && debounced.trim().length >= 2,
  });
  const map = useAdminMutation(
    () =>
      adminRequest("POST", `/players/unmatched/${row.id}/map`, okSchema, {
        playerId: Number(pick),
      }),
    { success: "Mapped", invalidate: ukey, onDone: close }
  );
  return (
    <>
      <Button size="compact-xs" onClick={open}>
        Match…
      </Button>
      <Modal opened={opened} onClose={close} title={`Match ${row.name ?? row.externalId}`}>
        <Stack>
          <Text size="sm" c="dimmed">
            {row.source.toUpperCase()} id {row.externalId}
            {row.position ? ` · ${row.position}` : ""}
            {row.nflTeam ? ` · ${row.nflTeam}` : ""}
          </Text>
          <Select
            label="Which player is this?"
            placeholder="Search by name"
            searchable
            searchValue={search}
            onSearchChange={setSearch}
            filter={({ options }) => options}
            nothingFoundMessage={
              debounced.length < 2 ? "Type at least 2 letters" : "No players found"
            }
            data={(results.data?.players ?? []).map((p) => ({
              value: String(p.id),
              label: `${p.name}${p.position ? ` · ${p.position}` : ""}${p.nflTeam ? ` · ${p.nflTeam}` : ""}`,
            }))}
            value={pick}
            onChange={setPick}
          />
          <Button disabled={!pick} loading={map.isPending} onClick={() => map.mutate()}>
            Save match
          </Button>
        </Stack>
      </Modal>
    </>
  );
}

function Queue({ status }: { status: "open" | "mapped" | "ignored" }) {
  const q = useQuery(
    adminQuery(["unmatched", status], `/players/unmatched?status=${status}`, unmatchedSchema)
  );
  const ignore = useAdminMutation(
    (id: number) => adminRequest("POST", `/players/unmatched/${id}/ignore`, okSchema, {}),
    { success: "Ignored", invalidate: ukey }
  );
  return (
    <Loaded query={q}>
      {(d) =>
        d.unmatched.length === 0 ? (
          <Text c="dimmed">Nothing here.</Text>
        ) : (
          <AdminTable minWidth={620}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Source id</Table.Th>
                <Table.Th>Pos / team</Table.Th>
                <Table.Th>First seen</Table.Th>
                {status === "open" && <Table.Th />}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {d.unmatched.map((r) => (
                <Table.Tr key={r.id}>
                  <Table.Td>{r.name ?? "(no name)"}</Table.Td>
                  <Table.Td>
                    {r.source} {r.externalId}
                  </Table.Td>
                  <Table.Td>{[r.position, r.nflTeam].filter(Boolean).join(" · ") || "–"}</Table.Td>
                  <Table.Td>{shortDate(r.firstSeenAt)}</Table.Td>
                  {status === "open" && (
                    <Table.Td>
                      <Group gap={4} wrap="nowrap">
                        <MapModal row={r} />
                        <Button
                          size="compact-xs"
                          variant="subtle"
                          color="gray"
                          onClick={() => ignore.mutate(r.id)}
                        >
                          Ignore
                        </Button>
                      </Group>
                    </Table.Td>
                  )}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </AdminTable>
        )
      }
    </Loaded>
  );
}

export default function PlayersPage() {
  return (
    <>
      <PageHeader title="Unmatched players">
        Players from imported data that couldn't be matched to a known player.
      </PageHeader>
      <Notice>
        Matching teaches the importer that id, so the player is recognized next time. Ignore ids
        that don't need a match (for example players who never played).
      </Notice>
      <Tabs defaultValue="open" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="open">Open</Tabs.Tab>
          <Tabs.Tab value="mapped">Matched</Tabs.Tab>
          <Tabs.Tab value="ignored">Ignored</Tabs.Tab>
        </Tabs.List>
        {(["open", "mapped", "ignored"] as const).map((s) => (
          <Tabs.Panel key={s} value={s}>
            <Queue status={s} />
          </Tabs.Panel>
        ))}
      </Tabs>
    </>
  );
}
