import { Card, Title, Text } from "@mantine/core";
import dayjs from "dayjs";

interface Props {
  title: string;
  date: string;
  author: string;
  previewText: string;
  imgSrc?: string;
  href: string;
}

export default function BlogPost(props: Props) {
  const date = new Date(props.date);
  const dateString = dayjs(date).format("MMMM D, YYYY");

  return (
    <Card shadow="sm" padding="lg" radius="sm" withBorder>
      <Card.Section>
        {props.imgSrc && (
          <img
            src={props.imgSrc}
            alt={props.title}
            style={{ width: "100%", height: "200px", objectFit: "cover" }}
          />
        )}
      </Card.Section>
      <Card.Section p="sm">
        <Title order={3}>{props.title}</Title>
        <Text fs="italic" mb="xs" c="dimmed" fz="sm">
          {dateString} • {props.author}
        </Text>
        <Text mb="xs">{props.previewText}</Text>
        <a href={props.href} target="_blank" rel="noopener noreferrer">
          Continue Reading
        </a>
      </Card.Section>
    </Card>
  );
}
