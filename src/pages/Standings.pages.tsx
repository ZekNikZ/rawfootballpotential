import { Avatar, Group, Stack, Table, Title } from '@mantine/core';
import { useAppSelector } from '../data/hooks';

export function StandingsPage() {
  const league = useAppSelector(
    (state) => state.league.data?.leagues[state.league.data.currentLeague]
  );

  if (!league) {
    return <></>;
  }

  const data = {
    head: ['Pos', 'Team', 'W', 'L', 'T', 'Streak', 'Waiver', 'PF', 'PA', 'Max PF'],
    body: [
      ...Object.values(league.teams)
        .toSorted((a, b) => {
          if (a.wins !== b.wins) {
            return b.wins - a.wins;
          }
          return b.overallPointsFor - a.overallPointsFor;
        })
        .entries(),
    ].map(([i, team]) => [
      i + 1,
      <Group gap="xs" key={team.name}>
        <Avatar src={team.avatarURL} />
        <Stack gap={0}>
          <b>{team.name}</b>
          <em>{league.currentManagers[team.managerId].displayName}</em>
        </Stack>
      </Group>,
      team.wins,
      team.losses,
      team.ties,
      team.streak,
      league.waiverType === 'faab'
        ? `$${(league.waiverMaxBudget ?? 100) - team.waiverBudgetUsed}`
        : team.waiverPosition,
      team.overallPointsFor.toFixed(2),
      team.overallPointsAgainst.toFixed(2),
      team.overallMaxPoints.toFixed(2),
      team.division,
    ]),
    divisionHead: [
      'Pos',
      'Team',
      'W',
      'L',
      'T',
      'Streak',
      'Div W',
      'Div L',
      'Div T',
      'Div Streak',
      'PF',
      'PA',
      'Max PF',
    ],
    divisionBody: [
      ...Object.values(league.teams)
        .toSorted((a, b) => {
          if (a.wins !== b.wins) {
            return b.wins - a.wins;
          }
          return b.overallPointsFor - a.overallPointsFor;
        })
        .entries(),
    ].map(([i, team]) => [
      i + 1,
      <Group gap="xs" key={team.name}>
        <Avatar src={team.avatarURL} />
        <Stack gap={0}>
          <b>{team.name}</b>
          <em>{league.currentManagers[team.managerId].displayName}</em>
        </Stack>
      </Group>,
      team.wins,
      team.losses,
      team.ties,
      team.streak,
      'TODO',
      'TODO',
      'TODO',
      'TODO',
      team.overallPointsFor.toFixed(2),
      team.overallPointsAgainst.toFixed(2),
      team.overallMaxPoints.toFixed(2),
      team.division,
    ]),
  };

  return (
    <Stack gap="md">
      <Title>{league.year} Standings</Title>
      <Table.ScrollContainer minWidth={800}>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              {data.head.map((th) => (
                <Table.Th>{th}</Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {[...data.body.entries()].map(([i, row]) => (
              <Table.Tr
                style={
                  i === league.playoffSpots - 1
                    ? {
                        borderBottomWidth: 5,
                      }
                    : undefined
                }
              >
                {row.slice(0, -1).map((td) => (
                  <Table.Td>{td}</Table.Td>
                ))}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {league.divisions && (
        <>
          <Title>{league.year} Standings By Division</Title>
          {[...league.divisions.entries()].map(([i, name]) => (
            <Stack gap="sm">
              <Group>
                <Avatar src={league.divisionAvatars?.[i]} />
                <Title order={2} ta="center">
                  {name}
                </Title>
              </Group>
              <Table.ScrollContainer minWidth={1000}>
                <Table striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      {data.divisionHead.map((th) => (
                        <Table.Th>{th}</Table.Th>
                      ))}
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {[
                      ...data.divisionBody.filter((row) => row[row.length - 1] === i + 1).entries(),
                    ].map(([j, row]) => (
                      <Table.Tr>
                        {[j + 1, ...row.slice(1, -1)].map((td) => (
                          <Table.Td>{td}</Table.Td>
                        ))}
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Stack>
          ))}
        </>
      )}
    </Stack>
  );
}
