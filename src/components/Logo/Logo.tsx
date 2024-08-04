import { Group, Image, MantineColor, Text } from "@mantine/core";
import logoBlue from "./logo-blue.svg";
import logoRed from "./logo-red.svg";

interface Props {
  color: MantineColor;
}

export default function Logo({ color }: Props) {
  return (
    <Group gap="xs" align="center">
      <Image src={color === "blue" ? logoBlue : logoRed} h={36} />
      <Text size="2.2rem" ff="Bebas Neue">
        Raw Football Potential
      </Text>
    </Group>
  );
}
