import { Title, Text } from "@mantine/core";
import classes from "./Home.page.module.css";
import { useCurrentLeague, useGlobalData } from "../providers";
import { useMemo } from "react";

export function HomePage() {
  const { config } = useGlobalData();
  const { leagueId } = useCurrentLeague();
  const currentLeagueData = useMemo(() => {
    return config!.leagues.find((league) =>
      league.years.find((year) => year.leagueId === leagueId)
    )!;
  }, [leagueId, config]);

  return (
    <>
      <Title className={classes.title} ta="center" mt={100}>
        🚧{" "}
        <Text inherit c={currentLeagueData.color} component="span">
          We're still working on this page.
        </Text>{" "}
        🚧
      </Title>
      <Text c="dimmed" ta="center" size="lg" maw={580} mx="auto" mt="xl">
        Check back soon to see exciting new features right here!
      </Text>
    </>
  );
}
