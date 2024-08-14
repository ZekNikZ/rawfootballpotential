import ReactDOM from "react-dom/client";
import App from "./App.tsx";

import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "@fontsource/bebas-neue";
import { GlobalDataProvider } from "./providers";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { THEME } from "../utils";

ReactDOM.createRoot(document.getElementById("root")!).render(
  // <React.StrictMode>
  <GlobalDataProvider>
    <MantineProvider theme={THEME} defaultColorScheme="auto">
      <Notifications zIndex={2000} />
      <App />
    </MantineProvider>
  </GlobalDataProvider>
  // </React.StrictMode>
);
