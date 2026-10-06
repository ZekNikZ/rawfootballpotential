import { Badge, Button, Group, Stack, Text, Title } from "@mantine/core";
import { Link, useParams } from "react-router";
import { useLeaguePath } from "../lib/league-context";

const NAMES: Record<string, string> = {
  standings: "Standings",
  matchups: "Matchups",
  teams: "Teams & Rosters",
  transactions: "Transactions",
  draft: "Draft",
  picks: "Future Picks",
};

export default function ComingSoon() {
  const path = useLeaguePath();
  const { page } = useParams();
  const name = NAMES[page ?? "picks"] ?? "This page";
  return (
    <Stack align="flex-start" gap="sm" py="xl">
      <Group gap="xs">
        <Title order={1}>{name}</Title>
        <Badge variant="light" color="gray">
          Soon
        </Badge>
      </Group>
      <Text c="dimmed">This page is still being built.</Text>
      <Button component={Link} to={path()} variant="light">
        Back to home
      </Button>
    </Stack>
  );
}
