import { Alert, Skeleton, Stack, Table, Text, Title } from "@mantine/core";
import type { UseQueryResult } from "@tanstack/react-query";
import { QueryError } from "../components/QueryState";

export function PageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <Stack gap={4} mb="md">
      <Title order={1} fz="1.8rem">
        {title}
      </Title>
      {children && (
        <Text c="dimmed" size="sm">
          {children}
        </Text>
      )}
    </Stack>
  );
}

/** Skeleton / error / content for one admin query. */
export function Loaded<T>({
  query,
  children,
}: {
  query: UseQueryResult<T>;
  children: (data: T) => React.ReactNode;
}) {
  if (query.isPending)
    return (
      <Stack gap="xs">
        <Skeleton h={24} w="40%" />
        <Skeleton h={160} />
      </Stack>
    );
  if (query.isError) return <QueryError error={query.error} onRetry={() => void query.refetch()} />;
  return <>{children(query.data)}</>;
}

export function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Stack gap="xs" mb="xl">
      <Title order={2} fz="1.2rem">
        {title}
      </Title>
      {children}
    </Stack>
  );
}

export function Notice({ children }: { children: React.ReactNode }) {
  return (
    <Alert variant="light" color="blue" mb="md">
      {children}
    </Alert>
  );
}

export const AdminTable = ({
  children,
  minWidth = 560,
}: {
  children: React.ReactNode;
  minWidth?: number;
}) => (
  <Table.ScrollContainer minWidth={minWidth} type="native">
    <Table withTableBorder striped verticalSpacing={6}>
      {children}
    </Table>
  </Table.ScrollContainer>
);

export const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "–";
