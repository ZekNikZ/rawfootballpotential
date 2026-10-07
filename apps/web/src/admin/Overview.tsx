import { Badge, Button, Group, SimpleGrid, Stack, Table, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { adminQuery } from "./api";
import { runsSchema, unmatchedSchema } from "./schemas";
import { AdminTable, Loaded, PageHeader, Panel, shortDate } from "./ui";

export const STATUS_COLOR: Record<string, string> = {
  success: "green",
  failed: "red",
  running: "blue",
  queued: "gray",
};

export default function Overview() {
  const runs = useQuery(adminQuery(["runs", "recent"], "/jobs/runs?limit=8", runsSchema));
  const unmatched = useQuery(
    adminQuery(["unmatched", "open"], "/players/unmatched", unmatchedSchema)
  );
  const failed = runs.data?.runs.filter((r) => r.status === "failed").length ?? 0;
  return (
    <>
      <PageHeader title="Overview">Recent data jobs and anything waiting for you.</PageHeader>
      <SimpleGrid cols={{ base: 1, sm: 2 }} mb="xl">
        <Stack gap={2}>
          <Text c="dimmed" size="sm">
            Unmatched players
          </Text>
          <Group gap="xs">
            <Text fz="2rem" fw={700} lh={1}>
              {unmatched.data?.unmatched.length ?? "–"}
            </Text>
            <Button component={Link} to="/admin/players" size="xs" variant="light">
              Review
            </Button>
          </Group>
        </Stack>
        <Stack gap={2}>
          <Text c="dimmed" size="sm">
            Failed jobs (last 8 runs)
          </Text>
          <Group gap="xs">
            <Text fz="2rem" fw={700} lh={1} c={failed ? "red" : undefined}>
              {runs.data ? failed : "–"}
            </Text>
            <Button component={Link} to="/admin/jobs" size="xs" variant="light">
              Jobs
            </Button>
          </Group>
        </Stack>
      </SimpleGrid>
      <Panel title="Recent runs">
        <Loaded query={runs}>
          {(d) => (
            <AdminTable>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Job</Table.Th>
                  <Table.Th>Season</Table.Th>
                  <Table.Th>Started</Table.Th>
                  <Table.Th>Status</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {d.runs.map((r) => (
                  <Table.Tr key={r.id}>
                    <Table.Td>{r.kind}</Table.Td>
                    <Table.Td>{r.league ? `${r.league} ${r.year}` : "all"}</Table.Td>
                    <Table.Td>{shortDate(r.startedAt)}</Table.Td>
                    <Table.Td>
                      <Badge color={STATUS_COLOR[r.status] ?? "gray"} variant="light">
                        {r.status}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </AdminTable>
          )}
        </Loaded>
      </Panel>
    </>
  );
}
