import { Combobox, Group, Text, TextInput, useCombobox } from "@mantine/core";
import { useHotkeys } from "@mantine/hooks";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { catalogQuery, searchIndexQuery } from "../api/queries";
import type { League } from "../api/schemas";
import { NAV, type NavItem } from "../app/nav";
import { slugify } from "./records/section-state";

interface Item {
  /** Unique within its group. */
  key: string;
  group: "Pages" | "Records" | "Teams & managers";
  title: string;
  detail: string | null;
  /** Lowercased text the query is matched against. */
  haystack: string;
  to: string;
}

const MAX_PER_GROUP = 6;
const GROUPS: Item["group"][] = ["Pages", "Teams & managers", "Records"];

/** Records live on one of four pages; the section slug in the URL opens the record and the hash scrolls to it. */
function recordPath(slug: string, category: string, section: string, id: string): string {
  const page =
    category === "overall"
      ? "overall"
      : category === "single-season"
        ? "single-season"
        : section === "Power Rankings"
          ? "power-rankings"
          : "managers";
  const key = slugify(section);
  return `/${slug}/records/${page}?${key}.rec=${encodeURIComponent(id)}#h-${key}`;
}

function flattenNav(items: NavItem[], league: League, season: number, parent?: string): Item[] {
  return items
    .filter((i) => !i.only || i.only === league.type)
    .flatMap((i): Item[] => {
      if (i.children) return flattenNav(i.children, league, season, i.label);
      if (!i.to || i.soon) return [];
      return [
        {
          key: `nav-${i.key}`,
          group: "Pages",
          title: i.label,
          detail: parent ?? null,
          haystack: `${i.label} ${parent ?? ""}`.toLowerCase(),
          to: i.to(league, season),
        },
      ];
    });
}

/** Every token of the query has to appear; earlier and word-start matches rank higher. */
function score(item: Item, tokens: string[]): number {
  let total = 0;
  for (const t of tokens) {
    const at = item.haystack.indexOf(t);
    if (at < 0) return -1;
    total += at === 0 ? 0 : item.haystack[at - 1] === " " ? 1 : 3;
  }
  return total + item.title.length / 1000;
}

/**
 * The header search: pages, teams and managers (including their old names), and records. Press "/" or Ctrl+K to focus it.
 */
export function GlobalSearch({
  league,
  season,
  onNavigate,
}: {
  league: League;
  season: number;
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const combobox = useCombobox({ onDropdownClose: () => combobox.resetSelectedOption() });
  const catalog = useQuery(catalogQuery(league.slug));
  const index = useQuery(searchIndexQuery(league.slug));
  useHotkeys([
    ["mod+K", () => inputRef.current?.focus()],
    ["/", () => inputRef.current?.focus()],
  ]);

  const items = useMemo<Item[]>(() => {
    const pages = flattenNav(NAV, league, season);
    pages.push(
      {
        key: "page-fame",
        group: "Pages",
        title: "Hall of Fame",
        detail: "Trophies & Halls",
        haystack: "hall of fame best greatest",
        to: `/${league.slug}/records?view=fame`,
      },
      {
        key: "page-shame",
        group: "Pages",
        title: "Hall of Shame",
        detail: "Trophies & Halls",
        haystack: "hall of shame worst",
        to: `/${league.slug}/records?view=shame`,
      },
      {
        key: "page-trade-partners",
        group: "Pages",
        title: "Trade Partners",
        detail: "Manager records",
        haystack: "trade partners who trades with whom",
        to: `/${league.slug}/records/managers#h-trade-partners`,
      }
    );
    const records: Item[] = (catalog.data?.records ?? []).map((r) => ({
      key: `rec-${r.id}`,
      group: "Records",
      title: r.title,
      detail: r.section,
      haystack: `${r.title} ${r.summary ?? ""} ${r.section}`.toLowerCase(),
      to: recordPath(league.slug, r.category, r.section, r.id),
    }));
    const teams: Item[] = (index.data?.franchises ?? []).map((f) => {
      const old = f.teamNames.filter((n) => n !== f.team);
      const others = f.managers.filter((m) => m !== f.manager);
      return {
        key: `team-${f.id}`,
        group: "Teams & managers",
        title: f.team ?? `Franchise ${f.id}`,
        detail:
          [
            f.manager,
            old.length ? `formerly ${old.slice(0, 3).join(", ")}` : null,
            others.length ? `also ${others.join(", ")}` : null,
          ]
            .filter(Boolean)
            .join(" · ") || null,
        haystack: [f.team, ...f.teamNames, f.manager, ...f.managers]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
        to: `/${league.slug}/franchises/${f.id}`,
      };
    });
    return [...pages, ...teams, ...records];
  }, [league, season, catalog.data, index.data]);

  const results = useMemo(() => {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [];
    return GROUPS.map((group) => ({
      group,
      items: items
        .filter((i) => i.group === group)
        .map((i) => ({ i, s: score(i, tokens) }))
        .filter((x) => x.s >= 0)
        .sort((a, b) => a.s - b.s)
        .slice(0, MAX_PER_GROUP)
        .map((x) => x.i),
    })).filter((g) => g.items.length > 0);
  }, [items, query]);

  const go = (to: string) => {
    setQuery("");
    combobox.closeDropdown();
    inputRef.current?.blur();
    onNavigate?.();
    void navigate(to);
  };

  return (
    <Combobox
      store={combobox}
      width={360}
      position="bottom-start"
      withinPortal
      onOptionSubmit={(value) => {
        const hit = items.find((i) => `${i.group}:${i.key}` === value);
        if (hit) go(hit.to);
      }}
    >
      <Combobox.Target>
        <TextInput
          ref={inputRef}
          aria-label="Search the site"
          placeholder="Search records, teams, pages"
          leftSection={<MagnifyingGlass size={16} />}
          rightSection={
            query ? undefined : (
              <Text size="xs" c="dimmed" visibleFrom="md">
                /
              </Text>
            )
          }
          value={query}
          onChange={(e) => {
            setQuery(e.currentTarget.value);
            combobox.openDropdown();
            combobox.updateSelectedOptionIndex();
          }}
          onFocus={() => query && combobox.openDropdown()}
          onBlur={() => combobox.closeDropdown()}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setQuery("");
              inputRef.current?.blur();
            }
          }}
        />
      </Combobox.Target>
      <Combobox.Dropdown hidden={query.trim() === ""}>
        <Combobox.Options mah={420} style={{ overflowY: "auto" }}>
          {results.length === 0 ? (
            <Combobox.Empty>Nothing found</Combobox.Empty>
          ) : (
            results.map((g) => (
              <Combobox.Group key={g.group} label={g.group}>
                {g.items.map((i) => (
                  <Combobox.Option key={i.key} value={`${i.group}:${i.key}`}>
                    <Group gap="xs" wrap="nowrap" justify="space-between">
                      <Text size="sm" truncate>
                        {i.title}
                      </Text>
                      {i.detail && (
                        <Text size="xs" c="dimmed" truncate maw="55%">
                          {i.detail}
                        </Text>
                      )}
                    </Group>
                  </Combobox.Option>
                ))}
              </Combobox.Group>
            ))
          )}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}
