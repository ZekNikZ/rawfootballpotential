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
} from "@mantine/core";
import { useDisclosure, useDocumentTitle } from "@mantine/hooks";
import { IconChevronDown, IconChevronRight, IconRefresh } from "@tabler/icons-react";
import { Fragment, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import leagues from "../leaguesData";
import routes from "../utils/routes";
import { ArrowClockwise, Icon } from "@phosphor-icons/react";
import Logo from "./Logo/Logo";
import { ColorSchemeToggle } from "./ColorSchemeToggle/ColorSchemeToggle";
import { LeagueId } from "../types";

function makeIcon(Icon?: Icon) {
  return Icon ? <Icon size={20} /> : undefined;
}

export default function Layout() {
  useDocumentTitle("Raw Football Potential");

  const [opened, { toggle, close }] = useDisclosure();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const [currentLeague, setCurrentLeague] = useState(leagues[0].id);

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
    // FIXME: fix this
    setCurrentLeague(newLeague);
    navigate("/");
  };

  const onRefreshData = () => {
    // FIXME: fix this
    // loader(dispatch);
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
              style={{ justifySelf: "end" }}
              // FIXME: fix this
              // disabled={loading}
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
            value={currentLeague}
            data={leagues.map(({ id, label }) => ({ value: id, label }))}
            onChange={(l) => changeLeague(l as LeagueId)}
            color={leagues.filter((e) => e.id === currentLeague)[0].color}
          />
          <Box mt="xs" />
          {routes
            .filter(
              (route) =>
                route.navbarProperties &&
                (route.navbarProperties?.isAvailable?.(
                  leagues.find((l) => l.id === currentLeague)!.type
                ) ??
                  true)
            )
            .map((route) => (
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
                    (pathname === route.path && !route.children)
                      ? "light"
                      : "default"
                  }
                  active={
                    route.navbarProperties?.shouldHighlight?.(pathname) ||
                    (pathname === route.path && !route.children)
                  }
                  onClick={() => {
                    navigate(route.path);
                    if (!route.children) close();
                  }}
                  disabled={route.navbarProperties?.isDisabled?.(
                    leagues.find((l) => l.id === currentLeague)!.type
                  )}
                />
                {route.children && (
                  <Collapse key={`${route.path}-collapse`} in={pathname.startsWith(route.path)}>
                    {route.children
                      .filter(
                        (subroute) =>
                          subroute.navbarProperties &&
                          (subroute.navbarProperties?.isAvailable?.(
                            leagues.find((l) => l.id === currentLeague)!.type
                          ) ??
                            true)
                      )
                      .map((subroute) => (
                        <NavLink
                          key={subroute.path}
                          pl="lg"
                          label={subroute.navbarProperties?.label ?? subroute.title}
                          leftSection={makeIcon(subroute.navbarProperties?.icon)}
                          variant={
                            subroute.navbarProperties?.shouldHighlight?.(pathname) ||
                            pathname === subroute.path
                              ? "light"
                              : "default"
                          }
                          active={
                            subroute.navbarProperties?.shouldHighlight?.(pathname) ||
                            pathname === subroute.path
                          }
                          onClick={() => {
                            navigate(subroute.path);
                            close();
                          }}
                          disabled={route.navbarProperties?.isDisabled?.(
                            leagues.find((l) => l.id === currentLeague)!.type
                          )}
                        />
                      ))}
                  </Collapse>
                )}
              </Fragment>
            ))}
          <NavLink
            label="Reload all data"
            leftSection={makeIcon(ArrowClockwise)}
            variant="light"
            // FIXME: fix this
            // disabled={loading}
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
