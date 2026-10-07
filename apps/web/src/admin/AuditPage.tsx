import { Button, Code, Group, Modal, Pagination, Stack, Table, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { adminQuery } from "./api";
import { auditSchema } from "./schemas";
import { AdminTable, Loaded, PageHeader, shortDate } from "./ui";

const PAGE = 30;
type Entry = (typeof auditSchema)["_output"]["entries"][number];

function Changes({ entry }: { entry: Entry }) {
  const [opened, { open, close }] = useDisclosure(false);
  return (
    <>
      <Button size="compact-xs" variant="subtle" onClick={open}>
        Changes
      </Button>
      <Modal
        opened={opened}
        onClose={close}
        title={`${entry.action} · ${shortDate(entry.at)}`}
        size="xl"
      >
        <Stack>
          <Text size="sm">
            {entry.user ?? "unknown"} · {entry.entity} {entry.entityId ?? ""}
          </Text>
          <Text fw={600} size="sm">
            Before
          </Text>
          <Code block>
            {entry.before === null ? "(nothing)" : JSON.stringify(entry.before, null, 2)}
          </Code>
          <Text fw={600} size="sm">
            After
          </Text>
          <Code block>
            {entry.after === null ? "(nothing)" : JSON.stringify(entry.after, null, 2)}
          </Code>
        </Stack>
      </Modal>
    </>
  );
}

export default function AuditPage() {
  const [page, setPage] = useState(1);
  const q = useQuery(
    adminQuery(["audit", page], `/audit?limit=${PAGE + 1}&offset=${(page - 1) * PAGE}`, auditSchema)
  );
  return (
    <>
      <PageHeader title="Audit log">
        Every change made through this admin area: who, what and when.
      </PageHeader>
      <Loaded query={q}>
        {(d) => (
          <Stack>
            <AdminTable minWidth={680}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>When</Table.Th>
                  <Table.Th>Who</Table.Th>
                  <Table.Th>Action</Table.Th>
                  <Table.Th>Target</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {d.entries.slice(0, PAGE).map((e) => (
                  <Table.Tr key={e.id}>
                    <Table.Td>{shortDate(e.at)}</Table.Td>
                    <Table.Td>{e.user ?? "–"}</Table.Td>
                    <Table.Td>{e.action}</Table.Td>
                    <Table.Td>
                      {e.entity} {e.entityId ?? ""}
                    </Table.Td>
                    <Table.Td>
                      <Changes entry={e} />
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </AdminTable>
            <Group>
              <Pagination
                total={page + (d.entries.length > PAGE ? 1 : 0)}
                value={page}
                onChange={setPage}
                size="sm"
              />
            </Group>
          </Stack>
        )}
      </Loaded>
    </>
  );
}
