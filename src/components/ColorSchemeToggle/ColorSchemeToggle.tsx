import { ActionIcon, useComputedColorScheme, useMantineColorScheme } from '@mantine/core';
import { IconMoon, IconSun } from '@tabler/icons-react';

export function ColorSchemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme('light');

  return (
    <ActionIcon
      variant="default"
      aria-label="Toggle color scheme"
      onClick={() => setColorScheme(computedColorScheme === 'light' ? 'dark' : 'light')}
      size="lg"
    >
      {computedColorScheme === 'light' && (
        <IconMoon style={{ width: '70%', height: '70%' }} stroke={1.5} />
      )}
      {computedColorScheme === 'dark' && (
        <IconSun style={{ width: '70%', height: '70%' }} stroke={1.5} />
      )}
    </ActionIcon>
  );
}
