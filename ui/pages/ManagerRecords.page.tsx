import { useMemo } from "react";
import RecordCategorySection from "../components/RecordCategorySection";
import { useCurrentLeague, useGlobalData } from "../providers";
import { Stack } from "@mantine/core";
import RecordTable from "../components/RecordTable";
import ManagerMatchupTable from "../components/ManagerMatchupTable";
import _ from "lodash";

function ManagerRecordsPage() {
  const { config, records, managerMatchups, leagues } = useGlobalData();
  const { leagueId } = useCurrentLeague();

  const filteredRecords = useMemo(() => {
    const league = config!.leagues.find(
      (league) => !!league.years.find((year) => year.leagueId === leagueId)
    )!;

    return (records[league.name] ?? []).filter((record) => record.category === "manager");
  }, [config, leagueId, records]);

  const managers = useMemo(() => {
    const league = config!.leagues.find(
      (league) => !!league.years.find((year) => year.leagueId === leagueId)
    )!;

    return _.uniqBy(
      league.years
        .map((year) => leagues[year.leagueId])
        .flatMap((league) => Object.values(league.managerData.managers)),
      (el) => el.managerId
    );
  }, [config, leagueId, leagues]);

  const managerMatchupData = useMemo(() => {
    const league = config!.leagues.find(
      (league) => !!league.years.find((year) => year.leagueId === leagueId)
    )!;

    return managerMatchups[league.name] || { dataAvailableFromYear: 9999, data: {} };
  }, [config, leagueId, managerMatchups]);

  return (
    <Stack gap={40}>
      {filteredRecords.map((record) =>
        record.type === "category" ? (
          <RecordCategorySection key={record.name} category={record} />
        ) : (
          <RecordTable key={record.name} record={record} />
        )
      )}

      <ManagerMatchupTable managers={managers} matchups={managerMatchupData} />
    </Stack>
  );
}

export default ManagerRecordsPage;
