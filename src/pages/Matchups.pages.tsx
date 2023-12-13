import { useState } from 'react';
import {
  Flex,
  SegmentedControl,
  Stack,
  Title,
  Text,
  Button,
  SimpleGrid,
  Card,
  Space,
} from '@mantine/core';
import { IconArrowLeft, IconArrowRight } from '@tabler/icons-react';
import _ from 'lodash';
import { useAppSelector } from '../data/hooks';
import { MatchupListing } from '../components/MatchupListing/MatchupListing';
import { Bracket, League } from '../data/types';
import { ordinal } from '../utils/ordinal';

const TIMINGS = {
  'regular-season': 'Regular Season',
  playoffs: 'Playoffs',
} as const;

function MatchupList({
  league,
  regularSeasonWeek: currentWeek,
}: {
  league: League;
  regularSeasonWeek: number;
}) {
  return (
    <>
      {league.matchups
        .filter((m) => m.week === currentWeek)
        .map((matchup) => (
          <MatchupListing key={matchup.matchupId} matchup={matchup} league={league} />
        ))}
      {currentWeek === league.currentWeek && (
        <Text style={{ fontStyle: 'italic' }}>Scores not yet finalized for this week.</Text>
      )}
      {currentWeek > league.currentWeek && (
        <Text style={{ fontStyle: 'italic' }}>
          This is a future week.{' '}
          {currentWeek >= league.playoffWeekStart &&
            currentWeek > league.currentWeek &&
            'These specific matches still are yet to be determined.'}
        </Text>
      )}
    </>
  );
}

function BracketDisplay({
  title,
  league,
  bracket: { matches },
  reversePlacements,
}: {
  title: string;
  league: League;
  bracket: Bracket;
  reversePlacements?: boolean;
}) {
  const numRounds = _.maxBy(matches, (m) => m.round)?.round ?? 1;

  return (
    <>
      <Title order={2} ta={{ base: 'center', sm: 'left' }}>
        {title}
      </Title>
      <SimpleGrid cols={numRounds} maw={1000}>
        {_.range(1, numRounds + 1).map((round) => (
          <Stack key={round}>
            <Title order={4} ta="center">
              Round {round}
            </Title>

            {matches
              .filter((m) => m.round === round)
              .map((match) => (
                <Card key={match.matchupId} shadow="sm" padding="lg" radius="md" withBorder>
                  <Text
                    style={{
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                    }}
                  >
                    {match.team1.source === 'determined'
                      ? league.teams[match.team1.rosterId - 1].name
                      : 'TBD'}
                  </Text>
                  <Text
                    style={{
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                    }}
                  >
                    {match.team2.source === 'determined'
                      ? league.teams[match.team2.rosterId - 1].name
                      : match.team2.source === 'BYE'
                      ? 'BYE'
                      : 'TBD'}
                  </Text>
                  {match.determinesPlacement && (
                    <Text fs="italic">
                      Determines{' '}
                      {ordinal(
                        reversePlacements
                          ? league.teamCount - match.determinesPlacement
                          : match.determinesPlacement
                      )}
                      {' / '}
                      {ordinal(
                        reversePlacements
                          ? league.teamCount - match.determinesPlacement + 1
                          : match.determinesPlacement + 1
                      )}
                    </Text>
                  )}
                </Card>
              ))}
          </Stack>
        ))}
      </SimpleGrid>
    </>
  );
}

export function MatchupsPage() {
  const league = useAppSelector(
    (state) => state.league.data?.leagues[state.league.data.currentLeague]
  );

  const [timing, setTiming] = useState<keyof typeof TIMINGS>('regular-season');
  const [currentWeek, setCurrentWeek] = useState(1);

  if (!league) {
    return <></>;
  }

  return (
    <Stack gap="md">
      <Title ta={{ base: 'center', sm: 'left' }}>
        {league.year} Matchups (
        {currentWeek < league.playoffWeekStart
          ? `Week ${currentWeek}`
          : `Playoffs Round ${currentWeek - league.playoffWeekStart + 1}`}
        )
      </Title>
      <Flex direction={{ base: 'column', md: 'row' }} gap="sm" wrap="wrap">
        <SegmentedControl
          value={timing}
          onChange={(val) => {
            setTiming(val as any);
            if (val === 'playoffs' && currentWeek < league.playoffWeekStart) {
              setCurrentWeek(league.playoffWeekStart);
            } else if (val === 'regular-season' && currentWeek >= league.playoffWeekStart) {
              setCurrentWeek(1);
            }
          }}
          data={Object.entries(TIMINGS).map(([value, label]) => ({ value, label }))}
        />
        <SegmentedControl
          value={`${currentWeek}`}
          onChange={(val) => {
            const newWeek = parseInt(val, 10);
            setCurrentWeek(newWeek);
            if (timing === 'playoffs' && newWeek < league.playoffWeekStart) {
              setTiming('regular-season');
            } else if (timing === 'regular-season' && newWeek >= league.playoffWeekStart) {
              setTiming('playoffs');
            }
          }}
          data={_.range(1, league.totalWeekCount + 1).map((x) => ({
            value: `${x}`,
            label: x >= league.playoffWeekStart ? `R${x - league.playoffWeekStart + 1}` : `${x}`,
          }))}
        />
        <Button.Group>
          <Button
            variant="light"
            leftSection={<IconArrowLeft size={14} />}
            style={{ flexGrow: 1 }}
            onClick={() => {
              const newWeek = Math.max(currentWeek - 1, 1);
              setCurrentWeek(newWeek);
              if (timing === 'playoffs' && newWeek < league.playoffWeekStart) {
                setTiming('regular-season');
              }
            }}
          >
            Previous Week
          </Button>
          <Button
            variant="light"
            rightSection={<IconArrowRight size={14} />}
            style={{ flexGrow: 1 }}
            onClick={() => {
              const newWeek = Math.min(currentWeek + 1, league.totalWeekCount);
              setCurrentWeek(newWeek);
              if (timing === 'regular-season' && newWeek >= league.playoffWeekStart) {
                setTiming('playoffs');
              }
            }}
          >
            Next Week
          </Button>
        </Button.Group>
      </Flex>
      <MatchupList league={league} regularSeasonWeek={currentWeek} />
      {timing === 'playoffs' && league.winnersBracket && (
        <>
          <Space h="md" />
          <BracketDisplay
            title="🏆 Playoff Bracket 🏆"
            league={league}
            bracket={league.winnersBracket}
          />
        </>
      )}
      {timing === 'playoffs' && league.losersBracket && (
        <>
          <Space h="md" />
          <BracketDisplay
            title="💩 Toilet Bowl 💩"
            league={league}
            bracket={league.losersBracket}
            reversePlacements
          />
        </>
      )}
    </Stack>
  );
}
