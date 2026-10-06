import { Alert, Button, FileInput, Stack, Text } from "@mantine/core";
import { UploadSimple } from "@phosphor-icons/react";
import { useState } from "react";
import { adminRequest, useAdminMutation } from "./api";
import { importSchema } from "./schemas";
import { Notice, PageHeader } from "./ui";

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const upload = useAdminMutation(
    (f: File) => {
      const form = new FormData();
      form.append("file", f);
      return adminRequest("POST", "/import/espn", importSchema, form);
    },
    { invalidate: [["runs"]], onDone: () => setFile(null) }
  );
  return (
    <>
      <PageHeader title="ESPN import">
        Upload a season bundle produced by the ESPN scraper.
      </PageHeader>
      <Notice>
        Bundles are archived exactly as scraped (this data can't be fetched again). Turning them
        into records comes with the scraper work; until then an upload is stored and reported but
        doesn't change any page.
      </Notice>
      <Stack maw={460}>
        <FileInput
          label="Bundle file (.json or .json.gz)"
          placeholder="Choose a file"
          accept=".json,.gz,application/json,application/gzip"
          leftSection={<UploadSimple size={16} />}
          value={file}
          onChange={setFile}
        />
        <Button
          disabled={!file}
          loading={upload.isPending}
          onClick={() => file && upload.mutate(file)}
        >
          Upload
        </Button>
        {upload.data && (
          <Alert color="green" variant="light" title="Archived">
            <Text size="sm">
              {upload.data.responses} responses from {upload.data.endpoints} endpoints stored as
              <br />
              <code>{upload.data.bundle}</code>
            </Text>
            <Text size="sm" mt="xs">
              {upload.data.note}
            </Text>
          </Alert>
        )}
      </Stack>
    </>
  );
}
