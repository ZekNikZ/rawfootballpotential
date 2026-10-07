import "@mantine/core/styles.css";
import "@fontsource/bebas-neue";
import "twemoji-colr-font/twemoji.css";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import { router } from "./app/router";
import { browserRecoveryEnv, installPreloadRecovery } from "./lib/preload-recovery";
import { theme } from "./theme";

// A failed lazy route leaves the router in `loading` with the page the visitor clicked; reload straight to it.
installPreloadRecovery(
  browserRecoveryEnv(() => {
    const next = router.state.navigation.location;
    return next ? `${next.pathname}${next.search}${next.hash}` : null;
  })
);

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <MantineProvider theme={theme} defaultColorScheme="auto">
        <RouterProvider router={router} />
      </MantineProvider>
    </QueryClientProvider>
  </StrictMode>
);
