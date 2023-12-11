import {
  AppShell,
  Box,
  Burger,
  Collapse,
  Group,
  MantineColor,
  NavLink,
  SegmentedControl,
  Text,
} from '@mantine/core';
import { useDisclosure, useDocumentTitle } from '@mantine/hooks';
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import { useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import routes from '../routes';
import Logo from '../../components/Logo/Logo';
import { ColorSchemeToggle } from '../../components/ColorSchemeToggle/ColorSchemeToggle';

export default function Layout() {
  useDocumentTitle('Raw Football Potential');

  const [opened, { toggle }] = useDisclosure();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const leagues = [
    {
      id: '123',
      label: 'Redraft',
      color: 'blue',
      type: 'redraft',
    },
    {
      id: '456',
      label: 'Dynasty',
      color: 'red',
      type: 'dynasty',
    },
  ] as { id: string; label: string; color: MantineColor; type: 'redraft' | 'dynasty' }[];

  const [league, setLeague] = useState(leagues[0].id);

  const changeLeague = (newLeague: string) => {
    setLeague(newLeague);
    navigate('/');
  };

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{
        width: 250,
        breakpoint: 'sm',
        collapsed: { mobile: !opened },
      }}
      padding="md"
    >
      <AppShell.Header p="sm">
        <Group align="center" justify="space-between">
          <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
          <Group gap={0}>
            <Logo />
            <Text size="2.2rem" ff="Bebas Neue" c={leagues.filter((e) => e.id === league)[0].color}>
              &nbsp;{leagues.filter((e) => e.id === league)[0].label}
            </Text>
          </Group>
          <ColorSchemeToggle />
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        <SegmentedControl
          fullWidth
          value={league}
          data={leagues.map(({ id, label }) => ({ value: id, label }))}
          onChange={changeLeague}
          color={leagues.filter((e) => e.id === league)[0].color}
        />
        <Box mt="xs" />
        {routes
          .filter(
            (route) =>
              route.navbarProperties &&
              (route.navbarProperties?.isAvailable?.(leagues.filter((l) => l.id === league)[0]) ??
                true)
          )
          .map((route) => (
            <>
              <NavLink
                label={route.navbarProperties?.label ?? route.title}
                leftSection={route.navbarProperties?.icon}
                rightSection={
                  route.children?.filter((subroute) => subroute.navbarProperties) ? (
                    pathname.startsWith(route.path) ? (
                      <IconChevronDown size="0.8rem" stroke={1.5} />
                    ) : (
                      <IconChevronRight size="0.8rem" stroke={1.5} />
                    )
                  ) : null
                }
                variant={
                  route.navbarProperties?.shouldHighlight?.(pathname) ||
                  (pathname === route.path && !route.children)
                    ? 'light'
                    : 'default'
                }
                active={
                  route.navbarProperties?.shouldHighlight?.(pathname) ||
                  (pathname === route.path && !route.children)
                }
                onClick={() => navigate(route.path)}
              />
              {route.children && (
                <Collapse in={pathname.startsWith(route.path)}>
                  {route.children
                    .filter(
                      (subroute) =>
                        subroute.navbarProperties &&
                        (subroute.navbarProperties?.isAvailable?.(
                          leagues.filter((l) => l.id === league)[0]
                        ) ??
                          true)
                    )
                    .map((subroute) => (
                      <NavLink
                        pl="lg"
                        label={subroute.navbarProperties?.label ?? subroute.title}
                        leftSection={subroute.navbarProperties?.icon}
                        variant={
                          subroute.navbarProperties?.shouldHighlight?.(pathname) ||
                          pathname === subroute.path
                            ? 'light'
                            : 'default'
                        }
                        active={
                          subroute.navbarProperties?.shouldHighlight?.(pathname) ||
                          pathname === subroute.path
                        }
                        onClick={() => navigate(subroute.path)}
                      />
                    ))}
                </Collapse>
              )}
            </>
          ))}
      </AppShell.Navbar>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
