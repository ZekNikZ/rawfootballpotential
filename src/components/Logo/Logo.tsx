import { Group, Image, MantineColor, Text } from "@mantine/core";
import logoBlue from "./logo-blue.svg";
import logoRed from "./logo-red.svg";
import { useDocumentTitle } from "@mantine/hooks";
import { useGlobalData } from "../../providers";

interface Props {
  color: MantineColor;
}

export default function Logo({ color }: Props) {
  const { config } = useGlobalData();

  const title = config?.metadata.name ?? "Fantasy Football";

  useDocumentTitle(title);

  return (
    <Group gap="xs" align="center">
      <Image src={color === "blue" ? logoBlue : logoRed} h={36} />
      <Text size="2.2rem" ff="Bebas Neue">
        {title}
      </Text>
    </Group>
  );
}
