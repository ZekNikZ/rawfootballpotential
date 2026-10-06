import { Button, NumberInput, Select, Stack, Switch, Table, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { adminQuery, adminRequest, useAdminMutation } from "./api";
import { okSchema, recordsAdminSchema } from "./schemas";
import { AdminTable, Loaded, Notice, PageHeader } from "./ui";

type Data = (typeof recordsAdminSchema)["_output"];
const rkey = [["records"]];

function Row({
  rec,
  config,
  leagueId,
}: {
  rec: Data["records"][number];
  config: Data["config"][number] | undefined;
  leagueId: number | null;
}) {
  const [order, setOrder] = useState<number | string>(config?.sortOrder ?? 0);
  const save = useAdminMutation(
    (patch: { visible?: boolean; featured?: boolean; sortOrder?: number }) =>
      adminRequest("PUT", "/records", okSchema, {
        leagueId,
        recordId: rec.id,
        visible: config?.visible ?? true,
        sortOrder: config?.sortOrder ?? 0,
        featured: config?.featured ?? false,
        ...patch,
      }),
    { invalidate: rkey }
  );
  const reset = useAdminMutation(() => adminRequest("DELETE", `/records/${config!.id}`, okSchema), {
    success: "Back to the default",
    invalidate: rkey,
    onDone: () => setOrder(0),
  });
  return (
    <Table.Tr>
      <Table.Td>
        <Text size="sm">{rec.title}</Text>
        <Text size="xs" c="dimmed">
          {rec.id}
        </Text>
      </Table.Td>
      <Table.Td>
        <Switch
          aria-label={`${rec.title} visible`}
          checked={config?.visible ?? true}
          onChange={(e) => save.mutate({ visible: e.currentTarget.checked })}
        />
      </Table.Td>
      <Table.Td>
        <Switch
          aria-label={`${rec.title} featured`}
          checked={config?.featured ?? false}
          onChange={(e) => save.mutate({ featured: e.currentTarget.checked })}
        />
      </Table.Td>
      <Table.Td>
        <NumberInput
          aria-label={`${rec.title} position`}
          size="xs"
          w={90}
          min={0}
          value={order}
          onChange={setOrder}
          onBlur={() => {
            const n = Number(order) || 0;
            if (n !== (config?.sortOrder ?? 0)) save.mutate({ sortOrder: n });
          }}
        />
      </Table.Td>
      <Table.Td>
        {config && (
          <Button
            size="compact-xs"
            variant="subtle"
            loading={reset.isPending}
            onClick={() => reset.mutate()}
          >
            Reset
          </Button>
        )}
      </Table.Td>
    </Table.Tr>
  );
}

export default function RecordSettingsPage() {
  const q = useQuery(adminQuery(["records"], "/records", recordsAdminSchema));
  const [scope, setScope] = useState<string>("global");
  const leagueId = scope === "global" ? null : Number(scope);
  return (
    <>
      <PageHeader title="Records">
        Choose which records appear on the site, which are featured, and in what order.
      </PageHeader>
      <Notice>
        A league's own setting beats the global one. "Position" 0 keeps the default order; give a
        number to place a record (defaults are spaced 10, 20, 30… in the catalog's order).
      </Notice>
      <Loaded query={q}>
        {(d) => {
          const sections = new Map<string, Data["records"]>();
          for (const r of d.records)
            sections.set(r.section, [...(sections.get(r.section) ?? []), r]);
          return (
            <Stack>
              <Select
                label="Settings for"
                w={240}
                allowDeselect={false}
                data={[
                  { value: "global", label: "All leagues" },
                  ...d.leagues.map((l) => ({ value: String(l.id), label: l.name })),
                ]}
                value={scope}
                onChange={(v) => setScope(v ?? "global")}
              />
              <AdminTable minWidth={620}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Record</Table.Th>
                    <Table.Th>Visible</Table.Th>
                    <Table.Th>Featured</Table.Th>
                    <Table.Th>Position</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {[...sections].flatMap(([section, records]) => [
                    <Table.Tr key={`s-${section}`}>
                      <Table.Td colSpan={5} fw={600}>
                        {section}
                      </Table.Td>
                    </Table.Tr>,
                    ...records.map((r) => (
                      <Row
                        key={`${scope}-${r.id}`}
                        rec={r}
                        leagueId={leagueId}
                        config={d.config.find(
                          (c) => c.recordId === r.id && c.leagueId === leagueId
                        )}
                      />
                    )),
                  ])}
                </Table.Tbody>
              </AdminTable>
            </Stack>
          );
        }}
      </Loaded>
    </>
  );
}
