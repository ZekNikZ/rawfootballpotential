import { useEffect, useState } from "react";
import Parser from "rss-parser";

export default function useRss(url: string) {
  const [feed, setFeed] = useState<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Record<string, any> & Parser.Output<Record<string, any>>) | null
  >(null);

  useEffect(() => {
    async function fetchRss() {
      const parser: Parser = new Parser();
      console.log("Created parser!");

      try {
        const response = await fetch(url);
        const text = await response.text();
        const feed = await parser.parseString(text);
        setFeed(feed);
      } catch (error) {
        console.error("Error fetching RSS feed:", error);
      }
    }

    fetchRss();
  }, [url]);

  return feed;
}
