import { LoadingOverlay } from "@mantine/core";
import { useCallback, useEffect } from "react";
import { Router } from "./components/Router";
import { useGlobalData } from "./providers";
import { useDisclosure } from "@mantine/hooks";
import { CHANGELOG } from "../utils/changelog";
import Changelog from "./components/modals/Changelog";

function App() {
  const { config, loadData } = useGlobalData();

  const [changelogOpened, { open, close }] = useDisclosure(false);

  const openChangelog = useCallback(() => {
    const lastChangelogVersionViewed = localStorage.getItem("last-changelog-version-viewed");
    if (lastChangelogVersionViewed !== CHANGELOG[0].version) {
      open();
    }
  }, [open]);

  const onChangelogClose = () => {
    close();
    localStorage.setItem("last-changelog-version-viewed", CHANGELOG[0].version);
  };

  useEffect(() => {
    loadData(openChangelog);
  }, [loadData, openChangelog]);

  return (
    <>
      <Changelog open={changelogOpened} onClose={onChangelogClose} />
      {!config ? <LoadingOverlay visible /> : <Router />}
    </>
  );
}

export default App;
