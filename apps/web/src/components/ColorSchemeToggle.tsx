import { ActionIcon, useComputedColorScheme, useMantineColorScheme } from "@mantine/core";
import { Moon, Sun } from "@phosphor-icons/react";

export function ColorSchemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  const scheme = useComputedColorScheme("light");
  return (
    <ActionIcon
      variant="default"
      size="lg"
      aria-label={scheme === "light" ? "Switch to dark mode" : "Switch to light mode"}
      onClick={() => setColorScheme(scheme === "light" ? "dark" : "light")}
    >
      {scheme === "light" ? <Moon size={20} /> : <Sun size={20} />}
    </ActionIcon>
  );
}
