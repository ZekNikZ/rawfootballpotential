import {
  Badge,
  Button,
  Card,
  Group,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { DATA_FLAGS, leaguePatch, seasonAdd } from "@rfp/core/admin";
import { useQuery } from "@tanstack/react-query";
import { adminQuery, adminRequest, useAdminMutation, zodValidate } from "./api";
import { adminLeaguesSchema, okSchema, type AdminLeague } from "./schemas";
import { AdminTable, Loaded, Notice, PageHeader, Panel } from "./ui";

const key = [["leagues"]];
const FLAG_LABEL: Record<string, string> = {
  hasPlayerData: "Player data",
  hasProjections: "Projections",
  hasTransactions: "Transactions",
  hasDraft: "Draft",
  hasFaab: "FAAB",
  hasAuctionDraft: "Auction draft",
};
const COLORS = ["blue", "red", "green", "grape", "orange", "teal"];

function LeagueForm({ league }: { league: AdminLeague }) {
  const form = useForm({
    initialValues: {
      name: league.name,
      slug: league.slug,
      color: league.color,
      displayOrder: league.displayOrder,
    },
    validate: zodValidate(leaguePatch),
  });
  const save = useAdminMutation(
    (v: typeof form.values) => adminRequest("PATCH", `/leagues/${league.id}`, okSchema, v),
    { success: "League saved", invalidate: key }
  );
  const toggle = useAdminMutation(
    (enabled: boolean) => adminRequest("PATCH", `/leagues/${league.id}`, okSchema, { enabled }),
    { success: "League updated", invalidate: key }
  );
  return (
    <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
      <Group align="flex-end" wrap="wrap">
        <TextInput label="Name" w={160} {...form.getInputProps("name")} />
        <TextInput label="Slug (URL)" w={140} {...form.getInputProps("slug")} />
        <Select
          label="Color"
          w={110}
          data={COLORS}
          {...form.getInputProps("color")}
          allowDeselect={false}
        />
        <NumberInput label="Order" w={80} min={0} {...form.getInputProps("displayOrder")} />
        <Button type="submit" loading={save.isPending}>
          Save
        </Button>
        <Switch
          label="Shown on the site"
          checked={league.enabled}
          onChange={(e) => toggle.mutate(e.currentTarget.checked)}
          pb={6}
        />
      </Group>
    </form>
  );
}

function SeasonRow({ s }: { s: AdminLeague["seasons"][number] }) {
  const patch = useAdminMutation(
    (body: unknown) => adminRequest("PATCH", `/seasons/${s.id}`, okSchema, body),
    { success: "Season updated", invalidate: key }
  );
  const state = (flag: string) =>
    s.lockedFlags.includes(flag) ? (s.flags[flag] ? "on" : "off") : "auto";
  return (
    <Table.Tr>
      <Table.Td>
        <Text fw={600}>{s.year}</Text>
        <Text size="xs" c="dimmed">
          {s.source} · {s.status}
        </Text>
      </Table.Td>
      <Table.Td>
        <Switch
          aria-label={`Season ${s.year} enabled`}
          checked={s.enabled}
          onChange={(e) => patch.mutate({ enabled: e.currentTarget.checked })}
        />
      </Table.Td>
      {DATA_FLAGS.map((f) => (
        <Table.Td key={f}>
          <SegmentedControl
            size="xs"
            aria-label={`${FLAG_LABEL[f]} for ${s.year}`}
            value={state(f)}
            data={[
              { value: "auto", label: s.flags[f] ? "auto ✓" : "auto ✗" },
              { value: "on", label: "on" },
              { value: "off", label: "off" },
            ]}
            onChange={(v) => patch.mutate({ flags: { [f]: v === "auto" ? null : v === "on" } })}
          />
        </Table.Td>
      ))}
    </Table.Tr>
  );
}

function AddSeason({ leagues }: { leagues: AdminLeague[] }) {
  const form = useForm({
    initialValues: { leagueId: leagues[0]?.id ? String(leagues[0].id) : "", externalId: "" },
    validate: (v) =>
      zodValidate(seasonAdd)({
        leagueId: Number(v.leagueId),
        source: "sleeper",
        externalId: v.externalId,
      }),
  });
  const add = useAdminMutation(
    (v: typeof form.values) =>
      adminRequest("POST", "/seasons", okSchema, {
        leagueId: Number(v.leagueId),
        source: "sleeper",
        externalId: v.externalId,
      }),
    {
      success: "Queued. The season appears once the ingest worker has fetched it.",
      invalidate: key,
      onDone: () => form.reset(),
    }
  );
  return (
    <form onSubmit={form.onSubmit((v) => add.mutate(v))}>
      <Group align="flex-end" wrap="wrap">
        <Select
          label="League"
          w={180}
          data={leagues.map((l) => ({ value: String(l.id), label: l.name }))}
          allowDeselect={false}
          {...form.getInputProps("leagueId")}
        />
        <TextInput label="Sleeper league id" w={220} {...form.getInputProps("externalId")} />
        <Button type="submit" loading={add.isPending}>
          Add season
        </Button>
      </Group>
    </form>
  );
}

export default function LeaguesPage() {
  const q = useQuery(adminQuery(["leagues"], "/leagues", adminLeaguesSchema));
  return (
    <>
      <PageHeader title="Leagues & seasons">
        Names, colors and which seasons feed the site.
      </PageHeader>
      <Notice>
        Data flags decide which records can use a season. <b>auto</b> follows what the importer
        detects (✓ = has it now); <b>on</b> / <b>off</b> lock the value so an import never changes
        it.
      </Notice>
      <Loaded query={q}>
        {(d) => (
          <>
            {d.leagues.map((l) => (
              <Panel key={l.id} title={l.name}>
                <Card withBorder padding="sm" mb="xs">
                  <LeagueForm league={l} />
                </Card>
                <AdminTable minWidth={980}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Season</Table.Th>
                      <Table.Th>Enabled</Table.Th>
                      {DATA_FLAGS.map((f) => (
                        <Table.Th key={f}>{FLAG_LABEL[f]}</Table.Th>
                      ))}
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {l.seasons.map((s) => (
                      <SeasonRow key={s.id} s={s} />
                    ))}
                  </Table.Tbody>
                </AdminTable>
                {l.seasons.some((s) => s.scoringOverrides.length > 0) && (
                  <Stack gap={2}>
                    {l.seasons
                      .filter((s) => s.scoringOverrides.length > 0)
                      .map((s) => (
                        <Group key={s.id} gap="xs">
                          <Badge variant="light">{s.year}</Badge>
                          <Text size="sm">
                            As-played scoring:{" "}
                            {s.scoringOverrides
                              .map(
                                (o) =>
                                  `${o.stat} ${o.points}${o.toWeek ? ` (to week ${o.toWeek})` : ""}`
                              )
                              .join(", ")}
                          </Text>
                        </Group>
                      ))}
                  </Stack>
                )}
              </Panel>
            ))}
            <Panel title="Add a Sleeper season">
              <AddSeason leagues={d.leagues} />
            </Panel>
          </>
        )}
      </Loaded>
    </>
  );
}
