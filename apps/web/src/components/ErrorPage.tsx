import { Alert, Button, Container, Stack, Text, Title } from "@mantine/core";
import { WarningCircle } from "@phosphor-icons/react";
import { isRouteErrorResponse, Link, useRouteError } from "react-router";

/** Route-level error screen (thrown loader/render errors) and a plain message variant. */
export function ErrorPage({ message }: { message?: string }) {
  const error = useRouteError();
  const text =
    message ??
    (isRouteErrorResponse(error)
      ? `${error.status} ${error.statusText}`
      : error instanceof Error
        ? error.message
        : "Something went wrong.");
  return (
    <Container size="sm" py="xl">
      <Stack>
        <Title order={2}>Something went wrong</Title>
        <Alert icon={<WarningCircle size={20} />} color="red" variant="light">
          <Text>{text}</Text>
        </Alert>
        <Button component={Link} to="/" variant="default" w="fit-content">
          Back to the start
        </Button>
      </Stack>
    </Container>
  );
}
