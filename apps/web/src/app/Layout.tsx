import {
  ActionIcon,
  AppShell,
  Badge,
  Box,
  Burger,
  Group,
  NativeSelect,
  NavLink,
  ScrollArea,
  SegmentedControl,
  Text,
} from "@mantine/core";
import { useDisclosure, useDocumentTitle } from "@mantine/hooks";
import { TextAlignLeft } from "@phosphor-icons/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  Link,
  Navigate,
  Outlet,
  useLocation,
  useMatches,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";
import { leaguesQuery, siteQuery } from "../api/queries";
import type { League } from "../api/schemas";
import { ColorSchemeToggle } from "../components/ColorSchemeToggle";
import { Logo } from "../components/Logo";

import { LeagueContext } from "../lib/league-context";
import { seasonLabel } from "../lib/format";
import { PageTitleProvider, usePageTitleOverride } from "../lib/page-title";
import { NAV, type NavItem } from "./nav";
import classes from "./Layout.module.css";

// react-markdown is only needed once the modal is first opened.
const VersionHistory = lazy(() =>
  import("../components/VersionHistory").then((m) => ({ default: m.VersionHistory }))
);

const LAST_VERSION_KEY = "rfp-last-version-viewed";

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // private mode / blocked storage: the modal simply opens again next visit
  }
}

/** Routes that show the season picker: season pages (`/:league/:season/...`) and Home. */
function useSeasonPicker(league: { slug: string; seasons: { year: number }[] }, latest: number) {
  const params = useParams();
  const [search, setSearch] = useSearchParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const years = league.seasons.map((s) => s.year);
  const isHome = pathname === `/${league.slug}` || pathname === `/${league.slug}/`;
  const routeSeason = params.season ? Number(params.season) : null;
  const visible = isHome || routeSeason !== null;
  const queried = Number(search.get("season"));
  const selected =
    routeSeason !== null && years.includes(routeSeason)
      ? routeSeason
      : years.includes(queried)
        ? queried
        : latest;
  const select = (year: number) => {
    if (routeSeason !== null) {
      navigate(pathname.replace(`/${routeSeason}/`, `/${year}/`) + window.location.search);
    } else {
      setSearch(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (year === latest) next.delete("season");
          else next.set("season", String(year));
          return next;
        },
        { replace: true }
      );
    }
  };
  return { visible, selected, years, select };
}

function isActive(item: NavItem, league: League, season: number, pathname: string): boolean {
  if (item.children) return item.children.some((c) => isActive(c, league, season, pathname));
  if (!item.to) return false;
  const target = item.to(league, season);
  return item.end ? pathname === target : pathname === target || pathname.startsWith(`${target}/`);
}

interface NavProps {
  item: NavItem;
  league: League;
  season: number;
  pathname: string;
  close: () => void;
}

function NavEntry({ item, league, season, pathname, close }: NavProps) {
  const Icon = item.icon;
  const leftSection = <Icon size={20} />;
  if (item.children) {
    const active = isActive(item, league, season, pathname);
    return (
      <NavLink
        label={item.label}
        leftSection={leftSection}
        defaultOpened={active}
        childrenOffset={28}
      >
        {item.children
          .filter((c) => !c.only || c.only === league.type)
          .map((c) => (
            <NavEntry
              key={c.key}
              item={c}
              league={league}
              season={season}
              pathname={pathname}
              close={close}
            />
          ))}
      </NavLink>
    );
  }
  if (item.soon) {
    return (
      <NavLink
        label={item.label}
        leftSection={leftSection}
        disabled
        rightSection={
          <Badge size="xs" variant="light" color="gray">
            Soon
          </Badge>
        }
      />
    );
  }
  const active = isActive(item, league, season, pathname);
  return (
    <NavLink
      component={Link}
      to={item.to!(league, season)}
      label={item.label}
      leftSection={leftSection}
      active={active}
      variant="light"
      aria-current={active ? "page" : undefined}
      onClick={close}
    />
  );
}

