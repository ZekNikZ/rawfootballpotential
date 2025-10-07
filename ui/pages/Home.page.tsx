import { SimpleGrid, Stack, Title } from "@mantine/core";
import BlogPost from "../components/blog/BlogPost";
import useRss from "../hooks/useRss";

export function HomePage() {
  const rssFeed = useRss(
    "https://api.allorigins.win/raw?url=https://jaytalentedmo.wixsite.com/raw-football-potenti/blog-feed.xml"
  );

  return (
    <Stack>
      <Title order={1}>Latest Blog Posts</Title>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
        {rssFeed &&
          rssFeed.items.map((item) => (
            <BlogPost
              key={item.link}
              title={item.title ?? ""}
              date={item.pubDate ?? ""}
              author={item.creator ?? "Unknown Author"}
              previewText={item.contentSnippet ?? item.content ?? ""}
              href={item.link ?? "#"}
              imgSrc={item.enclosure?.url ?? undefined}
            />
          ))}
      </SimpleGrid>
    </Stack>
  );
}
