import { LoadingOverlay, MantineProvider } from "@mantine/core";
import { useEffect } from "react";
import { Router } from "./components/Router";
import { Notifications } from "@mantine/notifications";
import { useGlobalData } from "./providers";
import { Api, THEME } from "../utils";

function App() {
  const { config, setConfig, setCurrentLeague } = useGlobalData();

  useEffect(() => {
    async function fetcher() {
      const response = await Api.getConfig();
      if (response.success) {
        setConfig(response.data);
        setCurrentLeague(
          response.data.leagues[0].years.reduce((prev, current) =>
            prev && prev.year > current.year ? prev : current
          ).leagueId
        );
      } else {
        // TODO: error handling
        console.error(response.error);
      }
    }

    fetcher();
  }, [setConfig, setCurrentLeague]);

  return (
    <MantineProvider theme={THEME} defaultColorScheme="auto">
      <Notifications zIndex={2000} />
      {!config ? <LoadingOverlay visible /> : <Router />}
    </MantineProvider>
  );
}

export default App;
