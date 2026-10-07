import {
  Accordion,
  Anchor,
  Avatar,
  Badge,
  Card,
  Group,
  SegmentedControl,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import { teamsQuery } from "../../api/queries";
import type { Season, Teams as TeamsData } from "../../api/schemas";
import { EmptyState, QueryError } from "../../components/QueryState";
import classes from "../../components/DataTable.module.css";
import { fmtDecimal } from "../../lib/format";
import { useLeague } from "../../lib/league-context";
import { SeasonShell } from "./SeasonShell";

type Team = TeamsData["teams"][number];

const managerOf = (data: TeamsData, t: Team) => {
  const ts = data.entities.teamSeasons[String(t.team_season_id)];
  return ts?.managerId == null
    ? null
    : (data.entities.managers[String(ts.managerId)]?.name ?? null);
};
const record = (t: Team) =>
  t.wins === null ? "–" : `${t.wins}-${t.losses ?? 0}${t.ties ? `-${t.ties}` : ""}`;

function SubNav({ season, active }: { season: Season; active: "teams" | "rosters" }) {
  const navigate = useNavigate();
  const { league } = useLeague();
  return (
    <SegmentedControl
      aria-label="Teams view"
      w="fit-content"
      value={active}
      onChange={(v) =>
        navigate(`/${league.slug}/${season.year}/teams${v === "rosters" ? "/rosters" : ""}`)
      }
      data={[
        { value: "teams", label: "Teams" },
        { value: "rosters", label: "Rosters" },
      ]}
    />
  );
}

function useTeams(season: Season, rosters: boolean) {
  return useQuery(teamsQuery(season.id, rosters));
}

function Loading() {
  return (
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} h={110} />
      ))}
    </SimpleGrid>
  );
}

function TeamCard({ team, data }: { team: Team; data: TeamsData }) {
  const { league } = useLeague();
  const manager = managerOf(data, team);
  return (
    <Card withBorder radius="sm" padding="sm">
      <Group wrap="nowrap" align="flex-start">
        <Avatar src={team.avatar} name={team.name} radius="sm" size={44} color="initials" />
        <Stack gap={0} miw={0}>
          <Anchor component={Link} to={`/${league.slug}/franchises/${team.franchise_id}`} fw={600}>
            {team.name}
          </Anchor>
          <Text size="sm" c="dimmed">
            {manager ?? "Unknown manager"}
          </Text>
          <Group gap={8} mt={4}>
            <Text size="sm" fw={600}>
              {record(team)}
            </Text>
            {team.pf !== null && (
              <Text size="sm" c="dimmed">
                {fmtDecimal(team.pf)} PF
              </Text>
            )}
            {team.rank !== null && (
              <Badge size="xs" variant="light">
                #{team.rank}
              </Badge>
            )}
          </Group>
        </Stack>
      </Group>
    </Card>
  );
}

function TeamsBody({ season }: { season: Season }) {
  const q = useTeams(season, false);
  if (q.isPending) return <Loading />;
  if (q.isError) return <QueryError error={q.error} onRetry={() => void q.refetch()} />;
  const data = q.data;
  if (data.teams.length === 0) return <EmptyState>No teams yet.</EmptyState>;
  const divisions = [...new Set(data.teams.map((t) => t.division ?? ""))].sort();
  return (
    <Stack gap="lg">
      <SubNav season={season} active="teams" />
      {divisions.map((d) => (
        <Stack key={d} gap="xs">
          {divisions.length > 1 && <Title order={2}>{d || "No division"}</Title>}
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
            {data.teams
              .filter((t) => (t.division ?? "") === d)
              .map((t) => (
                <TeamCard key={t.team_season_id} team={t} data={data} />
              ))}
          </SimpleGrid>
        </Stack>
      ))}
    </Stack>
  );
}

const POS_COLOR: Record<string, string> = {
  QB: "red",
  RB: "green",
  WR: "blue",
  TE: "orange",
  K: "grape",
  DEF: "gray",
};

function RostersBody({ season }: { season: Season }) {
  const q = useTeams(season, true);
  if (q.isPending) return <Loading />;
  if (q.isError) return <QueryError error={q.error} onRetry={() => void q.refetch()} />;
  const data = q.data;
  return (
    <Stack gap="md">
      <SubNav season={season} active="rosters" />
      <Accordion multiple variant="separated" radius="sm">
        {data.teams.map((t) => (
          <Accordion.Item key={t.team_season_id} value={String(t.team_season_id)}>
            <Accordion.Control>
              <Group gap="xs" wrap="nowrap">
                <Avatar src={t.avatar} name={t.name} size={28} radius="sm" color="initials" />
                <Text fw={600} truncate>
                  {t.name}
                </Text>
                <Text c="dimmed" size="sm" visibleFrom="xs" truncate>
                  {managerOf(data, t)} · {record(t)}
                </Text>
              </Group>
            </Accordion.Control>
            <Accordion.Panel>
              {(t.roster ?? []).length === 0 ? (
                <Text c="dimmed" size="sm">
                  No roster on file.
                </Text>
              ) : (
                <Table.ScrollContainer minWidth={420} type="native">
                  <Table className={classes.table} verticalSpacing={4}>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th w={60}>Slot</Table.Th>
                        <Table.Th>Player</Table.Th>
                        <Table.Th>NFL</Table.Th>
                        <Table.Th>Acquired</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {(t.roster ?? []).map((p) => (
                        <Table.Tr key={p.playerId}>
                          <Table.Td c="dimmed">
                            {p.slotKind === "starter"
                              ? p.slot
                              : p.slotKind === "bench"
                                ? "BN"
                                : p.slotKind.toUpperCase()}
                          </Table.Td>
                          <Table.Td>
                            {p.name}{" "}
                            {p.position && (
                              <Badge
                                size="xs"
                                variant="light"
                                color={POS_COLOR[p.position] ?? "gray"}
                              >
                                {p.position}
                              </Badge>
                            )}
                            {p.injuryStatus && (
                              <Badge ml={4} size="xs" variant="light" color="red">
                                {p.injuryStatus}
                              </Badge>
                            )}
                          </Table.Td>
                          <Table.Td>{p.nflTeam ?? "FA"}</Table.Td>
                          <Table.Td c="dimmed">{p.acquiredVia?.replace("_", " ") ?? "–"}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              )}
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
      <Text size="sm" c="dimmed">
        Rosters are as of the latest sync.
      </Text>
    </Stack>
  );
}

export default function Teams() {
  return <SeasonShell title="Teams">{(season) => <TeamsBody season={season} />}</SeasonShell>;
}

export function Rosters() {
  return (
    <SeasonShell title="Rosters" needs="playerData">
      {(season) => <RostersBody season={season} />}
    </SeasonShell>
  );
}
