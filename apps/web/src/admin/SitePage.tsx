import { ActionIcon, Button, Card, Group, Stack, Text, TextInput, Textarea } from "@mantine/core";
import { useForm } from "@mantine/form";
import { Plus, Trash } from "@phosphor-icons/react";
import { changelogInput, siteInput, type ChangelogEntry } from "@rfp/core/admin";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "../api/client";
import { adminQuery, adminRequest, useAdminMutation, zodValidate } from "./api";
import { useMe } from "./me";
import { okSchema, siteSchema } from "./schemas";
import { Loaded, PageHeader, Panel } from "./ui";
import { z } from "zod";

const key = [["site"]];

function SiteForm({ site }: { site: { name: string; shortName: string } }) {
  const form = useForm({ initialValues: site, validate: zodValidate(siteInput) });
  const save = useAdminMutation((v: typeof site) => adminRequest("PUT", "/site", okSchema, v), {
    success: "Site saved",
    invalidate: key,
  });
  return (
    <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
      <Group align="flex-end">
        <TextInput label="Site name" w={300} {...form.getInputProps("name")} />
        <TextInput label="Short name (phones)" w={160} {...form.getInputProps("shortName")} />
        <Button type="submit" loading={save.isPending}>
          Save
        </Button>
      </Group>
    </form>
  );
}

function ChangelogEditor({ initial }: { initial: ChangelogEntry[] }) {
  const form = useForm<{ entries: ChangelogEntry[] }>({
    initialValues: { entries: initial },
    validate: zodValidate(z.object({ entries: changelogInput })),
  });
  const save = useAdminMutation(
    (entries: ChangelogEntry[]) => adminRequest("PUT", "/changelog", okSchema, entries),
    { success: "Changelog saved", invalidate: key }
  );
  const add = () =>
    form.insertListItem("entries", {
      version: "",
      date: new Date().toISOString().slice(0, 10),
      title: "",
      description: "",
    });
  return (
    <form onSubmit={form.onSubmit((v) => save.mutate(v.entries))}>
      <Stack>
        {form.values.entries.map((_, i) => (
          <Card key={i} withBorder padding="sm">
            <Stack gap="xs">
              <Group align="flex-end" wrap="wrap">
                <TextInput
                  label="Version"
                  w={110}
                  {...form.getInputProps(`entries.${i}.version`)}
                />
                <TextInput label="Date" w={150} {...form.getInputProps(`entries.${i}.date`)} />
                <TextInput
                  label="Title"
                  style={{ flex: 1, minWidth: 200 }}
                  {...form.getInputProps(`entries.${i}.title`)}
                />
                <ActionIcon
                  color="red"
                  variant="light"
                  size="lg"
                  aria-label="Remove entry"
                  onClick={() => form.removeListItem("entries", i)}
                >
                  <Trash size={18} />
                </ActionIcon>
              </Group>
              <Textarea
                label="What changed (Markdown)"
                autosize
                minRows={3}
                {...form.getInputProps(`entries.${i}.description`)}
              />
            </Stack>
          </Card>
        ))}
        <Group>
          <Button variant="default" leftSection={<Plus size={16} />} onClick={add}>
            Add release
          </Button>
          <Button type="submit" loading={save.isPending}>
            Save changelog
          </Button>
        </Group>
        <Text size="sm" c="dimmed">
          The newest entry opens automatically for visitors who haven't seen it yet.
        </Text>
      </Stack>
    </form>
  );
}

/** Fetches the configuration file and hands it to the browser as a download; the server allows owners only. */
async function downloadConfig(): Promise<string> {
  const res = await fetch("/api/admin/config-export", { credentials: "same-origin" });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // no JSON body
    }
    throw new ApiError(res.status, message);
  }
  const name =
    /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ??
    "rfp-config.json";
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return name;
}

function ConfigExport() {
  const download = useAdminMutation(downloadConfig, { success: (name) => `Downloaded ${name}` });
  return (
    <Stack gap="xs" align="flex-start">
      <Text size="sm" c="dimmed">
        Everything set by hand in this admin, as one file: leagues and seasons, trophy thresholds,
        record settings, site text and version history, managers and their accounts, franchise
        names, corrections and player links. It holds no admin accounts, passwords or ingested
        scores. To rebuild another environment, run{" "}
        <code>pnpm ingest import-config &lt;file&gt;</code> on a fresh database, then{" "}
        <code>pnpm ingest all</code>, then the import again.
      </Text>
      <Button variant="default" loading={download.isPending} onClick={() => download.mutate()}>
        Download configuration
      </Button>
    </Stack>
  );
}

export default function SitePage() {
  const me = useMe();
  const q = useQuery(adminQuery(["site"], "/site", siteSchema));
  return (
    <>
      <PageHeader title="Site & changelog" />
      <Loaded query={q}>
        {(d) => (
          <>
            <Panel title="Name">
              <SiteForm key={`${d.site.name}|${d.site.shortName}`} site={d.site} />
            </Panel>
            <Panel title="Version history">
              <ChangelogEditor key={JSON.stringify(d.changelog)} initial={d.changelog} />
            </Panel>
            {me.role === "owner" && (
              <Panel title="Export configuration">
                <ConfigExport />
              </Panel>
            )}
          </>
        )}
      </Loaded>
    </>
  );
}
