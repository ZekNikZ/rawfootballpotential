import { useState } from 'react';
import { Box, Center, Flex, SegmentedControl, Stack, Title, Text } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import _ from 'lodash';
import { useAppSelector } from '../data/hooks';
import { MatchupListing } from '../components/MatchupListing/MatchupListing';

const TIMINGS = {
  'regular-season': 'Regular Season',
  playoffs: 'Playoffs',
} as const;

export function MatchupsPage() {
  const isSmallScreen = !useMediaQuery('(min-width: 62em)');

  const league = useAppSelector(
    (state) => state.league.data?.leagues[state.league.data.currentLeague]
  );

  const [timing, setTiming] = useState<keyof typeof TIMINGS>('regular-season');
  const [regularSeasonWeek, setRegularSeasonWeek] = useState(1);

  if (!league) {
    return <></>;
  }

  return (
    <Stack gap="md">
      <Title>{league.year} Matchups</Title>
      <Flex direction={isSmallScreen ? 'column' : 'row'} gap="sm">
        <SegmentedControl
          value={timing}
          onChange={(val) => setTiming(val as any)}
          data={Object.entries(TIMINGS).map(([value, label]) => ({ value, label }))}
        />
        <SegmentedControl
          value={`${regularSeasonWeek}`}
          onChange={(val) => setRegularSeasonWeek(parseInt(val, 10))}
          disabled={timing !== 'regular-season'}
          data={_.range(1, league.playoffWeekStart).map((x) => ({
            value: `${x}`,
            label: (
              <Center>
                <Box w="md">{x}</Box>
              </Center>
            ),
          }))}
        />
      </Flex>
      {league.matchups
        .filter((m) => m.week === regularSeasonWeek)
        .map((matchup) => (
          <MatchupListing key={matchup.matchupId} matchup={matchup} league={league} />
        ))}
      {regularSeasonWeek === league.currentWeek && (
        <Text style={{ fontStyle: 'italic' }}>Scores not yet finalized for this week.</Text>
      )}
      {regularSeasonWeek > league.currentWeek && (
        <Text style={{ fontStyle: 'italic' }}>This is a future week.</Text>
      )}
    </Stack>
  );
}
