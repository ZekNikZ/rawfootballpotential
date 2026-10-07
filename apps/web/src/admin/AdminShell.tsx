import "@mantine/notifications/styles.css";
import {
  ActionIcon,
  AppShell,
  Burger,
  Button,
  Group,
  NavLink,
  ScrollArea,
  Skeleton,
  Stack,
  Text,
} from "@mantine/core";
import { useDisclosure, useDocumentTitle } from "@mantine/hooks";
import { Notifications } from "@mantine/notifications";
import {
  ArrowSquareOut,
  ClockCounterClockwise,
  Database,
  GearSix,
  House,
  ListChecks,
  Medal,
  Pencil,
  Ranking,
  SignOut,
  Trophy,
  UploadSimple,
  UserList,
  UsersThree,
} from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, Outlet, useLocation } from "react-router";
import { ApiError } from "../api/client";
import { ColorSchemeToggle } from "../components/ColorSchemeToggle";
import { QueryError } from "../components/QueryState";
import { adminQuery } from "./api";
import { meSchema, type Me } from "./schemas";
import { MeContext } from "./me";

const NAV = [
  { to: "/admin", label: "Overview", icon: House, end: true },
  { to: "/admin/site", label: "Site & changelog", icon: GearSix },
  { to: "/admin/leagues", label: "Leagues & seasons", icon: Database },
  { to: "/admin/people", label: "Managers & franchises", icon: UsersThree },
  { to: "/admin/corrections", label: "Corrections", icon: Pencil },
  { to: "/admin/thresholds", label: "Trophy thresholds", icon: Trophy },
  { to: "/admin/players", label: "Unmatched players", icon: ListChecks },
  { to: "/admin/records", label: "Records", icon: Ranking },
  { to: "/admin/jobs", label: "Data jobs", icon: ClockCounterClockwise },
  { to: "/admin/import", label: "ESPN import", icon: UploadSimple },
  { to: "/admin/users", label: "Admins", icon: UserList, owner: true },
  { to: "/admin/audit", label: "Audit log", icon: Medal },
];

export default function AdminShell() {
  useDocumentTitle("Admin · Raw Football Potential");
  const me = useQuery({ ...adminQuery(["me"], "/me", meSchema), retry: false });
  const qc = useQueryClient();
  const { pathname } = useLocation();
  const [opened, { toggle, close }] = useDisclosure();

  if (me.isPending)
    return (
      <Stack p="xl">
        <Skeleton h={32} w={240} />
        <Skeleton h={200} />
      </Stack>
    );
  if (me.error instanceof ApiError && (me.error.status === 401 || me.error.status === 403))
    return <Navigate to={`/admin/login?next=${encodeURIComponent(pathname)}`} replace />;
  if (me.isError) return <QueryError error={me.error} onRetry={() => void me.refetch()} />;
  const user: Me = me.data;

  const signOut = async () => {
    await fetch("/api/auth/sign-out", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    qc.clear();
    window.location.assign("/admin/login");
  };

  return (
    <MeContext value={user}>
      <Notifications position="top-right" zIndex={2000} />
      <AppShell
        header={{ height: 56 }}
        navbar={{ width: 250, breakpoint: "sm", collapsed: { mobile: !opened } }}
        padding="md"
      >
        <AppShell.Header p="xs">
          <Group h="100%" justify="space-between" wrap="nowrap">
            <Group gap="xs" wrap="nowrap">
              <Burger
                opened={opened}
                onClick={toggle}
                hiddenFrom="sm"
                size="sm"
                aria-label="Toggle navigation"
              />
              <Text ff="Bebas Neue" size="1.8rem" lh={1} truncate>
                RFP Admin
              </Text>
            </Group>
            <Group gap="xs" wrap="nowrap">
              <Text size="sm" c="dimmed" visibleFrom="sm">
                {user.name} · {user.role}
              </Text>
              <Button
                component={Link}
                to="/"
                variant="default"
                size="xs"
                leftSection={<ArrowSquareOut size={16} />}
                visibleFrom="sm"
              >
                View site
              </Button>
              <ActionIcon
                component={Link}
                to="/"
                variant="default"
                size="lg"
                aria-label="View site"
                hiddenFrom="sm"
              >
                <ArrowSquareOut size={18} />
              </ActionIcon>
              <Button
                variant="default"
                size="xs"
                leftSection={<SignOut size={16} />}
                onClick={() => void signOut()}
                visibleFrom="sm"
              >
                Sign out
              </Button>
              <ActionIcon
                variant="default"
                size="lg"
                aria-label="Sign out"
                onClick={() => void signOut()}
                hiddenFrom="sm"
              >
                <SignOut size={18} />
              </ActionIcon>
              <ColorSchemeToggle />
            </Group>
          </Group>
        </AppShell.Header>
        <AppShell.Navbar p="xs">
          <ScrollArea type="never">
            {NAV.filter((n) => !n.owner || user.role === "owner").map((n) => (
              <NavLink
                key={n.to}
                component={Link}
                to={n.to}
                label={n.label}
                leftSection={<n.icon size={20} />}
                active={n.end ? pathname === n.to : pathname.startsWith(n.to)}
                variant="light"
                onClick={close}
              />
            ))}
          </ScrollArea>
        </AppShell.Navbar>
        <AppShell.Main>
          <Outlet />
        </AppShell.Main>
      </AppShell>
    </MeContext>
  );
}