export function Layout() {
  const { data: leaguesData } = useSuspenseQuery(leaguesQuery());
  const { data: site } = useSuspenseQuery(siteQuery());
  const { league: slug } = useParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [navOpened, { toggle: toggleNav, close: closeNav }] = useDisclosure();
  const [historyOpened, { open: openHistory, close: closeHistory }] = useDisclosure(false);

  const leagues = leaguesData.leagues;
  const league = leagues.find((l) => l.slug === slug);
  const latestSeason = league?.seasons.at(-1);
  const picker = useSeasonPicker(league ?? { seasons: [], slug: "" }, latestSeason?.year ?? 0);

  const newest = useMemo(
    () => [...site.changelog].sort((a, b) => b.date.localeCompare(a.date))[0]?.version ?? null,
    [site.changelog]
  );
  // Open the version history once per new version.
  const [autoOpened, setAutoOpened] = useState(false);
  useEffect(() => {
    if (autoOpened || !newest) return;
    setAutoOpened(true);
    if (readStored(LAST_VERSION_KEY) !== newest) openHistory();
  }, [autoOpened, newest, openHistory]);
  const onHistoryClose = () => {
    closeHistory();
    if (newest) writeStored(LAST_VERSION_KEY, newest);
  };

  if (!league || !latestSeason) return <Navigate to="/" replace />;

  const siteName = site.site?.name ?? "Raw Football Potential";
  const shortName = site.site?.shortName ?? "RFP";

  return (
    <LeagueContext value={{ league, leagues, latestSeason }}>
      <PageTitleProvider>
        <DocumentTitle leagueName={league.name} siteName={siteName} />
        {historyOpened && (
          <Suspense fallback={null}>
            <VersionHistory opened onClose={onHistoryClose} changelog={site.changelog} />
          </Suspense>
        )}
        <AppShell
          header={{ height: 60 }}
          navbar={{ width: 250, breakpoint: "sm", collapsed: { mobile: !navOpened } }}
          padding="md"
        >
          <AppShell.Header p="sm">
            <Group h="100%" justify="space-between" wrap="nowrap">
              <Group gap="xs" wrap="nowrap">
                <Burger
                  opened={navOpened}
                  onClick={toggleNav}
                  hiddenFrom="sm"
                  size="sm"
                  aria-label="Toggle navigation"
                />
                <Link
                  to={`/${league.slug}`}
                  className={classes.brand}
                  aria-label={`${siteName} home`}
                >
                  <Group gap={0} wrap="nowrap">
                    <Logo color={league.color} name={siteName} shortName={shortName} />
                    <Text size="2.2rem" ff="Bebas Neue" lh={1} c={league.color} visibleFrom="sm">
                      &nbsp;{league.name}
                    </Text>
                  </Group>
                </Link>
              </Group>
              <Group gap="xs" wrap="nowrap">
                <ActionIcon
                  variant="default"
                  size="lg"
                  aria-label="Open version history"
                  onClick={openHistory}
                  visibleFrom="sm"
                >
                  <TextAlignLeft size={20} />
                </ActionIcon>
                <ColorSchemeToggle />
              </Group>
            </Group>
          </AppShell.Header>

          <AppShell.Navbar p="sm">
            <ScrollArea type="never">
              <SegmentedControl
                fullWidth
                value={league.slug}
                color={league.color}
                data={leagues.map((l) => ({ value: l.slug, label: l.name }))}
                onChange={(value) => {
                  navigate(`/${value}`);
                  closeNav();
                }}
                aria-label="League"
              />
              {picker.visible && (
                <NativeSelect
                  mt="xs"
                  aria-label="Season"
                  value={String(picker.selected)}
                  onChange={(e) => picker.select(Number(e.target.value))}
                  data={[...picker.years]
                    .reverse()
                    .map((y) => ({ value: String(y), label: seasonLabel(y) }))}
                />
              )}
              <Box mt="xs">
                {NAV.filter((i) => !i.only || i.only === league.type).map((item) => (
                  <NavEntry
                    key={item.key}
                    item={item}
                    league={league}
                    season={picker.selected}
                    pathname={pathname}
                    close={closeNav}
                  />
                ))}
                <NavLink
                  label="Version History"
                  leftSection={<TextAlignLeft size={20} />}
                  onClick={() => {
                    openHistory();
                    closeNav();
                  }}
                />
                <Text size="xs" c="dimmed" mt="md" px="sm">
                  Emoji: Twemoji, © Twitter, Inc. and other contributors, CC-BY 4.0
                </Text>
              </Box>
            </ScrollArea>
          </AppShell.Navbar>

          <AppShell.Main>
            <Outlet />
          </AppShell.Main>
        </AppShell>
      </PageTitleProvider>
    </LeagueContext>
  );
}

/** Titles come from route metadata (`handle.title`), refined by pages through `usePageTitle`. */
function DocumentTitle({ leagueName, siteName }: { leagueName: string; siteName: string }) {
  const matches = useMatches();
  const override = usePageTitleOverride();
  const routeTitle = [...matches]
    .reverse()
    .map((m) => (m.handle as { title?: string } | undefined)?.title)
    .find((t) => t !== undefined);
  const title = override ?? routeTitle;
  useDocumentTitle(
    title ? `${title} · ${leagueName} · ${siteName}` : `${leagueName} · ${siteName}`
  );
  return null;
}
