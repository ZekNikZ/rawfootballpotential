import {
  ActionIcon,
  AppShell,
  Box,
  Burger,
  Collapse,
  Group,
  LoadingOverlay,
  NativeSelect,
  NavLink,
  ScrollArea,
  SegmentedControl,
  Text,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconChevronDown, IconChevronRight, IconRefresh } from "@tabler/icons-react";
import { Fragment, useMemo } from "react";
import { generatePath, matchPath, Outlet, useLocation, useNavigate } from "react-router-dom";
import routes from "../routes";
import { ArrowClockwise, Icon } from "@phosphor-icons/react";
import Logo from "./Logo/Logo";
import { ColorSchemeToggle } from "./ColorSchemeToggle/ColorSchemeToggle";
import { LeagueId } from "../../types";
import { useCurrentLeague, useGlobalData } from "../providers";

function makeIcon(Icon?: Icon) {
  return Icon ? <Icon size={20} /> : undefined;
}

export default function Layout() {
  const { config } = useGlobalData();
  const { leagueId, setLeagueId } = useCurrentLeague();

  const currentLeagueData = useMemo(() => {
    return config!.leagues.find((league) =>
      league.years.find((year) => year.leagueId === leagueId)
    )!;
  }, [leagueId, config]);

  const [opened, { toggle, close }] = useDisclosure();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // const dispatch = useDispatch();
  // const { loading, loadingData, loadingNotificationId } = useAppSelector((state) => state.loading);
  // useEffect(() => {
  //   if (!loading) {
  //     notifications.clean();
  //     dispatch(setLoadingNotificationId(null));
  //   } else if (!loadingNotificationId) {
  //     dispatch(
  //       setLoadingNotificationId(
  //         notifications.show({
  //           title: "Loading league data",
  //           message: `Loading ${loadingData}...`,
  //           loading: true,
  //           autoClose: false,
  //           withCloseButton: false,
  //         })
  //       )
  //     );
  //   } else {
  //     notifications.update({
  //       id: loadingNotificationId,
  //       title: "Loading league data",
  //       message: `Loading ${loadingData}...`,
  //       loading: true,
  //       autoClose: false,
  //       withCloseButton: false,
  //     });
  //   }
  // }, [loading, loadingData]);
  // const currentLeague = useAppSelector(
  //   (state) => state.league.data?.currentLeague ?? leagues[0].id
  // );

  const changeLeague = (newLeague: LeagueId) => {
    setLeagueId(newLeague);
  };

  const onRefreshData = () => {
    // FIXME: fix this
  };

  // const lastNFLUpdate = useAppSelector((state) => state.nfl.lastUpdate);
  // const lastLeagueUpdate = useAppSelector((state) => state.league.lastUpdate);

  // useEffect(() => {
  //   loader(dispatch, lastNFLUpdate, lastLeagueUpdate);
  // }, []);

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{
        width: 250,
        breakpoint: "sm",
        collapsed: { mobile: !opened },
      }}
      padding="md"
    >
      <AppShell.Header p="sm">
        <Group align="center" justify="space-between">
          <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
          <Box onClick={() => navigate("/")}>
            <Group gap={0} style={{ cursor: "pointer" }}>
              <Logo color={currentLeagueData.color} />
              <Text size="2.2rem" ff="Bebas Neue" c={currentLeagueData.color} visibleFrom="sm">
                &nbsp;{currentLeagueData.name}
              </Text>
            </Group>
          </Box>
          <Group gap="xs">
            <ActionIcon
              variant="default"
              aria-label="Refresh data"
              onClick={onRefreshData}
              size="lg"
              style={{ justifySelf: "end" }}
              // FIXME: fix this
              // disabled={loading}
              disabled
              visibleFrom="sm"
            >
              <IconRefresh style={{ width: "70%", height: "70%" }} stroke={1.5} />
            </ActionIcon>
            <ColorSchemeToggle />
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        <ScrollArea type="never">
          <SegmentedControl
            fullWidth
            value={currentLeagueData.name}
            data={config!.leagues.map(({ name }) => ({
              value: name,
              label: name,
            }))}
            onChange={(value) => {
              const league = config!.leagues.find((league) => league.name == value)!;
              changeLeague(
                league.years.reduce((prev, current) =>
                  prev && prev.year > current.year ? prev : current
                ).leagueId as LeagueId
              );
            }}
            color={currentLeagueData.color}
          />
          <NativeSelect
            value={leagueId}
            onChange={(event) => {
              setLeagueId(event.target.value as LeagueId);
            }}
            data={currentLeagueData.years.map((year) => ({
              value: year.leagueId,
              label: `${year.year} - ${year.year + 1}`,
            }))}
            mt="xs"
          />
          <Box mt="xs" />
          {routes
            .filter(
              (route) =>
                route.navbarProperties &&
                (route.navbarProperties?.isAvailable?.(currentLeagueData) ?? true)
            )
            .map((route) => {
              const routeSelected = !!matchPath(route.path, pathname);
              const routeOrSubrouteSelected = !!matchPath(route.path + "/*", pathname);
              return (
                <Fragment key={route.path}>
                  <NavLink
                    key={route.path}
                    label={route.navbarProperties?.label ?? route.title}
                    leftSection={makeIcon(route.navbarProperties?.icon)}
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
                      (routeSelected && !route.children)
                        ? "light"
                        : "default"
                    }
                    active={
                      route.navbarProperties?.shouldHighlight?.(pathname) ||
                      (routeSelected && !route.children)
                    }
                    onClick={() => {
                      navigate(generatePath(route.path, { leagueId }));
                      if (!route.children) close();
                    }}
                    disabled={route.navbarProperties?.isDisabled?.(currentLeagueData)}
                  />
                  {route.children && (
                    <Collapse key={`${route.path}-collapse`} in={routeOrSubrouteSelected}>
                      {route.children
                        .filter(
                          (subroute) =>
                            subroute.navbarProperties &&
                            (subroute.navbarProperties?.isAvailable?.(currentLeagueData) ?? true)
                        )
                        .map((subroute) => {
                          const subrouteSelected = !!matchPath(subroute.path, pathname);
                          return (
                            <NavLink
                              key={subroute.path}
                              pl="lg"
                              label={subroute.navbarProperties?.label ?? subroute.title}
                              leftSection={makeIcon(subroute.navbarProperties?.icon)}
                              variant={
                                subroute.navbarProperties?.shouldHighlight?.(pathname) ||
                                subrouteSelected
                                  ? "light"
                                  : "default"
                              }
                              active={
                                subroute.navbarProperties?.shouldHighlight?.(pathname) ||
                                subrouteSelected
                              }
                              onClick={() => {
                                navigate(generatePath(subroute.path, { leagueId }));
                                close();
                              }}
                              disabled={route.navbarProperties?.isDisabled?.(currentLeagueData)}
                            />
                          );
                        })}
                    </Collapse>
                  )}
                </Fragment>
              );
            })}
          <NavLink
            label="Reload all data"
            leftSection={makeIcon(ArrowClockwise)}
            variant="light"
            // FIXME: fix this
            // disabled={loading}
            disabled
            onClick={onRefreshData}
          />
        </ScrollArea>
      </AppShell.Navbar>

      <AppShell.Main pos="relative">
        <LoadingOverlay
          // FIXME: fix this
          // visible={loading}
          zIndex={1000}
          pos="absolute"
          style={{
            top: "var(--app-shell-header-offset, 0px)",
            bottom: 0,
            left: "var(--app-shell-navbar-offset, 0px)",
            right: 0,
          }}
          overlayProps={{ radius: "sm", blur: 2 }}
        />
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
