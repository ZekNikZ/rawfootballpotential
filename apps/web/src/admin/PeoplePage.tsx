import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { Plus, X } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { adminQuery, adminRequest, useAdminMutation } from "./api";
import { adminLeaguesSchema, franchisesSchema, managersSchema, okSchema } from "./schemas";
import { AdminTable, Loaded, Notice, PageHeader } from "./ui";

type Manager = (typeof managersSchema)["_output"]["managers"][number];
const mkey = [["managers"]];

function MergeModal({ manager, all }: { manager: Manager; all: Manager[] }) {
  const [opened, { open, close }] = useDisclosure(false);
  const [into, setInto] = useState<string | null>(null);
  const merge = useAdminMutation(
    () =>
      adminRequest("POST", "/managers/merge", okSchema, {
        fromId: manager.id,
        intoId: Number(into),
      }),
    { success: "Managers merged", invalidate: [["managers"], ["franchises"]], onDone: close }
  );
  return (
    <>
      <Button size="compact-xs" variant="subtle" onClick={open}>
        Merge into…
      </Button>
      <Modal opened={opened} onClose={close} title={`Merge ${manager.name} into another manager`}>
        <Stack>
          <Text size="sm">
            Their linked accounts and every season they managed move to the manager you pick, and{" "}
            {manager.name} is removed. This can't be undone.
          </Text>
          <Select
            label="Keep this manager"
            searchable
            data={all
              .filter((m) => m.id !== manager.id)
              .map((m) => ({ value: String(m.id), label: m.name }))}
            value={into}
            onChange={setInto}
          />
          <Button
            color="red"
            disabled={!into}
            loading={merge.isPending}
            onClick={() => merge.mutate()}
          >
            Merge
          </Button>
        </Stack>
      </Modal>
    </>
  );
}

function ManagerRow({ m, all }: { m: Manager; all: Manager[] }) {
  const [name, setName] = useState(m.name);
  const [src, setSrc] = useState<string | null>("sleeper");
  const [ext, setExt] = useState("");
  const rename = useAdminMutation(
    (v: string) => adminRequest("PATCH", `/managers/${m.id}`, okSchema, { name: v }),
    { success: "Name saved", invalidate: mkey }
  );
  const addId = useAdminMutation(
    () =>
      adminRequest("POST", `/managers/${m.id}/identities`, okSchema, {
        source: src,
        externalUserId: ext,
      }),
    { success: "Account linked", invalidate: mkey, onDone: () => setExt("") }
  );
  const rmId = useAdminMutation(
    (id: number) => adminRequest("DELETE", `/managers/${m.id}/identities/${id}`, okSchema),
    { success: "Account unlinked", invalidate: mkey }
  );
  return (
    <Table.Tr>
      <Table.Td>
        <Group gap={6} wrap="nowrap">
          <TextInput
            aria-label="Name"
            size="xs"
            w={150}
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
          <Button
            size="compact-xs"
            disabled={name.trim() === m.name || !name.trim()}
            loading={rename.isPending}
            onClick={() => rename.mutate(name.trim())}
          >
            Save
          </Button>
        </Group>
        <Text size="xs" c="dimmed">
          {m.seasons} season{m.seasons === 1 ? "" : "s"}
        </Text>
      </Table.Td>
      <Table.Td>
        <Stack gap={4}>
          <Group gap={4}>
            {m.identities.map((i) => (
              <Badge
                key={i.id}
                variant="light"
                rightSection={
                  <ActionIcon
                    size="xs"
                    variant="transparent"
                    aria-label={`Unlink ${i.externalUserId}`}
                    onClick={() => rmId.mutate(i.id)}
                  >
                    <X size={10} />
                  </ActionIcon>
                }
              >
                {i.source} {i.externalUserId}
              </Badge>
            ))}
          </Group>
          <Group gap={4} wrap="nowrap">
            <Select
              size="xs"
              w={90}
              aria-label="Source"
              data={["sleeper", "espn"]}
              value={src}
              onChange={setSrc}
              allowDeselect={false}
            />
            <TextInput
              size="xs"
              w={170}
              aria-label="Account id"
              placeholder="Sleeper user id / ESPN SWID"
              value={ext}
              onChange={(e) => setExt(e.currentTarget.value)}
            />
            <ActionIcon
              variant="light"
              aria-label="Link account"
              disabled={!ext.trim()}
              loading={addId.isPending}
              onClick={() => addId.mutate()}
            >
              <Plus size={16} />
            </ActionIcon>
          </Group>
        </Stack>
      </Table.Td>
      <Table.Td>
        <MergeModal manager={m} all={all} />
      </Table.Td>
    </Table.Tr>
  );
}

