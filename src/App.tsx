import { MantineProvider } from "@mantine/core";
import React from "react";
import theme from "./utils/theme";
import { Router } from "./components/Router";
import { Notifications } from "@mantine/notifications";

function App() {
  return (
    <React.StrictMode>
      <MantineProvider theme={theme} defaultColorScheme="auto">
        <Notifications zIndex={2000} />
        <Router />
      </MantineProvider>
    </React.StrictMode>
  );
}

export default App;
