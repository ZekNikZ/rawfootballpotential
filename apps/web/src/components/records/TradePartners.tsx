import {
  Anchor,
  Group,
  SegmentedControl,
  Skeleton,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { tradePartnersQuery } from "../../api/queries";
import type { TradePartners as Partners } from "../../api/schemas";
import { fmtInt } from "../../lib/format";
import { useLeague } from "../../lib/league-context";
import { EmptyState, QueryError } from "../QueryState";
import { BackToTop } from "./BackToTop";
import { FilterBar } from "./filters";
import { useSectionState } from "./section-state";
import classes from "./Heatmap.module.css";

const FILTERS = ["seasons"] as const;
type Mode = "trades" | "net";

/** A franchise is labeled with its current manager (owner decision). */
function labelOf(p: Partners, franchiseId: number) {
  const f = p.entities.franchises[String(franchiseId)];
  const manager = f?.managerId == null ? null : p.entities.managers[String(f.managerId)]?.name;
  return manager ?? f?.teamName ?? `Franchise ${franchiseId}`;
}

const signed = (n: number) => `${n > 0 ? "+" : ""}${fmtInt(Math.round(n))}`;

/**
 * Who trades with whom: one cell per pair of managers. "Trades" counts the trades they made together; "Net value" is
 * the estimated value (points, the Trade Value page's figure) the row manager gained from the column manager, net of
 * what they sent, so green means the row manager came out ahead.
 */
export function TradePartners() {
  const { league } = useLeague();
  const state = useSectionState("trade-partners");
  const [mode, setMode] = useState<Mode>("trades");
  const q = useQuery(tradePartnersQuery(league.slug, state.apiParams));
  const p = q.data;

  const ids = p ? [...p.franchises].sort((a, b) => labelOf(p, a).localeCompare(labelOf(p, b))) : [];
  const cells = p ? ids.flatMap((a) => ids.map((b) => p.matrix[String(a)]?.[String(b)])) : [];
  const maxTrades = Math.max(1, ...cells.map((c) => c?.trades ?? 0));
  const maxNet = Math.max(1, ...cells.map((c) => Math.abs(c?.net ?? 0)));

  return (
    <Stack gap={10} component="section" aria-labelledby="h-trade-partners">
      <Title order={2} id="h-trade-partners">
        Trade Partners
      </Title>
      <FilterBar
        filters={FILTERS}
        league={league}
        availableFrom={p?.availableFrom ?? null}
        values={state.filters}
        params={undefined}
        minGamesDefault={undefined}
        onChange={(patch) => state.update(patch)}
      />
      <SegmentedControl
        aria-label="Show"
        value={mode}
        onChange={(v) => setMode(v as Mode)}
        data={[
          { value: "trades", label: "Number of trades" },
          { value: "net", label: "Net value won" },
        ]}
        style={{ alignSelf: "flex-start", maxWidth: "100%" }}
      />
      {q.isPending && <Skeleton h={320} />}
      {q.isError && !p && <QueryError error={q.error} onRetry={() => void q.refetch()} />}
      {p && ids.length === 0 && <EmptyState>No trades for these filters.</EmptyState>}
      {p && ids.length > 0 && (
        <>
          <Table.ScrollContainer minWidth={420} type="native">
            <Table
              withTableBorder
              withColumnBorders
              className={classes.table}
              data-fetching={q.isFetching ? "" : undefined}
            >
              <Table.Thead>
                <Table.Tr>
                  <Table.Th className={classes.corner} />
                  {ids.map((id) => (
                    <Table.Th key={id} scope="col" className={classes.colHead}>
                      <span>{labelOf(p, id)}</span>
                    </Table.Th>
                  ))}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {ids.map((a) => (
                  <Table.Tr key={a}>
                    <Table.Th scope="row" className={classes.rowHead}>
                      <Anchor component={Link} to={`/${league.slug}/franchises/${a}`} c="inherit">
                        {labelOf(p, a)}
                      </Anchor>
                    </Table.Th>
                    {ids.map((b) => {
                      const cell = a === b ? undefined : p.matrix[String(a)]?.[String(b)];
                      if (!cell)
                        return (
                          <Table.Td key={b} className={classes.empty}>
                            —
                          </Table.Td>
                        );
                      const label = `${cell.trades} trade${cell.trades === 1 ? "" : "s"}; ${labelOf(p, a)} received ${cell.received} and sent ${cell.sent} players or picks; estimated net ${signed(cell.net)} points`;
                      return (
                        <Table.Td
                          key={b}
                          className={classes.cell}
                          data-side={mode === "trades" ? "count" : cell.net >= 0 ? "win" : "loss"}
                          style={{
                            "--heat-strength": String(
                              mode === "trades"
                                ? cell.trades / maxTrades
                                : Math.abs(cell.net) / maxNet
                            ),
                          }}
                          title={label}
                        >
                          <Anchor
                            component={Link}
                            to={`/${league.slug}/compare?a=${a}&b=${b}`}
                            className={classes.cellLink}
                            aria-label={label}
                          >
                            {mode === "trades" ? cell.trades : signed(cell.net)}
                          </Anchor>
                        </Table.Td>
                      );
                    })}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          <Group gap="xs">
            <Text size="sm" c="dimmed">
              {mode === "trades"
                ? "Trades the row manager made with the column manager."
                : "Estimated points the row manager gained from the column manager, net of what they sent (rest-of-season production, as on the Trade Value page); green means the row manager came out ahead."}{" "}
              Click a cell to compare the two. Data available from {p.availableFrom}.
            </Text>
          </Group>
        </>
      )}
      <BackToTop />
    </Stack>
  );
}
