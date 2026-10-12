import { Text } from "@mantine/core";
import type { Matchups } from "../api/schemas";
import { fmtDecimal } from "../lib/format";

/** The week's median score: actual so far, with the projected median grayed. Renders nothing without median games. */
export function WeekMedian({ median }: { median: Matchups["median"] }) {
  if (!median || (median.actual === null && median.projected === null)) return null;
  return (
    <Text size="sm" c="dimmed" style={{ fontVariantNumeric: "tabular-nums" }}>
      Median{" "}
      {median.actual !== null && (
        <Text span fw={600} c="var(--mantine-color-text)">
          {fmtDecimal(median.actual)}
        </Text>
      )}
      {median.projected !== null && ` · proj ${fmtDecimal(median.projected)}`}
    </Text>
  );
}
