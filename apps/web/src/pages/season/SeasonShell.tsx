import { Stack, Text, Title } from "@mantine/core";
import { useParams } from "react-router";
import type { Season } from "../../api/schemas";
import { EmptyState } from "../../components/QueryState";
import { seasonLabel } from "../../lib/format";
import { useLeague } from "../../lib/league-context";
import NotFound from "../NotFound";

type Needs = keyof Season["data"];

/**
 * Resolves `:season` (a year) to the league's season, titles the page, and says so plainly when the season has no
 * data of the kind the page shows (the 2020/2021 ESPN seasons have scores but no transactions or drafts).
 */
export function SeasonShell({
  title,
  needs,
  children,
}: {
  title: string;
  needs?: Needs;
  children: (season: Season) => React.ReactNode;
}) {
  const { league } = useLeague();
  const year = Number(useParams().season);
  const season = league.seasons.find((s) => s.year === year);
  if (!season) return <NotFound />;
  return (
    <Stack gap="md">
      <Stack gap={0}>
        <Title order={1}>{title}</Title>
        <Text c="dimmed">
          {league.name} · {seasonLabel(season.year)}
          {season.status !== "complete" && " · in progress"}
        </Text>
      </Stack>
      {needs && !season.data[needs] ? (
        <EmptyState>
          {seasonLabel(season.year)} has no {NEEDS_LABEL[needs]} data. It was played before the
          league moved to Sleeper.
        </EmptyState>
      ) : (
        children(season)
      )}
    </Stack>
  );
}

const NEEDS_LABEL: Record<Needs, string> = {
  playerData: "lineup",
  projections: "projection",
  transactions: "transaction",
  draft: "draft",
  faab: "FAAB",
  auctionDraft: "auction draft",
};
