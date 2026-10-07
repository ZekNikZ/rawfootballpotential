import {
  Badge,
  Button,
  Card,
  Code,
  Group,
  Modal,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { adminQuery, adminRequest, useAdminMutation } from "./api";
import { STATUS_COLOR } from "./Overview";
import { adminLeaguesSchema, okSchema, runsSchema } from "./schemas";
import { AdminTable, Loaded, PageHeader, Panel, shortDate } from "./ui";

const JOBS: { job: string; title: string; text: string; seasonal: boolean }[] = [
  {
    job: "live",
    title: "Live scores",
    text: "This week's scores for seasons in progress (the Matchups page).",
    seasonal: true,
  },
  {
    job: "daily",
    title: "Daily sync",
    text: "Players, rosters, transactions, draft picks and team names.",
    seasonal: true,
  },
  {
    job: "finalize",
    title: "Finalize",
    text: "Re-fetch finished weeks, recompute records and refresh caches.",
    seasonal: true,
  },
  {
    job: "nfl-reference",
    title: "NFL reference",
    text: "Bye weeks, NFL schedule and weekly rosters.",
    seasonal: false,
  },
  {
    job: "season-rollover",
    title: "Look for new seasons",
    text: "Find league seasons Sleeper created since the newest one.",
    seasonal: false,
  },
  {
    job: "recompute",
    title: "Recompute",
    text: "Rebuild derived data from the stored raw data (applies corrections).",
    seasonal: true,
  },
];

function RunLog({ run }: { run: (typeof runsSchema)["_output"]["runs"][number] }) {
  const [opened, { open, close }] = useDisclosure(false);
  return (
    <>
      <Button size="compact-xs" variant="subtle" onClick={open}>
        Details
      </Button>
      <Modal
        opened={opened}
        onClose={close}
        title={`${run.kind} · ${shortDate(run.startedAt)}`}
        size="lg"
      >
        <Stack>
          <Text size="sm">
            Triggered by: {run.triggeredBy === "schedule" ? "the schedule" : run.triggeredBy}
          </Text>
          {run.stats && <Code block>{JSON.stringify(run.stats, null, 2)}</Code>}
          {run.log && <Code block>{run.log}</Code>}
          {!run.stats && !run.log && <Text c="dimmed">No details recorded.</Text>}
        </Stack>
      </Modal>
    </>
  );
}

export default function JobsPage() {
  const leagues = useQuery(adminQuery(["leagues"], "/leagues", adminLeaguesSchema));
  const [season, setSeason] = useState<string | null>("all");
  const [status, setStatus] = useState<string | null>(null);
  const runs = useQuery({
    ...adminQuery(
      ["runs", status],
      `/jobs/runs?limit=50${status ? `&status=${status}` : ""}`,
      runsSchema
    ),
    refetchInterval: 10_000,
  });
  const run = useAdminMutation(
    (job: string) =>
      adminRequest(
        "POST",
        `/jobs/${job}`,
        okSchema,
        season && season !== "all" ? { leagueSeasonId: Number(season) } : {}
      ),
    { success: "Queued. It shows below when the worker picks it up.", invalidate: [["runs"]] }
  );
  const seasons = (leagues.data?.leagues ?? []).flatMap((l) =>
    l.seasons.map((s) => ({ value: String(s.id), label: `${l.name} ${s.year}` }))
  );
  return (
    <>
      <PageHeader title="Data jobs">Run an import by hand and see what ran on its own.</PageHeader>
      <Panel title="Run now">
        <Select
          label="Season (for the jobs that take one)"
          w={260}
          allowDeselect={false}
          data={[{ value: "all", label: "All active seasons" }, ...seasons]}
          value={season}
          onChange={setSeason}
        />
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} mt="xs">
          {JOBS.map((j) => (
            <Card key={j.job} withBorder padding="sm">
              <Stack gap="xs" h="100%" justify="space-between">
                <div>
                  <Text fw={600}>{j.title}</Text>
                  <Text size="sm" c="dimmed">
                    {j.text}
                  </Text>
                </div>
                <Button
                  size="xs"
                  variant="light"
                  loading={run.isPending && run.variables === j.job}
                  onClick={() => run.mutate(j.job)}
                >
                  Run {j.seasonal && season !== "all" ? "for this season" : ""}
                </Button>
              </Stack>
            </Card>
          ))}
        </SimpleGrid>
      </Panel>
      <Panel title="History">
        <Group>
          <Select
            aria-label="Status"
            placeholder="Any status"
            clearable
            w={160}
            data={["success", "failed", "running", "queued"]}
            value={status}
            onChange={setStatus}
          />
        </Group>
        <Loaded query={runs}>
          {(d) => (
            <AdminTable minWidth={680}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Job</Table.Th>
                  <Table.Th>Season</Table.Th>
                  <Table.Th>Started</Table.Th>
                  <Table.Th>Took</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {d.runs.map((r) => (
                  <Table.Tr key={r.id}>
                    <Table.Td>{r.kind}</Table.Td>
                    <Table.Td>{r.league ? `${r.league} ${r.year}` : "all"}</Table.Td>
                    <Table.Td>{shortDate(r.startedAt)}</Table.Td>
                    <Table.Td>
                      {r.finishedAt
                        ? `${Math.max(1, Math.round((Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / 1000))}s`
                        : "–"}
                    </Table.Td>
                    <Table.Td>
                      <Badge color={STATUS_COLOR[r.status] ?? "gray"} variant="light">
                        {r.status}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <RunLog run={r} />
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
