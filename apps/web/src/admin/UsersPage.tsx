import {
  Alert,
  Badge,
  Button,
  CopyButton,
  Group,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { Navigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { adminQuery, adminRequest, useAdminMutation } from "./api";
import { useMe } from "./me";
import { invitesSchema, linkSchema, okSchema, usersSchema } from "./schemas";
import { AdminTable, Loaded, PageHeader, Panel, shortDate } from "./ui";

const ukey = [["users"]];
type User = (typeof usersSchema)["_output"]["users"][number];

function LinkBox({ link, label }: { link: string; label: string }) {
  return (
    <Alert color="blue" variant="light" title={label}>
      <Stack gap="xs">
        <Text size="sm">Send this to them yourself. It works once and can't be shown again.</Text>
        <Group gap="xs" wrap="nowrap">
          <TextInput
            readOnly
            value={link}
            style={{ flex: 1 }}
            aria-label="One-time link"
            onFocus={(e) => e.currentTarget.select()}
          />
          <CopyButton value={link}>
            {({ copied, copy }) => (
              <Button variant="default" onClick={copy}>
                {copied ? "Copied" : "Copy"}
              </Button>
            )}
          </CopyButton>
        </Group>
      </Stack>
    </Alert>
  );
}

function UserRow({
  u,
  meId,
  onLink,
}: {
  u: User;
  meId: string;
  onLink: (l: string, label: string) => void;
}) {
  const patch = useAdminMutation(
    (body: unknown) => adminRequest("PATCH", `/users/${u.id}`, okSchema, body),
    { success: "Saved", invalidate: ukey }
  );
  const reset = useAdminMutation(
    () => adminRequest("POST", `/users/${u.id}/reset-link`, linkSchema, {}),
    {
      onDone: (r) => onLink(r.link, `Password link for ${u.email}`),
    }
  );
  const remove = useAdminMutation(() => adminRequest("DELETE", `/users/${u.id}`, okSchema), {
    success: "Removed",
    invalidate: ukey,
  });
  const self = u.id === meId;
  return (
    <Table.Tr opacity={u.disabled ? 0.6 : 1}>
      <Table.Td>
        <Text size="sm">{u.name}</Text>
        <Text size="xs" c="dimmed">
          {u.email}
          {self ? " (you)" : ""}
        </Text>
      </Table.Td>
      <Table.Td>
        <Select
          size="xs"
          w={110}
          aria-label={`Role of ${u.email}`}
          data={["owner", "admin"]}
          value={u.role}
          disabled={self}
          allowDeselect={false}
          onChange={(role) => role && patch.mutate({ role })}
        />
      </Table.Td>
      <Table.Td>
        <Switch
          aria-label={`${u.email} enabled`}
          checked={!u.disabled}
          disabled={self}
          onChange={(e) => patch.mutate({ disabled: !e.currentTarget.checked })}
        />
      </Table.Td>
      <Table.Td>{shortDate(u.lastLoginAt)}</Table.Td>
      <Table.Td>
        <Group gap={4} wrap="nowrap">
          <Button
            size="compact-xs"
            variant="subtle"
            loading={reset.isPending}
            onClick={() => reset.mutate()}
          >
            New password link
          </Button>
          {!self && (
            <Button
              size="compact-xs"
              variant="subtle"
              color="red"
              loading={remove.isPending}
              onClick={() =>
                window.confirm(`Remove ${u.email}? This can't be undone.`) && remove.mutate()
              }
            >
              Remove
            </Button>
          )}
        </Group>
      </Table.Td>
    </Table.Tr>
  );
}

export default function UsersPage() {
  const me = useMe();
  const users = useQuery({
    ...adminQuery(["users"], "/users", usersSchema),
    enabled: me.role === "owner",
  });
  const invites = useQuery({
    ...adminQuery(["invites"], "/invites", invitesSchema),
    enabled: me.role === "owner",
  });
  const [link, setLink] = useState<{ link: string; label: string } | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string | null>("admin");
  const invite = useAdminMutation(
    () => adminRequest("POST", "/invites", linkSchema, { ...(email ? { email } : {}), role }),
    {
      invalidate: [["invites"]],
      onDone: (r) => {
        setLink({ link: r.link, label: "Invite link" });
        setEmail("");
      },
    }
  );
  const revoke = useAdminMutation(
    (id: number) => adminRequest("DELETE", `/invites/${id}`, okSchema),
    {
      success: "Invite revoked",
      invalidate: [["invites"]],
    }
  );
  if (me.role !== "owner") return <Navigate to="/admin" replace />;

  return (
    <>
      <PageHeader title="Admins">
        Invite people, reset passwords, change roles. Owners only.
      </PageHeader>
      {link && (
        <div style={{ marginBottom: "var(--mantine-spacing-md)" }}>
          <LinkBox link={link.link} label={link.label} />
        </div>
      )}
      <Panel title="People">
        <Loaded query={users}>
          {(d) => (
            <AdminTable minWidth={720}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Role</Table.Th>
                  <Table.Th>Active</Table.Th>
                  <Table.Th>Last sign-in</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {d.users.map((u) => (
                  <UserRow
                    key={u.id}
                    u={u}
                    meId={me.id}
                    onLink={(l, label) => setLink({ link: l, label })}
                  />
                ))}
              </Table.Tbody>
            </AdminTable>
          )}
        </Loaded>
      </Panel>
      <Panel title="Invite someone">
        <Group align="flex-end" wrap="wrap">
          <TextInput
            label="Email (optional)"
            w={260}
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
          />
          <Select
            label="Role"
            w={120}
            data={["admin", "owner"]}
            value={role}
            onChange={setRole}
            allowDeselect={false}
          />
          <Button loading={invite.isPending} onClick={() => invite.mutate()}>
            Create invite link
          </Button>
        </Group>
        <Loaded query={invites}>
          {(d) =>
            d.invites.length === 0 ? null : (
              <AdminTable minWidth={520}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>For</Table.Th>
                    <Table.Th>Kind</Table.Th>
                    <Table.Th>Expires</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {d.invites.map((i) => (
                    <Table.Tr key={i.id}>
                      <Table.Td>{i.email ?? "anyone with the link"}</Table.Td>
                      <Table.Td>
                        <Badge variant="light">
                          {i.purpose} · {i.role}
                        </Badge>
                      </Table.Td>
                      <Table.Td>{shortDate(i.expiresAt)}</Table.Td>
                      <Table.Td>
                        <Button
                          size="compact-xs"
                          variant="subtle"
                          color="red"
                          onClick={() => revoke.mutate(i.id)}
                        >
                          Revoke
                        </Button>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </AdminTable>
            )
          }
        </Loaded>
      </Panel>
    </>
  );
}
