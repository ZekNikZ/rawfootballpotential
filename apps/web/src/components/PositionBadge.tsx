import { Badge } from "@mantine/core";

const POS_COLOR: Record<string, string> = {
  QB: "red",
  RB: "green",
  WR: "blue",
  TE: "orange",
  K: "grape",
  DEF: "gray",
};

/** A small coloured position tag (QB, RB, ...). */
export function PositionBadge({ position }: { position: string | null }) {
  if (!position) return null;
  return (
    <Badge size="xs" variant="light" color={POS_COLOR[position] ?? "gray"} w={36} px={4}>
      {position}
    </Badge>
  );
}
