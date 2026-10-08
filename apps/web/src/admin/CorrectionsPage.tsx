import {
  Badge,
  Button,
  Card,
  Group,
  Modal,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  Textarea,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { GAME_TYPES } from "@rfp/core/admin";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { adminQuery, adminRequest, useAdminMutation } from "./api";
import {
  adminLeaguesSchema,
  franchisesSchema,
  matchupsSchema,
  okSchema,
  overridesSchema,
} from "./schemas";
import { AdminTable, Loaded, Notice, PageHeader, Panel, shortDate } from "./ui";

const okey = [["overrides"]];
type Kind = "score" | "placement" | "game_type";

const describe = (o: (typeof overridesSchema)["_output"]["overrides"][number]) => {
  switch (o.field) {
    case "points":
      return `Score of ${String(o.value)} for ${o.team ?? "a team"} in week ${o.week}`;
    case "final_place":
      return `Final place ${String(o.value)} for ${o.team ?? "a team"}`;
    case "game_type":
      return `Game ${o.externalMatchupId} in week ${o.week} counts as "${String(o.value)}"`;
    default:
      return `${o.entity}.${o.field} = ${JSON.stringify(o.value)}`;
  }
};

function DeactivateButton({ id }: { id: number }) {
  const [opened, { open, close }] = useDisclosure(false);
  const [reason, setReason] = useState("");
  const off = useAdminMutation(
    () => adminRequest("DELETE", `/overrides/${id}`, okSchema, { reason }),
    { success: "Correction removed; data is being recomputed", invalidate: okey, onDone: close }
  );
  return (
    <>
      <Button size="compact-xs" variant="subtle" color="red" onClick={open}>
        Remove
      </Button>
      <Modal opened={opened} onClose={close} title="Remove this correction">
        <Stack>
          <Text size="sm">
            The ingested value comes back the next time the season is recomputed (queued now).
          </Text>
          <Textarea
            label="Reason"
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
          />
          <Button
            color="red"
            disabled={reason.trim().length < 3}
            loading={off.isPending}
            onClick={() => off.mutate()}
          >
            Remove correction
          </Button>
        </Stack>
      </Modal>
    </>
  );
}

function CreateForm() {
  const leagues = useQuery(adminQuery(["leagues"], "/leagues", adminLeaguesSchema));
  const [kind, setKind] = useState<Kind>("score");
  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [team, setTeam] = useState<string | null>(null);
  const [week, setWeek] = useState<number | string>(1);
  const [points, setPoints] = useState<number | string>("");
  const [place, setPlace] = useState<number | string>(1);
  const [matchup, setMatchup] = useState<string | null>(null);
  const [gameType, setGameType] = useState<string | null>("none");
  const [reason, setReason] = useState("");

  const seasons = (leagues.data?.leagues ?? []).flatMap((l) =>
    l.seasons.map((s) => ({
      value: String(s.id),
      label: `${l.name} ${s.year} (${s.source})`,
      league: l.id,
    }))
  );
  const season = seasons.find((s) => s.value === seasonId);
  const franchises = useQuery({
    ...adminQuery(
      ["franchises", season?.league],
      `/franchises?leagueId=${season?.league}`,
      franchisesSchema
    ),
    enabled: season !== undefined,
  });
  const teams = (franchises.data?.franchises ?? [])
    .flatMap((f) => f.teamSeasons)
    .filter((t) => String(t.leagueSeasonId) === seasonId)
    .map((t) => ({ value: String(t.id), label: `${t.name} (${t.managers.join(", ")})` }));
  const games = useQuery({
    ...adminQuery(
      ["matchups", seasonId, week],
      `/matchups?leagueSeasonId=${seasonId}&week=${week}`,
      matchupsSchema
    ),
    enabled: kind === "game_type" && seasonId !== null && typeof week === "number",
  });

  const create = useAdminMutation(
    (body: unknown) => adminRequest("POST", "/overrides", okSchema, body),
    {
      success: "Saved. The season is being recomputed.",
      invalidate: okey,
      onDone: () => setReason(""),
    }
  );
  const submit = () => {
    if (kind === "score")
      create.mutate({
        kind,
        teamSeasonId: Number(team),
        week: Number(week),
        points: Number(points),
        reason,
      });
    else if (kind === "placement")
      create.mutate({ kind, teamSeasonId: Number(team), place: Number(place), reason });
    else
      create.mutate({
        kind,
        leagueSeasonId: Number(seasonId),
        week: Number(week),
        externalMatchupId: Number(matchup),
        gameType,
        reason,
      });
  };
  const ready =
    seasonId !== null &&
    reason.trim().length >= 3 &&
    (kind === "score"
      ? team !== null && points !== ""
      : kind === "placement"
        ? team !== null
        : matchup !== null);

  return (
    <Card withBorder padding="md">
      <Stack>
        <SegmentedControl
          aria-label="Kind of correction"
          value={kind}
          onChange={(v) => setKind(v as Kind)}
          data={[
            { value: "score", label: "A team's score" },
            { value: "placement", label: "Final placement" },
            { value: "game_type", label: "What a game counts as" },
          ]}
        />
        <Group align="flex-end" wrap="wrap">
          <Select
            label="Season"
            w={230}
            data={seasons}
            value={seasonId}
            onChange={(v) => {
              setSeasonId(v);
              setTeam(null);
              setMatchup(null);
            }}
          />
          {kind !== "game_type" && (
            <Select
              label="Team"
              w={280}
              data={teams}
              value={team}
              onChange={setTeam}
              disabled={!seasonId}
            />
          )}
          {kind !== "placement" && (
            <NumberInput label="Week" w={90} min={1} max={30} value={week} onChange={setWeek} />
          )}
          {kind === "score" && (
            <NumberInput
              label="Points"
              w={120}
              decimalScale={2}
              value={points}
              onChange={setPoints}
            />
          )}
          {kind === "placement" && (
            <NumberInput label="Final place" w={110} min={1} value={place} onChange={setPlace} />
          )}
          {kind === "game_type" && (
            <>
              <Select
                label="Game"
                w={330}
                data={(games.data?.games ?? []).map((g) => ({
                  value: String(g.externalMatchupId),
                  label: `${g.teams.map((t) => `${t.team} ${t.points}`).join(" vs ")} · ${g.gameType}`,
                }))}
                value={matchup}
                onChange={setMatchup}
                disabled={!games.data}
                placeholder={games.isFetching ? "Loading…" : "Pick the week first"}
              />
              <Select
                label="Counts as"
                w={150}
                data={[...GAME_TYPES]}
                value={gameType}
                onChange={setGameType}
                allowDeselect={false}
              />
            </>
          )}
        </Group>
        <Textarea
          label="Reason (required, shown in the audit log)"
          autosize
          minRows={2}
          value={reason}
          onChange={(e) => setReason(e.currentTarget.value)}
        />
        <Group>
          <Button disabled={!ready} loading={create.isPending} onClick={submit}>
            Apply correction
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}

export default function CorrectionsPage() {
  const [all, setAll] = useState(false);
  const q = useQuery(
    adminQuery(["overrides", all], `/overrides?active=${all ? "all" : "true"}`, overridesSchema)
  );
  return (
    <>
      <PageHeader title="Corrections">
        Fix a score, a final placement or what a game counts as. Corrections sit beside the imported
        data, so refreshing a season from Sleeper never undoes them.
      </PageHeader>
      <Notice>
        Score and game-type corrections apply to Sleeper seasons. ESPN seasons accept placements
        only, until their data is imported.
      </Notice>
      <Panel title="New correction">
        <CreateForm />
      </Panel>
      <Panel title="Corrections on file">
        <Switch
          label="Include removed ones"
          checked={all}
          onChange={(e) => setAll(e.currentTarget.checked)}
        />
        <Loaded query={q}>
          {(d) =>
            d.overrides.length === 0 ? (
              <Text c="dimmed">None yet.</Text>
            ) : (
              <AdminTable minWidth={760}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Season</Table.Th>
                    <Table.Th>Correction</Table.Th>
                    <Table.Th>Reason</Table.Th>
                    <Table.Th>Added</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {d.overrides.map((o) => (
                    <Table.Tr key={o.id} opacity={o.active ? 1 : 0.55}>
                      <Table.Td>{o.year ?? "–"}</Table.Td>
                      <Table.Td>{describe(o)}</Table.Td>
                      <Table.Td>{o.reason}</Table.Td>
                      <Table.Td>{shortDate(o.createdAt)}</Table.Td>
                      <Table.Td>
                        {o.active ? (
                          <DeactivateButton id={o.id} />
                        ) : (
                          <Badge variant="light" color="gray">
                            removed
                          </Badge>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </AdminTable>
            )
          }
        </Loaded>
      </Panel>
    </>
  );
}
