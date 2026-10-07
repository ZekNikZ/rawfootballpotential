import { Anchor, Card, Image, SimpleGrid, Skeleton, Stack, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import { blogQuery } from "../../api/queries";
import type { BlogPost } from "../../api/schemas";
import { QueryError } from "../QueryState";

function PostCard({ post }: { post: BlogPost }) {
  const date = post.date ? dayjs(post.date).format("MMMM D, YYYY") : null;
  return (
    <Card shadow="sm" padding="lg" radius="sm" withBorder>
      {post.imgSrc && (
        <Card.Section>
          <Image src={post.imgSrc} alt="" h={200} loading="lazy" fit="cover" />
        </Card.Section>
      )}
      <Stack gap="xs" mt={post.imgSrc ? "md" : 0}>
        <Title order={3}>{post.title}</Title>
        <Text fs="italic" c="dimmed" fz="sm">
          {[date, post.author].filter(Boolean).join(" • ")}
        </Text>
        <Text lineClamp={4}>{post.previewText}</Text>
        <Anchor href={post.link} target="_blank" rel="noopener noreferrer">
          Continue Reading
        </Anchor>
      </Stack>
    </Card>
  );
}

export function BlogPosts() {
  const q = useQuery(blogQuery());
  return (
    <Stack gap="sm" component="section" aria-labelledby="h-blog">
      <Title order={2} id="h-blog">
        Latest Blog Posts
      </Title>
      {q.isPending && (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} h={320} />
          ))}
        </SimpleGrid>
      )}
      {q.isError && <QueryError error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
          {q.data.posts.map((post) => (
            <PostCard key={post.link} post={post} />
          ))}
        </SimpleGrid>
      )}
      {q.data && q.data.posts.length === 0 && <Text c="dimmed">No posts yet.</Text>}
    </Stack>
  );
}
