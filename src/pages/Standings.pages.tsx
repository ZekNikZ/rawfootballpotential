import { SimpleGrid, Stack, Table, Title } from '@mantine/core';
import { useViewportSize } from '@mantine/hooks';
import { useAppSelector } from '../data/hooks';

export function StandingsPage() {
  const { width } = useViewportSize();

  const league = useAppSelector(
    (state) => state.league.data?.leagues[state.league.data.currentLeague]
  );

  if (!league) {
    return <></>;
  }

  const data = {
    head: ['Pos', 'Team', 'W-L-T', 'Waiver', 'PF', 'PA', 'Max PF'],
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
      `${team.name} (${league.managers[team.managerId].displayName})`,
      `${team.wins}-${team.losses}-${team.ties}`,
      league.waiverType === 'faab'
        ? `$${(league.waiverMaxBudget ?? 100) - team.waiverBudgetUsed}`
        : team.waiverPosition,
      team.overallPointsFor.toFixed(2),
      team.overallPointsAgainst.toFixed(2),
      team.overallMaxPoints.toFixed(2),
      team.division,
    ]),
  };

  return (
    <Stack gap="md">
      <Title>{league.year} Standings</Title>
      <Table.ScrollContainer minWidth={700}>
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
                        borderBottomWidth: 3,
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
          <SimpleGrid
            cols={(width - 250) / league.divisions.length > 450 ? league.divisions.length : 1}
          >
            {[...league.divisions.entries()].map(([i, name]) => (
              <Stack gap="sm">
                <Title order={2} ta="center">
                  {name}
                </Title>
                <Table.ScrollContainer minWidth={700}>
                  <Table striped highlightOnHover>
                    <Table.Thead>
                      <Table.Tr>
                        {data.head.map((th) => (
                          <Table.Th>{th}</Table.Th>
                        ))}
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {[...data.body.filter((row) => row[row.length - 1] === i + 1).entries()].map(
                        ([j, row]) => (
                          <Table.Tr>
                            {[j + 1, ...row.slice(1, -1)].map((td) => (
                              <Table.Td>{td}</Table.Td>
                            ))}
                          </Table.Tr>
                        )
                      )}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              </Stack>
            ))}
          </SimpleGrid>
        </>
      )}
    </Stack>
  );
}
