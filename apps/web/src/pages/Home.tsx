import { Stack, Text, Title } from "@mantine/core";
import { useSearchParams } from "react-router";
import { BlogPosts } from "../components/home/BlogPosts";
import { SeasonRecap } from "../components/home/SeasonRecap";
import { InSeasonSnapshot } from "../components/home/Snapshot";
import { seasonLabel } from "../lib/format";
import { useLeague } from "../lib/league-context";

/**
 * In season: standings, this week's matchups, recent transactions and (when the latest week set any) the records it
 * broke. A finished season (the latest one in the off season, or an older one picked in the navbar) shows its recap.
 * Blog posts follow the latest season only.
 */
export default function Home() {
  const { league, latestSeason } = useLeague();
  const [search] = useSearchParams();
  const picked = Number(search.get("season"));
  const season = league.seasons.find((s) => s.year === picked) ?? latestSeason;
  const inSeason = season.status === "in_season";

  return (
    <Stack gap={40}>
      <Stack gap="sm" component="section" aria-labelledby="h-snapshot">
        {inSeason ? (
          <>
            <Title order={2} id="h-snapshot">
              {seasonLabel(season.year)} season
            </Title>
            <InSeasonSnapshot seasonId={season.id} />
          </>
        ) : season.status === "complete" ? (
          <SeasonRecap seasonId={season.id} year={season.year} />
        ) : (
          <>
            <Title order={2} id="h-snapshot">
              {seasonLabel(season.year)} season
            </Title>
            <Text c="dimmed">This season hasn't started yet.</Text>
          </>
        )}
      </Stack>
      {season.year === latestSeason.year && <BlogPosts />}
    </Stack>
  );
}
