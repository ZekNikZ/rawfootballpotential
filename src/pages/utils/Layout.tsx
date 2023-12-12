import {
  ActionIcon,
  AppShell,
  Box,
  Burger,
  Collapse,
  Group,
  LoadingOverlay,
  NavLink,
  ScrollArea,
  SegmentedControl,
  Text,
} from '@mantine/core';
import { useDisclosure, useDocumentTitle } from '@mantine/hooks';
import { IconChevronDown, IconChevronRight, IconRefresh } from '@tabler/icons-react';
import { Fragment, useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { notifications } from '@mantine/notifications';
import { useDispatch } from 'react-redux';
import routes, { makeIcon } from '../routes';
import Logo from '../../components/Logo/Logo';
import { ColorSchemeToggle } from '../../components/ColorSchemeToggle/ColorSchemeToggle';
import { useAppSelector } from '../../data/hooks';
import { setLoadingNotificationId } from '../../data/loadingSlice';
import leagues from '../../leaguesData';
import loader from '../../data/dataLoader';
import { setCurrentLeague } from '../../data/leagues/leagueSlice';

export default function Layout() {
  useDocumentTitle('Raw Football Potential');

  const [opened, { toggle, close }] = useDisclosure();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const dispatch = useDispatch();
  const { loading, loadingData, loadingNotificationId } = useAppSelector((state) => state.loading);
  useEffect(() => {
    if (!loading) {
      notifications.clean();
      dispatch(setLoadingNotificationId(null));
    } else if (!loadingNotificationId) {
      dispatch(
        setLoadingNotificationId(
          notifications.show({
            title: 'Loading league data',
            message: `Loading ${loadingData}...`,
            loading: true,
            autoClose: false,
            withCloseButton: false,
          })
        )
      );
    } else {
      notifications.update({
        id: loadingNotificationId,
        title: 'Loading league data',
        message: `Loading ${loadingData}...`,
        loading: true,
        autoClose: false,
        withCloseButton: false,
      });
    }
  }, [loading, loadingData]);
  const currentLeague = useAppSelector(
    (state) => state.league.data?.currentLeague ?? leagues[0].id
  );

  const changeLeague = (newLeague: string) => {
    dispatch(setCurrentLeague(newLeague));
    navigate('/');
  };

  const onRefreshData = () => {
    loader(dispatch);
  };

  const lastNFLUpdate = useAppSelector((state) => state.nfl.lastUpdate);
  const lastLeagueUpdate = useAppSelector((state) => state.league.lastUpdate);

  useEffect(() => {
    loader(dispatch, lastNFLUpdate, lastLeagueUpdate);
  }, []);

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
          <Box onClick={() => navigate('/')}>
            <Group gap={0} style={{ cursor: 'pointer' }}>
              <Logo color={leagues.filter((e) => e.id === currentLeague)[0].color} />
              <Text
                size="2.2rem"
                ff="Bebas Neue"
                c={leagues.filter((e) => e.id === currentLeague)[0].color}
                visibleFrom="sm"
              >
                &nbsp;{leagues.filter((e) => e.id === currentLeague)[0].label}
              </Text>
            </Group>
          </Box>
          <Group gap="xs">
            <ActionIcon
              variant="default"
              aria-label="Refresh data"
              onClick={onRefreshData}
              size="lg"
              style={{ justifySelf: 'end' }}
              disabled={loading}
              visibleFrom="sm"
            >
              <IconRefresh style={{ width: '70%', height: '70%' }} stroke={1.5} />
            </ActionIcon>
            <ColorSchemeToggle />
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        <ScrollArea type="never">
          <SegmentedControl
            fullWidth
            value={currentLeague}
            data={leagues.map(({ id, label }) => ({ value: id, label }))}
            onChange={changeLeague}
            color={leagues.filter((e) => e.id === currentLeague)[0].color}
          />
          <Box mt="xs" />
          {routes
            .filter(
              (route) =>
                route.navbarProperties &&
                (route.navbarProperties?.isAvailable?.(
                  leagues.filter((l) => l.id === currentLeague)[0]
                ) ??
                  true)
            )
            .map((route) => (
              <Fragment key={route.path}>
                <NavLink
                  key={route.path}
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
                  onClick={() => {
                    navigate(route.path);
                    if (!route.children) close();
                  }}
                />
                {route.children && (
                  <Collapse key={`${route.path}-collapse`} in={pathname.startsWith(route.path)}>
                    {route.children
                      .filter(
                        (subroute) =>
                          subroute.navbarProperties &&
                          (subroute.navbarProperties?.isAvailable?.(
                            leagues.filter((l) => l.id === currentLeague)[0]
                          ) ??
                            true)
                      )
                      .map((subroute) => (
                        <NavLink
                          key={subroute.path}
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
                          onClick={() => {
                            navigate(subroute.path);
                            close();
                          }}
                        />
                      ))}
                  </Collapse>
                )}
              </Fragment>
            ))}
          <NavLink
            label="Reload all data"
            leftSection={makeIcon(IconRefresh)}
            variant="light"
            disabled={loading}
            onClick={onRefreshData}
          />
        </ScrollArea>
      </AppShell.Navbar>

      <AppShell.Main pos="relative">
        <LoadingOverlay
          visible={loading}
          zIndex={1000}
          pos="absolute"
          style={{
            top: 'var(--app-shell-header-offset, 0px)',
            bottom: 0,
            left: 'var(--app-shell-navbar-offset, 0px)',
            right: 0,
          }}
          overlayProps={{ radius: 'sm', blur: 2 }}
        />
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
