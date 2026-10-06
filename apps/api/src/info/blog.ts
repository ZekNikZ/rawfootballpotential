import { rawPayload, and, desc, eq } from "@rfp/db";
import type { Db } from "@rfp/db";
import { XMLParser } from "fast-xml-parser";
import { createHash } from "node:crypto";

export interface BlogPost {
  title: string;
  link: string;
  date: string;
  author: string;
  previewText: string;
  imgSrc: string | null;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  cdataPropName: "__cdata",
  trimValues: true,
});

const text = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return String((v as { __cdata?: unknown })["__cdata"] ?? "");
  return String(v);
};

export function parseFeed(xml: string): BlogPost[] {
  const doc = parser.parse(xml) as { rss?: { channel?: { item?: unknown } } };
  const raw = doc.rss?.channel?.item;
  const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return items.map((it: Record<string, unknown>) => {
    const enclosure = it.enclosure as Record<string, unknown> | undefined;
    const date = new Date(text(it.pubDate));
    return {
      title: text(it.title),
      link: text(it.link),
      date: Number.isNaN(date.getTime()) ? "" : date.toISOString(),
      author: text(it["dc:creator"]),
      previewText: text(it.description),
      imgSrc: enclosure?.["@_url"] ? String(enclosure["@_url"]) : null,
    };
  });
}

const TTL_MS = 60 * 60 * 1000;

/**
 * The blog's RSS feed, fetched server-side (no third-party CORS proxy in the browser) and cached in raw_payload for an
 * hour. If the source is down the last copy is served.
 */
export async function blogPosts(db: Db, feedUrl: string): Promise<BlogPost[]> {
  const params = { url: feedUrl };
  const paramsHash = createHash("sha1").update(feedUrl).digest("hex").slice(0, 16);
  const [latest] = await db
    .select()
    .from(rawPayload)
    .where(
      and(
        eq(rawPayload.source, "blog"),
        eq(rawPayload.endpoint, "feed"),
        eq(rawPayload.paramsHash, paramsHash)
      )
    )
    .orderBy(desc(rawPayload.fetchedAt))
    .limit(1);
  if (latest?.body && Date.now() - latest.fetchedAt.getTime() < TTL_MS)
    return parseFeed(latest.body);
  try {
    const res = await fetch(feedUrl, {
      headers: { accept: "application/rss+xml, application/xml" },
    });
    if (!res.ok) throw new Error(`blog feed returned ${res.status}`);
    const body = await res.text();
    const posts = parseFeed(body);
    await db.insert(rawPayload).values({
      source: "blog",
      endpoint: "feed",
      params,
      paramsHash,
      body,
      httpStatus: res.status,
    });
    return posts;
  } catch (err) {
    if (latest?.body) return parseFeed(latest.body);
    throw err;
  }
}
