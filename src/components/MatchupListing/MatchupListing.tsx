import { Paper, Stack, Box, Grid, Flex, Avatar, ActionIcon, Text } from '@mantine/core';
import { League, Matchup, PreviousSeason } from '../../data/types';

interface Props {
  matchup: Matchup;
  league: League | PreviousSeason;
}

export function MatchupListing({ matchup, league }: Props) {
  const isTeam1Winner =
    matchup.team1.points > (typeof matchup.team2 === 'object' ? matchup.team2.points : 0);

  const winColor = ((league as League).currentWeek ?? -1) > matchup.week ? 'green.2' : 'green.1';
  const loseColor = ((league as League).currentWeek ?? -1) > matchup.week ? 'red.2' : 'red.1';

  return (
    <Paper withBorder shadow="xs" maw={1000} radius="sm" style={{ overflow: 'hidden' }}>
      <Stack>
        <Box pos="relative">
          <Grid>
            <Grid.Col span={6} pr={0}>
              <Flex
                align="center"
                gap="xs"
                bg={isTeam1Winner ? winColor : loseColor}
                p="sm"
                pr={25}
              >
                <Avatar src={league.teams[matchup.team1.rosterId - 1].avatarURL} />
                <Stack gap={0} style={{ flexGrow: 1 }}>
                  <b>{league.teams[matchup.team1.rosterId - 1].name}</b>
                  <em>
                    {
                      league.currentManagers[league.teams[matchup.team1.rosterId - 1]?.managerId]
                        .displayName
                    }
                  </em>
                </Stack>
                <Text style={{ fontWeight: isTeam1Winner ? 'bold' : 'normal' }}>
                  {matchup.team1.points}
                </Text>
              </Flex>
            </Grid.Col>
            <Grid.Col span={6} pl={0}>
              <Flex
                align="center"
                gap="xs"
                direction="row-reverse"
                bg={!isTeam1Winner ? winColor : loseColor}
                p="sm"
                pl={25}
              >
                {typeof matchup.team2 === 'object' && (
                  <>
                    <Avatar src={league.teams[matchup.team2.rosterId - 1].avatarURL} />
                    <Stack gap={0} style={{ flexGrow: 1 }}>
                      <b style={{ textAlign: 'right' }}>
                        {league.teams[matchup.team2.rosterId - 1].name}
                      </b>
                      <em style={{ textAlign: 'right' }}>
                        {
                          league.currentManagers[
                            league.teams[matchup.team2.rosterId - 1]?.managerId
                          ].displayName
                        }
                      </em>
                    </Stack>
                    <Text style={{ fontWeight: !isTeam1Winner ? 'bold' : 'normal' }}>
                      {matchup.team2.points}
                    </Text>
                  </>
                )}
                {typeof matchup.team2 === 'string' && (
                  <>
                    <Text ta="right" style={{ flexGrow: 1 }}>
                      {matchup.team2}
                    </Text>
                  </>
                )}
              </Flex>
            </Grid.Col>
          </Grid>
          <ActionIcon
            variant="default"
            pos="absolute"
            style={{ flexGrow: 0, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
          >
            VS
          </ActionIcon>
        </Box>
      </Stack>
    </Paper>
  );
}
