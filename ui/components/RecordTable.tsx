import { Group, SegmentedControl, Stack, Table, Text } from "@mantine/core";
import { BaseRecordEntry, LeagueId, Record, RecordColumn } from "../../types";
import formatter from "format-number";
import { useMemo, useState } from "react";
import _ from "lodash";
import { useGlobalData } from "../providers";

interface Props<T extends BaseRecordEntry> {
  record: Record<T>;
}

function makeCell<T>(column: RecordColumn<T>, value: unknown): React.ReactNode {
  switch (column.type) {
    case "string":
      return `${value}`;
    case "number":
      return formatter({ round: column.decimalPrecision, padRight: column.decimalPrecision })(
        value as never,
        {}
      );
    case "currency":
      return formatter({
        prefix: "$",
        round: column.decimalPrecision,
        padRight: column.decimalPrecision,
      })(value as never, {});
    case "percentage":
      return formatter({
        suffix: "%",
        round: column.decimalPrecision,
        padRight: column.decimalPrecision,
      })((value as number) * 100, {});
  }
}

function RecordTable<T extends BaseRecordEntry>(props: Props<T>) {
  const { config } = useGlobalData();
  const { record } = props;

  const leagues = useMemo(() => {
    const usedLeagues = _.uniq(record.entries.map((x) => x.league)).filter((l) => !!l);
    return config!.leagues
      .flatMap((x) => x.years.map((y) => y))
      .filter((y) => usedLeagues.includes(y.leagueId))
      .sort((a, b) => a.year - b.year);
  }, [record.entries, config]);
  const [league, setLeague] = useState<LeagueId | "all">("all");

  const scopes = useMemo(() => {
    return _.uniq(record.entries.map((x) => x.scope))
      .filter((s) => !!s)
      .sort((a, b) => a.localeCompare(b));
  }, [record.entries]);
  const [scope, setScope] = useState<Exclude<BaseRecordEntry["scope"], null> | "all">("all");

  const entries = useMemo(() => {
    let res = record.entries;
    if (league !== "all") {
      res = res.filter((entry) => entry.league === league);
    }
    if (scope !== "all") {
      res = res.filter((entry) => entry.scope === scope);
    }
    if (record.maxEntries) {
      res = _.take(res, record.maxEntries);
    }
    return res;
  }, [record.entries, record.maxEntries, league, scope]);

  return (
    <Stack gap={10}>
      {(leagues.length >= 2 || scopes.length >= 2) && (
        <Group gap={20}>
          {leagues.length >= 2 && (
            <Stack gap={0}>
              <Text>Season</Text>
              <SegmentedControl
                data={[
                  {
                    label: "All",
                    value: "all",
                  },
                ].concat(
                  leagues.map((league) => ({
                    label: `${league.year}`,
                    value: league.leagueId,
                  }))
                )}
                value={league}
                onChange={(value) => setLeague(value as never)}
              />
            </Stack>
          )}
          {scopes.length >= 2 && (
            <Stack gap={0}>
              <Text>Time</Text>
              <SegmentedControl
                data={[
                  {
                    label: "Both",
                    value: "all",
                  },
                ].concat(
                  scopes.map((league) => ({
                    label: league === "in-season" ? "Regular Season" : "Playoffs",
                    value: league,
                  }))
                )}
                value={scope}
                onChange={(value) => setScope(value as never)}
              />
            </Stack>
          )}
        </Group>
      )}
      <Table striped highlightOnHover withTableBorder>
        <Table.Caption>Data available from {record.dataAvailableFromYear}</Table.Caption>
        <Table.Thead>
          <Table.Tr>
            {record.columns.map((col) => (
              <Table.Th key={col.key as string}>{col.title}</Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {entries.map((entry) => (
            <Table.Tr key={entry[record.keyField] as string}>
              {record.columns.map((col) => (
                <Table.Td key={col.key as string}>{makeCell(col, entry[col.key])}</Table.Td>
              ))}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}

export default RecordTable;
