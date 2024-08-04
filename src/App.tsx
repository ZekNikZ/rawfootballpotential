import { LoadingOverlay, MantineProvider } from "@mantine/core";
import React, { useEffect, useState } from "react";
import theme from "./utils/theme";
import { Router } from "./components/Router";
import { Notifications } from "@mantine/notifications";
import { GetConfigResponse } from "./types/api/config";
import { getConfig } from "./utils/api";

function App() {
  const [config, setConfig] = useState<GetConfigResponse>();

  useEffect(() => {
    getConfig().then(setConfig);
  }, []);

  return (
    <React.StrictMode>
      <MantineProvider theme={theme} defaultColorScheme="auto">
        <Notifications zIndex={2000} />
        {!config ? <LoadingOverlay visible /> : <Router />}
      </MantineProvider>
    </React.StrictMode>
  );
}

export default App;
