import { NativeSelect, Stack, Title } from "@mantine/core";
import { RecordCategory } from "../../types";
import { useMemo, useState } from "react";
import RecordTable from "./RecordTable";

interface Props {
  category: RecordCategory;
}

function RecordCategorySection(props: Props) {
  const { category } = props;

  const options = category.children;
  const [value, setValue] = useState(options[0].name);

  const record = useMemo(() => {
    return options.find((option) => option.name === value)!;
  }, [value, options]);

  return (
    <Stack gap={10}>
      <Title order={2}>{record.name}</Title>
      <NativeSelect
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
        }}
        data={options.map((option) => ({
          value: option.name,
          label: option.name,
        }))}
      />
      <RecordTable key={record.name} record={record} />
    </Stack>
  );
}

export default RecordCategorySection;
