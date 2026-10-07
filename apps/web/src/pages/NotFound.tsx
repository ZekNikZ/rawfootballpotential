import { Button, Stack, Text, Title } from "@mantine/core";
import { Link } from "react-router";
import { useLeaguePath } from "../lib/league-context";

export default function NotFound() {
  const path = useLeaguePath();
  return (
    <Stack align="flex-start" gap="sm" py="xl">
      <Title order={1}>Page not found</Title>
      <Text c="dimmed">That page doesn't exist (or it moved).</Text>
      <Button component={Link} to={path()} variant="light">
        Back to home
      </Button>
    </Stack>
  );
}
