import { useState } from 'react';
import { Paper, Stack, Box, Grid, Flex, Avatar, ActionIcon, Text, Collapse } from '@mantine/core';
import { League, Matchup, PreviousSeason } from '../../data/types';
import { useAppSelector } from '../../data/hooks';

interface Props {
  matchup: Matchup;
  league: League | PreviousSeason;
}

export function MatchupListing({ matchup, league }: Props) {
  const nflData = useAppSelector((state) => state.nfl.data);

  const [showingPlayerData, setShowingPlayerData] = useState(false);

  const isTeam1Winner =
    matchup.team1.points > (typeof matchup.team2 === 'object' ? matchup.team2.points : 0);

  const winColor = ((league as League).currentWeek ?? -1) > matchup.week ? 'green.3' : 'green.1';
  const loseColor = ((league as League).currentWeek ?? -1) > matchup.week ? 'red.3' : 'red.1';

  return (
    <Paper withBorder shadow="xs" maw={1000} radius="sm" style={{ overflow: 'hidden' }}>
      <Stack gap={0}>
        <Box
          pos="relative"
          style={{ cursor: 'pointer' }}
          onClick={() => setShowingPlayerData(!showingPlayerData)}
        >
          <Grid>
            <Grid.Col span={6} pr={0}>
              <Flex
                align="center"
                gap="xs"
                bg={isTeam1Winner ? winColor : loseColor}
                p="sm"
                pr={25}
              >
                <Avatar
                  size="md"
                  variant="filled"
                  src={league.teams[matchup.team1.rosterId - 1].avatarURL}
                />
                <Stack gap={0} style={{ flexGrow: 1, overflow: 'hidden' }}>
                  <Text
                    fw="bold"
                    style={{
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                    }}
                  >
                    {league.teams[matchup.team1.rosterId - 1].name}
                  </Text>
                  <Text fs="italic">
                    {
                      league.currentManagers[league.teams[matchup.team1.rosterId - 1]?.managerId]
                        .displayName
                    }
                  </Text>
                </Stack>
                <Text fz="1.5em" fw={isTeam1Winner ? 'bold' : 'normal'}>
                  {matchup.team1.points.toFixed(2)}
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
                    <Avatar
                      size="md"
                      variant="filled"
                      src={league.teams[matchup.team2.rosterId - 1].avatarURL}
                    />
                    <Stack gap={0} style={{ flexGrow: 1, overflow: 'hidden' }}>
                      <Text
                        ta="right"
                        fw="bold"
                        style={{
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                        }}
                      >
                        {league.teams[matchup.team2.rosterId - 1].name}
                      </Text>
                      <Text ta="right" fs="italic">
                        {league.currentManagers[
                          league.teams[matchup.team2.rosterId - 1]?.managerId
                        ].displayName.replaceAll(' ', '&nbsp;')}
                      </Text>
                    </Stack>
                    <Text fz="1.5em" fw={!isTeam1Winner ? 'bold' : 'normal'}>
                      {matchup.team2.points.toFixed(2)}
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
        <Collapse in={showingPlayerData}>
          {league.rosterPositions
            ?.filter((x) => x !== 'BN')
            ?.map((pos, i) => (
              <Box key={`${pos}-${i}`} pos="relative">
                <Grid>
                  <Grid.Col span={6} p={0} pr={0}>
                    <Flex align="center" gap="xs" p="sm" pr={25}>
                      {matchup.team1.starters[i] !== '0' && (
                        <Avatar
                          radius={0}
                          size="md"
                          variant="filled"
                          src={nflData?.players[matchup.team1.starters[i]].avatarURL}
                        />
                      )}
                      <Text
                        fs={matchup.team1.starters[i] === '0' ? 'italic' : undefined}
                        style={{
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          flexGrow: 1,
                        }}
                      >
                        {matchup.team1.starters[i] !== '0'
                          ? nflData?.players[matchup.team1.starters[i]].fullName
                          : 'Empty'}
                      </Text>
                      {matchup.team1.starters[i] !== '0' && (
                        <Text>
                          {matchup.team1.playerPoints[matchup.team1.starters[i]].toFixed(2)}
                        </Text>
                      )}
                    </Flex>
                  </Grid.Col>
                  <Grid.Col span={6} p={0} pl={0}>
                    <Flex align="center" gap="xs" direction="row-reverse" p="sm" pl={25}>
                      {typeof matchup.team2 === 'object' && (
                        <>
                          {matchup.team2.starters[i] !== '0' && (
                            <Avatar
                              radius={0}
                              size="md"
                              variant="filled"
                              src={nflData?.players[matchup.team2.starters[i]].avatarURL}
                            />
                          )}
                          <Text
                            ta="right"
                            fs={matchup.team2.starters[i] === '0' ? 'italic' : undefined}
                            style={{
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              flexGrow: 1,
                            }}
                          >
                            {matchup.team2.starters[i] !== '0'
                              ? nflData?.players[matchup.team2.starters[i]].fullName
                              : 'Empty'}
                          </Text>
                          {matchup.team2.starters[i] !== '0' && (
                            <Text>
                              {matchup.team2.playerPoints[matchup.team2.starters[i]]?.toFixed(2)}
                            </Text>
                          )}
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
                  style={{
                    flexGrow: 0,
                    left: '50%',
                    top: '50%',
                    transform: 'translate(-50%, -50%)',
                  }}
                >
                  {pos}
                </ActionIcon>
              </Box>
            ))}
        </Collapse>
      </Stack>
    </Paper>
  );
}
