import { LoadingOverlay } from "@mantine/core";
import { useEffect } from "react";
import { Router } from "./components/Router";
import { useGlobalData } from "./providers";

function App() {
  const { config, loadData } = useGlobalData();

  useEffect(() => {
    loadData();
  }, [loadData]);

  return !config ? <LoadingOverlay visible /> : <Router />;
}

export default App;
