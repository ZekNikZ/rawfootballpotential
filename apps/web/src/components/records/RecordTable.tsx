import {
  Badge,
  Group,
  NativeSelect,
  Pagination,
  Skeleton,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { recordQuery } from "../../api/queries";
import type { CatalogRecord } from "../../api/schemas";
import type { Params } from "../../api/client";
import { EmptyState, QueryError } from "../QueryState";
import { NUMERIC_TYPES, renderCell } from "./cells";
import classes from "./RecordTable.module.css";

export const PAGE_SIZES = [5, 10, 20, 50, 100];

interface Props {
  leagueSlug: string;
  def: CatalogRecord;
  /** Filter params from the URL (no paging). */
  filters: Params;
  page: number;
  size: number;
  onPage: (page: number) => void;
  onSize: (size: number) => void;
}

const SKELETON_ROWS = 8;

export function RecordTable({ leagueSlug, def, filters, page, size, onPage, onSize }: Props) {
  const paged = !def.displayAll;
  const params: Params = paged
    ? { ...filters, limit: size, offset: (page - 1) * size }
    : { ...filters, limit: 500 };
  const query = useQuery(recordQuery(leagueSlug, def.id, params));
  const data = query.data;
  const columns = data?.meta.columns ?? def.columns;
  const pages = data ? Math.max(1, Math.ceil(data.total / size)) : 1;
  const inProgressSeason = data && !paged && data.rows.some((r) => r.inProgress);

  return (
    <Stack gap="xs">
      {query.isError && !data ? (
        <QueryError error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <Table.ScrollContainer minWidth={420} type="native">
          <Table
            withTableBorder
            className={classes.table}
            data-fetching={query.isFetching && !query.isPending ? "" : undefined}
          >
            <Table.Thead>
              <Table.Tr>
                <Table.Th className={classes.rank}>Pos</Table.Th>
                {columns.map((col, i) => (
                  <Table.Th
                    key={col.key}
                    className={i === 0 ? classes.sticky : undefined}
                    data-numeric={NUMERIC_TYPES.has(col.type) ? "" : undefined}
                  >
                    {col.title}
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {query.isPending &&
                Array.from({ length: SKELETON_ROWS }, (_, r) => (
                  <Table.Tr key={r} className={classes.row}>
                    <Table.Td className={classes.rank}>
                      <Skeleton h={14} w={20} />
                    </Table.Td>
                    {columns.map((col, i) => (
                      <Table.Td key={col.key} className={i === 0 ? classes.sticky : undefined}>
                        <Skeleton h={14} w={i === 0 ? 140 : 56} />
                      </Table.Td>
                    ))}
                  </Table.Tr>
                ))}
              {data?.rows.map((row, i) => (
                <Table.Tr key={`${row.rank}-${i}`} className={classes.row}>
                  <Table.Td className={classes.rank}>{row.rank}</Table.Td>
                  {columns.map((col, c) => (
                    <Table.Td
                      key={col.key}
                      className={c === 0 ? classes.sticky : undefined}
                      data-numeric={NUMERIC_TYPES.has(col.type) ? "" : undefined}
                      data-ranked={col.ranked ? "" : undefined}
                    >
                      {c === 0 && row.inProgress && paged ? (
                        <Group gap={6} wrap="nowrap">
                          {renderCell(col, row, { leagueSlug, entities: data.entities })}
                          <Badge size="xs" variant="light" color="orange">
                            in progress
                          </Badge>
                        </Group>
                      ) : (
                        renderCell(col, row, { leagueSlug, entities: data.entities })
                      )}
                    </Table.Td>
                  ))}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      {data && data.rows.length === 0 && <EmptyState>No results for these filters.</EmptyState>}
      <Group gap="md" align="center" justify="space-between">
        <Group gap="sm" align="center">
          {paged && data && data.total > 0 && (
            <>
              <Pagination total={pages} value={page} onChange={onPage} size="sm" siblings={1} />
              <NativeSelect
                aria-label="Rows per page"
                size="xs"
                w={70}
                value={String(size)}
                onChange={(e) => onSize(Number(e.target.value))}
                data={PAGE_SIZES.map((n) => ({ value: String(n), label: String(n) }))}
              />
            </>
          )}
        </Group>
        <Text size="sm" c="dimmed">
          {(data?.availableFrom ?? def.availableFrom)
            ? `Data available from ${data?.availableFrom ?? def.availableFrom}`
            : null}
          {data?.meta.qualifier ? ` · minimum ${data.meta.qualifier.minGames} games` : null}
          {inProgressSeason ? " · includes the in-progress season" : null}
        </Text>
      </Group>
    </Stack>
  );
}
