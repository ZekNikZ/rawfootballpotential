import { createTheme } from "@mantine/core";

// Mantine's default system font stack with the bundled Twemoji colour-emoji font (main.tsx) ahead of the platform emoji
// fonts, so emojis look the same on every device (Windows' Segoe UI Emoji lacks newer ones such as the tombstone).
// Text glyphs still come from the system fonts first; Twemoji is only reached for characters they lack.
const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, Twemoji, sans-serif';

// The same default Mantine look as the current site; nothing custom beyond the brand and emoji fonts.
export const theme = createTheme({
  primaryColor: "blue",
  fontFamily: FONT_STACK,
  headings: { fontFamily: FONT_STACK, fontWeight: "700" },
});
