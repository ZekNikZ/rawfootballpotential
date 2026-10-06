import { Accordion, Group, Modal, Text } from "@mantine/core";
import dayjs from "dayjs";
import Markdown from "react-markdown";
import type { SiteResponse } from "../api/schemas";
import classes from "./VersionHistory.module.css";

interface Props {
  opened: boolean;
  onClose: () => void;
  changelog: SiteResponse["changelog"];
}

/** The single version-history modal; its content is managed server-side (admin UI). */
export function VersionHistory({ opened, onClose, changelog }: Props) {
  const entries = [...changelog].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={<Text size="xl">Version History</Text>}
      centered
      size="lg"
    >
      {entries.length === 0 ? (
        <Text c="dimmed">No releases yet.</Text>
      ) : (
        <Accordion multiple defaultValue={entries[0] ? [entries[0].version] : []}>
          {entries.map(({ version, title, description, date }) => (
            <Accordion.Item key={version} value={version}>
              <Accordion.Control>
                <Group gap="xs" wrap="wrap">
                  <Text fw="bold">{dayjs(date).format("M/D/YYYY")}</Text>
                  <Text>v{version}</Text>
                  <Text fs="italic">{title}</Text>
                </Group>
              </Accordion.Control>
              <Accordion.Panel>
                <div className={classes.markdown}>
                  <Markdown>{description}</Markdown>
                </div>
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
      )}
    </Modal>
  );
}
