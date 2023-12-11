import { Group, Image, Text } from '@mantine/core';
import logo from './logo.svg';

export default function Logo() {
  return (
    <Group gap="xs" align="center">
      <Image src={logo} h={36} />
      <Text size="2.2rem" ff="Bebas Neue">
        Raw Football Potential
      </Text>
    </Group>
  );
}
