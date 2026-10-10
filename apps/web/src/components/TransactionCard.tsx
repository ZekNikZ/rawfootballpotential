import { Badge, Card, Group, Paper, SimpleGrid, Stack, Text } from "@mantine/core";
import dayjs from "dayjs";
import type { Entities, Transactions as TxData } from "../api/schemas";
import { fmtMoney } from "../lib/format";
import { PositionBadge } from "./PositionBadge";
import { TeamLabel } from "./TeamLabel";

type Tx = TxData["transactions"][number];
type Item = Tx["items"][number];

export const TX_TYPES = [
  { value: "all", label: "All" },
  { value: "trade", label: "Trades" },
  { value: "waiver", label: "Waivers" },
  { value: "free_agent", label: "Free agents" },
  { value: "commissioner", label: "Commissioner" },
];
const TYPE_COLOR: Record<string, string> = {
  trade: "grape",
  waiver: "blue",
  free_agent: "teal",
  commissioner: "orange",
};
const TYPE_LABEL: Record<string, string> = {
  trade: "Trade",
  waiver: "Waiver",
  free_agent: "Free agent",
  commissioner: "Commissioner",
};

/** A trade item's estimated value to the team that received it. */
function ValueTag({ item }: { item: Item }) {
  if (item.estimatedValue === null) return null;
  return (
    <Text span c="dimmed" fz="xs" ml="auto" style={{ whiteSpace: "nowrap" }}>
      {fmtPts(item.estimatedValue)}
    </Text>
  );
}

function ItemLine({ item: i, entities }: { item: Item; entities: Entities }) {
  if (i.kind === "pick") {
    const from =
      i.originalFranchiseId === null
        ? null
        : entities.franchises[String(i.originalFranchiseId)]?.teamName;
    return (
      <Group gap={6} wrap="nowrap">
        <Text size="sm">
          {i.pickSeason ?? ""} round {i.pickRound ?? "?"} pick
          {from && (
            <Text span c="dimmed">
              {" "}
              (from {from})
            </Text>
          )}
        </Text>
        <ValueTag item={i} />
      </Group>
    );
  }
  if (i.kind === "faab") return <Text size="sm">{fmtMoney(i.amount ?? 0)} FAAB</Text>;
  return (
    <Group gap={6} wrap="nowrap">
      <PositionBadge position={i.position} />
      <Text size="sm">{i.player ?? "Unknown player"}</Text>
      <ValueTag item={i} />
    </Group>
  );
}

/** Shown with trade values of the ESPN seasons. */
export const ESPN_SCORING_NOTE =
  "ESPN seasons are scored with the 2022 Sleeper settings, which match ESPN's recorded points for nearly every player.";

const fmtPts = (n: number) => n.toFixed(1);
const fmtSigned = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "") + fmtPts(Math.abs(n));

function Body({ tx, entities, showValue }: { tx: Tx; entities: Entities; showValue: boolean }) {
  if (tx.type === "trade") {
    const sides = new Map<number, Item[]>();
    for (const i of tx.items) {
      if (i.toTeamSeasonId === null) continue;
      sides.set(i.toTeamSeasonId, [...(sides.get(i.toTeamSeasonId) ?? []), i]);
    }
    return (
      <SimpleGrid cols={{ base: 1, xs: sides.size > 1 ? 2 : 1 }} spacing="xs">
        {[...sides].map(([team, items]) => {
          const value = showValue ? tx.tradeValue?.find((v) => v.teamSeasonId === team) : undefined;
          return (
            <Paper key={team} withBorder radius="sm" p="xs">
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                <TeamLabel entities={entities} teamSeasonId={team} /> receives
              </Text>
              <Stack gap={3} mt={4}>
                {[...items]
                  .sort((a, b) => (b.estimatedValue ?? -Infinity) - (a.estimatedValue ?? -Infinity))
                  .map((i, n) => (
                    <ItemLine key={n} item={i} entities={entities} />
                  ))}
              </Stack>
              {value && (
                <Text size="xs" mt={6}>
                  Estimated trade value{" "}
                  <Text
                    span
                    fw={700}
                    c={value.net > 0 ? "green" : value.net < 0 ? "red" : "dimmed"}
                  >
                    {fmtSigned(value.net)}
                  </Text>
                  <Text span c="dimmed">
                    {" "}
                    ({fmtPts(value.gained)} received, {fmtPts(value.lost)} sent)
                  </Text>
                </Text>
              )}
            </Paper>
          );
        })}
      </SimpleGrid>
    );
  }
  const added = tx.items.filter((i) => i.direction === "add");
  const dropped = tx.items.filter((i) => i.direction === "drop");
  const bid = tx.items.find((i) => i.faabBid !== null)?.faabBid ?? null;
  return (
    <Stack gap={3}>
      {added.map((i, n) => (
        <Group key={`a${n}`} gap={8} wrap="nowrap">
          <Text span c="green" fw={700} w={12}>
            +
          </Text>
          <ItemLine item={i} entities={entities} />
          {bid !== null && n === 0 && (
            <Badge size="xs" variant="light" color="gray">
              {fmtMoney(bid)} bid
            </Badge>
          )}
        </Group>
      ))}
      {dropped.map((i, n) => (
        <Group key={`d${n}`} gap={8} wrap="nowrap" opacity={0.7}>
          <Text span c="red" fw={700} w={12}>
            −
          </Text>
          <ItemLine item={i} entities={entities} />
        </Group>
      ))}
    </Stack>
  );
}

/** One transaction as a card: its type, who made it and when, then what moved. */
export function TransactionCard({
  tx,
  entities,
  showValue,
}: {
  tx: Tx;
  entities: Entities;
  showValue: boolean;
}) {
  return (
    <Card withBorder radius="sm" padding="sm" opacity={tx.status === "failed" ? 0.7 : 1}>
      <Stack gap={6}>
        <Group gap={6} wrap="wrap">
          <Badge size="xs" variant="light" color={TYPE_COLOR[tx.type] ?? "gray"}>
            {TYPE_LABEL[tx.type] ?? tx.type}
          </Badge>
          {tx.status === "failed" && (
            <Badge size="xs" variant="light" color="red">
              failed{tx.failureReason ? `: ${tx.failureReason}` : ""}
            </Badge>
          )}
          {tx.type !== "trade" && tx.creatorTeamSeasonId !== null && (
            <Text size="sm" fw={600}>
              <TeamLabel entities={entities} teamSeasonId={tx.creatorTeamSeasonId} />
            </Text>
          )}
          <Text size="xs" c="dimmed">
            {tx.week !== null ? `Week ${tx.week}` : ""}
            {tx.executedAt ? ` · ${dayjs(tx.executedAt).format("MMM D, YYYY h:mm A")}` : ""}
          </Text>
        </Group>
        <Body tx={tx} entities={entities} showValue={showValue} />
      </Stack>
    </Card>
  );
}
