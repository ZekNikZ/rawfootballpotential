import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** True when the module lives in one of the given npm packages (works with Windows and POSIX paths). */
const inPackages =
  (...packages: string[]) =>
  (id: string) => {
    const path = id.replaceAll("\\", "/");
    return packages.some((p) => path.includes(`/node_modules/${p}/`));
  };

export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        // React and TanStack Query in their own long-lived chunks (Mantine stays split by use, so a page only loads the
        // parts it needs): they change rarely, so after a deploy a returning visitor re-downloads only the (small)
        // app chunk, and no single chunk grows past the size warning.
        codeSplitting: {
          groups: [
            { name: "react", test: inPackages("react", "react-dom", "scheduler", "react-router") },
            { name: "query", test: inPackages("@tanstack/query-core", "@tanstack/react-query") },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    // Same-origin like production: Caddy proxies /api to the API container.
    proxy: { "/api": "http://localhost:8000" },
  },
});
