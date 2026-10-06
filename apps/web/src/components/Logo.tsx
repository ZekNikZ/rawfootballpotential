import { Group, Image, Text } from "@mantine/core";
import logoBlue from "../assets/logo-blue.svg";
import logoRed from "../assets/logo-red.svg";

interface Props {
  color: string;
  name: string;
  shortName: string;
}

/** Brand mark: the league-colored logo and the site name (short name on very small screens). */
export function Logo({ color, name, shortName }: Props) {
  return (
    <Group gap="xs" align="center" wrap="nowrap">
      <Image src={color === "red" ? logoRed : logoBlue} h={36} w={36} alt="" />
      <Text size="2.2rem" ff="Bebas Neue" lh={1} visibleFrom="xs">
        {name}
      </Text>
      <Text size="2.2rem" ff="Bebas Neue" lh={1} hiddenFrom="xs">
        {shortName}
      </Text>
    </Group>
  );
}
