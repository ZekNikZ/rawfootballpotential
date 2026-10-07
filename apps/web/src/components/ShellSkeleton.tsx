import { AppShell, Skeleton, Stack } from "@mantine/core";

/** Placeholder for the app frame while the league list loads (not a blocking overlay). */
export function ShellSkeleton() {
  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 250, breakpoint: "sm", collapsed: { mobile: true } }}
      padding="md"
    >
      <AppShell.Header p="sm">
        <Skeleton h={36} w={220} />
      </AppShell.Header>
      <AppShell.Navbar p="sm">
        <Stack gap="xs">
          <Skeleton h={34} />
          <Skeleton h={30} />
          <Skeleton h={30} />
          <Skeleton h={30} />
        </Stack>
      </AppShell.Navbar>
      <AppShell.Main>
        <Stack>
          <Skeleton h={32} w="40%" />
          <Skeleton h={240} />
        </Stack>
      </AppShell.Main>
    </AppShell>
  );
}
