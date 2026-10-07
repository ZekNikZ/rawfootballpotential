import { Anchor, Text } from "@mantine/core";
import { Link } from "react-router";
import type { Entities } from "../api/schemas";
import { useLeague } from "../lib/league-context";

/** "Team name (Manager)" for a team season, linking to the franchise profile. */
export function TeamLabel({
  entities,
  teamSeasonId,
  plain = false,
  hideManager = false,
}: {
  entities: Entities;
  teamSeasonId: number | null;
  plain?: boolean;
  hideManager?: boolean;
}) {
  const { league } = useLeague();
  const ts = teamSeasonId === null ? undefined : entities.teamSeasons[String(teamSeasonId)];
  if (!ts) return <Text span>Unknown team</Text>;
  const manager = ts.managerId === null ? null : entities.managers[String(ts.managerId)]?.name;
  return (
    <>
      {plain ? (
        <Text span>{ts.name}</Text>
      ) : (
        <Anchor component={Link} to={`/${league.slug}/franchises/${ts.franchiseId}`}>
          {ts.name}
        </Anchor>
      )}
      {manager && !hideManager && (
        <Text span c="dimmed" fz="sm">
          {" "}
          ({manager})
        </Text>
      )}
    </>
  );
}
