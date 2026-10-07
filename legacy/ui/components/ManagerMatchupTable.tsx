import { Group, Stack, Table, Title, useComputedColorScheme } from "@mantine/core";
import { Manager, ManagerId, ManagerMatchupData } from "../../types";
import formatter from "format-number";
import interpolate from "color-interpolate";

interface Props {
  managers: Manager[];
  matchups: ManagerMatchupData;
}

export default function ManagerMatchupTable(props: Props) {
  const computedColorScheme = useComputedColorScheme("light");

  const colormap = interpolate([
    "#fa5252",
    computedColorScheme === "light" ? "#ffffff" : "#242424",
    "#40c057",
  ]);

  console.log(colormap(0.5));

  return (
    <Stack gap={10}>
      <Title order={2}>Career Manager Matchups</Title>
      <Table.ScrollContainer minWidth={500}>
        <Table withTableBorder withColumnBorders>
          <Table.Caption>
            <Group>Data available from {props.matchups.dataAvailableFromYear}</Group>
          </Table.Caption>
          <Table.Thead>
            <Table.Tr>
              <Table.Th></Table.Th>
              {props.managers
                .sort((a, b) => a.name.localeCompare(b.name))
                .concat({ managerId: "MEDIAN" as ManagerId, name: "(MEDIAN)" }) // Add median row
                .map((manager) => (
                  // Rotate the manager names to be in the header
                  <Table.Th
                    key={manager.managerId as string}
                    style={{
                      writingMode: "vertical-rl",
                      rotate: "210deg",
                      borderBlockEnd:
                        "calc(0.0625rem * var(--mantine-scale)) solid var(--table-border-color)",
                    }}
                  >
                    {manager.name}
                  </Table.Th>
                ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {props.managers
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((manager) => (
                <Table.Tr key={manager.managerId as string}>
                  <Table.Th>{manager.name}</Table.Th>
                  {props.managers
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .concat({ managerId: "MEDIAN" as ManagerId, name: "MEDIAN" }) // Add median row
                    .map((opponent) => {
                      const matchup = props.matchups.data[manager.managerId][opponent.managerId];
                      const percentage = matchup.wins / matchup.count;
                      if (matchup.count === 0) {
                        return <Table.Td key={opponent.managerId as string}>—</Table.Td>;
                      } else {
                        return (
                          <Table.Td
                            key={opponent.managerId as string}
                            style={{
                              backgroundColor: colormap(percentage),
                            }}
                          >
                            {formatter({
                              round: 2,
                              suffix: "%",
                              padRight: 2,
                            })(percentage * 100)}
                          </Table.Td>
                        );
                      }
                    })}
                </Table.Tr>
              ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}
