import { useMemo } from "react";
import RecordCategorySection from "../components/RecordCategorySection";
import { useCurrentLeague, useGlobalData } from "../providers";
import { Stack } from "@mantine/core";
import RecordTable from "../components/RecordTable";

function SingleSeasonRecordsPage() {
  const { config, records } = useGlobalData();
  const { leagueId } = useCurrentLeague();

  const filteredRecords = useMemo(() => {
    const league = config!.leagues.find(
      (league) => !!league.years.find((year) => year.leagueId === leagueId)
    )!;

    return (records[league.name] ?? []).filter((record) => record.category === "single-season");
  }, [config, leagueId, records]);

  return (
    <Stack gap={40}>
      {filteredRecords.map((record) =>
        record.type === "category" ? (
          <RecordCategorySection key={record.name} category={record} />
        ) : (
          <RecordTable key={record.name} record={record} />
        )
      )}
    </Stack>
  );
}

export default SingleSeasonRecordsPage;
