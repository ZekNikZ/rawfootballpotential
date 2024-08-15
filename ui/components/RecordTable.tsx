import {
  Group,
  MultiSelect,
  NativeSelect,
  Pagination,
  SegmentedControl,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { BaseRecordEntry, LeagueId, FantasyRecord, RecordColumn } from "../../types";
import formatter from "format-number";
import { useMemo, useState } from "react";
import _ from "lodash";
import { useGlobalData } from "../providers";

interface Props<T extends BaseRecordEntry> {
  record: FantasyRecord<T>;
}

function makeCell<T>(column: RecordColumn<T>, entry: T): React.ReactNode {
  const value = entry[column.key];

  let data: string;

  switch (column.type) {
    case "string":
      data = `${value}`;
      break;
    case "number":
      data = formatter({ round: column.decimalPrecision, padRight: column.decimalPrecision })(
        value as never,
        {}
      );
      break;
    case "currency":
      data = formatter({
        prefix: "$",
        round: column.decimalPrecision,
        padRight: column.decimalPrecision,
      })(value as never, {});
      break;
    case "percentage":
      data = formatter({
        suffix: "%",
        round: column.decimalPrecision,
        padRight: column.decimalPrecision,
      })((value as number) * 100, {});
      break;
  }

  if (column.hintKey && entry[column.hintKey]) {
    return (
      <Group gap={4}>
        {data}{" "}
        <Text fz={14} c="grey">
          ({`${entry[column.hintKey]}`})
        </Text>
      </Group>
    );
  } else {
    return data;
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
  const hasNullLeague = useMemo(
    () => record.entries.some((entry) => !entry.league),
    [record.entries]
  );
  const [league, setLeague] = useState<LeagueId | "all">("all");

  const scopes = useMemo(() => {
    return _.uniq(record.entries.map((x) => x.scope))
      .filter((s) => !!s)
      .sort((a, b) => a.localeCompare(b));
  }, [record.entries]);
  const hasNullScope = useMemo(
    () => record.entries.some((entry) => !entry.scope),
    [record.entries]
  );
  const [scope, setScope] = useState<Exclude<BaseRecordEntry["scope"], null> | "all">("all");

  const [numEntries, setMaxEntries] = useState(5);
  const [page, setPage] = useState(1);

  const entries = useMemo(() => {
    let res = record.entries;
    if (league !== "all") {
      res = res.filter((entry) => entry.league === league);
    } else if (hasNullLeague) {
      res = res.filter((entry) => !entry.league);
    }
    if (scope !== "all") {
      res = res.filter((entry) => entry.scope === scope);
    } else if (hasNullScope) {
      res = res.filter((entry) => !entry.scope);
    }
    return res;
  }, [record.entries, league, hasNullLeague, scope, hasNullScope]);

  const maxPages = useMemo(
    () => Math.ceil(entries.length / (numEntries ?? 1)),
    [numEntries, entries.length]
  );
  const entriesOnPage = useMemo(() => {
    let res = entries;
    if (!record.displayAll) {
      res = _.drop(res, (page - 1) * numEntries);
      res = _.take(res, numEntries);
    }
    return res;
  }, [entries, record.displayAll, page, numEntries]);

  return (
    <Stack gap={10}>
      <Group gap={20} style={{ rowGap: 5 }}>
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
              onChange={(value) => {
                setLeague(value as never);
                setPage(1);
              }}
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
                  label: league === "in-season" ? "Regular Season" : "Postseason",
                  value: league,
                }))
              )}
              value={scope}
              onChange={(value) => {
                setScope(value as never);
                setPage(1);
              }}
            />
          </Stack>
        )}
        {record.filters?.map((filter) => (
          <>
            <Stack gap={0}>
              <Text>{filter.label}</Text>
              <MultiSelect
                data={_.uniq(entries.map((entry) => `${entry[filter.key]}`))}
                searchable
                nothingFoundMessage="Nothing found..."
                checkIconPosition="right"
              />
            </Stack>
          </>
        ))}
      </Group>
      <Table striped highlightOnHover withTableBorder>
        <Table.Caption>
          <Group>
            {!record.displayAll && (
              <>
                <Pagination total={maxPages} value={page} onChange={setPage} />
                <NativeSelect
                  data={[5, 10, 20, 50, 100].map((num) => ({
                    label: `${num}`,
                    value: `${num}`,
                  }))}
                  value={`${numEntries}`}
                  onChange={(event) => setMaxEntries(parseInt(event.target.value))}
                />
              </>
            )}
            Data available from {record.dataAvailableFromYear}
          </Group>
        </Table.Caption>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Pos</Table.Th>
            {record.columns.map((col) => (
              <Table.Th key={col.key as string}>{col.title}</Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {entriesOnPage.map((entry, i) => (
            <Table.Tr key={entry[record.keyField] as string}>
              <Table.Td>{i + 1 + (page - 1) * numEntries}</Table.Td>
              {record.columns.map((col) => (
                <Table.Td key={col.key as string}>{makeCell(col, entry)}</Table.Td>
              ))}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}

export default RecordTable;
