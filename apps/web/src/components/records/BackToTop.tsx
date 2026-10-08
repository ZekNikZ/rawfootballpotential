import { Anchor, Group } from "@mantine/core";

/** Left-aligned link at the end of a record section. */
export function BackToTop() {
  return (
    <Group justify="flex-start">
      <Anchor
        component="button"
        type="button"
        size="sm"
        onClick={() =>
          window.scrollTo({
            top: 0,
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
              ? "auto"
              : "smooth",
          })
        }
      >
        Back to top ↑
      </Anchor>
    </Group>
  );
}
