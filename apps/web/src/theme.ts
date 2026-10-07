import { createTheme } from "@mantine/core";

// The same default Mantine look as the current site; nothing custom beyond the brand font.
export const theme = createTheme({
  primaryColor: "blue",
  headings: { fontWeight: "700" },
});
