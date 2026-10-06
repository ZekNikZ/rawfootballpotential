import { Stack, Text, Title } from "@mantine/core";
import { useSearchParams } from "react-router";
import { BlogPosts } from "../components/home/BlogPosts";
import { FinalResults, InSeasonSnapshot } from "../components/home/Snapshot";
import { seasonLabel } from "../lib/format";
import { useLeague } from "../lib/league-context";

/**
 * In season: standings, this week's matchups and recent transactions. Off season (or an older season picked in the
 * navbar): that season's final results. Blog posts follow either way.
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
          <FinalResults seasonId={season.id} year={season.year} />
        ) : (
          <>
            <Title order={2} id="h-snapshot">
              {seasonLabel(season.year)} season
            </Title>
            <Text c="dimmed">This season hasn't started yet.</Text>
          </>
        )}
      </Stack>
      <BlogPosts />
    </Stack>
  );
}
