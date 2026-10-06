import { Alert, Button, Group, Text } from "@mantine/core";
import { WarningCircle } from "@phosphor-icons/react";

export function QueryError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <Alert
      icon={<WarningCircle size={20} />}
      color="red"
      variant="light"
      title="Couldn't load this"
    >
      <Group justify="space-between" gap="xs">
        <Text size="sm">{message}</Text>
        {onRetry && (
          <Button size="xs" variant="default" onClick={onRetry}>
            Try again
          </Button>
        )}
      </Group>
    </Alert>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <Text c="dimmed" ta="center" py="lg">
      {children}
    </Text>
  );
}