function Managers() {
  const q = useQuery(adminQuery(["managers"], "/managers", managersSchema));
  return (
    <Loaded query={q}>
      {(d) => (
        <AdminTable minWidth={720}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Manager</Table.Th>
              <Table.Th>Linked accounts</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {d.managers.map((m) => (
              <ManagerRow key={m.id} m={m} all={d.managers} />
            ))}
          </Table.Tbody>
        </AdminTable>
      )}
    </Loaded>
  );
}

type Franchise = (typeof franchisesSchema)["_output"]["franchises"][number];

function MoveTeam({
  team,
  franchises,
}: {
  team: Franchise["teamSeasons"][number];
  franchises: Franchise[];
}) {
  const [opened, { open, close }] = useDisclosure(false);
  const [to, setTo] = useState<string | null>(null);
  const move = useAdminMutation(
    () => adminRequest("PATCH", `/team-seasons/${team.id}`, okSchema, { franchiseId: Number(to) }),
    { success: "Team moved", invalidate: [["franchises"]], onDone: close }
  );
  return (
    <>
      <Button size="compact-xs" variant="subtle" onClick={open}>
        Move…
      </Button>
      <Modal opened={opened} onClose={close} title={`Move ${team.year} · ${team.name}`}>
        <Stack>
          <Text size="sm">
            Pick the franchise this season's team belongs to. It must not already have a team that
            year.
          </Text>
          <Select
            label="Franchise"
            data={franchises.map((f) => ({
              value: String(f.id),
              label: `#${f.id} ${f.name ?? ""} (${f.teamSeasons.at(-1)?.name ?? "empty"})`,
            }))}
            value={to}
            onChange={setTo}
          />
          <Button disabled={!to} loading={move.isPending} onClick={() => move.mutate()}>
            Move
          </Button>
        </Stack>
      </Modal>
    </>
  );
}

function FranchiseRow({ f, all }: { f: Franchise; all: Franchise[] }) {
  const [name, setName] = useState(f.name ?? "");
  const save = useAdminMutation(
    (v: string) => adminRequest("PATCH", `/franchises/${f.id}`, okSchema, { name: v || null }),
    { success: "Franchise saved", invalidate: [["franchises"]] }
  );
  return (
    <Table.Tr>
      <Table.Td>#{f.id}</Table.Td>
      <Table.Td>
        <Group gap={6} wrap="nowrap">
          <TextInput
            size="xs"
            w={160}
            aria-label="Franchise name"
            placeholder="(unnamed)"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
          <Button
            size="compact-xs"
            disabled={name === (f.name ?? "")}
            loading={save.isPending}
            onClick={() => save.mutate(name.trim())}
          >
            Save
          </Button>
        </Group>
      </Table.Td>
      <Table.Td>
        <Stack gap={2}>
          {[...f.teamSeasons].reverse().map((t) => (
            <Group key={t.id} gap="xs" wrap="nowrap">
              <Text size="sm">
                {t.year} · {t.name}{" "}
                <Text span c="dimmed" size="xs">
                  ({t.managers.join(", ") || "no manager"})
                </Text>
              </Text>
              <MoveTeam team={t} franchises={all.filter((x) => x.id !== f.id)} />
            </Group>
          ))}
        </Stack>
      </Table.Td>
    </Table.Tr>
  );
}

function Franchises() {
  const leagues = useQuery(adminQuery(["leagues"], "/leagues", adminLeaguesSchema));
  const [leagueId, setLeagueId] = useState<string | null>(null);
  const id = leagueId ?? (leagues.data?.leagues[0] ? String(leagues.data.leagues[0].id) : null);
  const q = useQuery({
    ...adminQuery(["franchises", id], `/franchises?leagueId=${id}`, franchisesSchema),
    enabled: id !== null,
  });
  return (
    <Stack>
      <Notice>
        A franchise is the unit records follow (one per manager in redraft; in dynasty it can change
        hands). Move a season's team to a different franchise only to correct how the importer
        chained the seasons.
      </Notice>
      <Select
        label="League"
        w={220}
        allowDeselect={false}
        data={(leagues.data?.leagues ?? []).map((l) => ({ value: String(l.id), label: l.name }))}
        value={id}
        onChange={setLeagueId}
      />
      <Loaded query={q}>
        {(d) => (
          <AdminTable minWidth={760}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>ID</Table.Th>
                <Table.Th>Name</Table.Th>
                <Table.Th>Team seasons</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {d.franchises.map((f) => (
                <FranchiseRow key={f.id} f={f} all={d.franchises} />
              ))}
            </Table.Tbody>
          </AdminTable>
        )}
      </Loaded>
    </Stack>
  );
}

export default function PeoplePage() {
  return (
    <>
      <PageHeader title="Managers & franchises" />
      <Tabs defaultValue="managers" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="managers">Managers</Tabs.Tab>
          <Tabs.Tab value="franchises">Franchises</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="managers">
          <Managers />
        </Tabs.Panel>
        <Tabs.Panel value="franchises">
          <Franchises />
        </Tabs.Panel>
      </Tabs>
    </>
  );
}
