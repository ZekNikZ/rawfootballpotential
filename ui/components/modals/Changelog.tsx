import { Accordion, Group, Modal, Text } from "@mantine/core";
import dayjs from "dayjs";
import Markdown from "react-markdown";
import { CHANGELOG } from "../../../utils/changelog";

interface Props {
  open: boolean;
  onClose: () => void;
}

const Changelog = (props: Props) => {
  return (
    <Modal
      opened={props.open}
      onClose={props.onClose}
      title={<Text size="xl">Version History</Text>}
      centered
      size="lg"
    >
      <Accordion multiple defaultValue={[CHANGELOG[0].version]}>
        {CHANGELOG.map(({ version, title, description, date }) => (
          <Accordion.Item key={version} value={version}>
            <Accordion.Control>
              <Group gap={10} style={{ flexWrap: "nowrap" }}>
                <Text fw="bold">{dayjs(date).format("M/D/YYYY")}</Text>
                <Text>v{version}</Text>
                <Text
                  fs="italic"
                  style={{
                    whiteSpace: "nowrap",
                  }}
                >
                  {title}
                </Text>
              </Group>
            </Accordion.Control>
            <Accordion.Panel
              style={{
                width: "100%",
              }}
            >
              <Markdown className="changelog-markdown">{description}</Markdown>
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
    </Modal>
  );
};

export default Changelog;
