import {
  Alert,
  Button,
  Card,
  Center,
  PasswordInput,
  Skeleton,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useDocumentTitle } from "@mantine/hooks";
import { MIN_PASSWORD_LENGTH, acceptInviteInput } from "@rfp/core/admin";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { z } from "zod";
import { getJson } from "../api/client";
import { apiRequest, zodValidate } from "./api";
import { inviteInfoSchema, okSchema } from "./schemas";

const formSchema = acceptInviteInput
  .pick({ name: true, password: true })
  .extend({ email: z.string().optional(), confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords don't match" });

/** One-time link landing page: choose a password (new account) or set a new one (reset). */
export default function Accept() {
  useDocumentTitle("Set your password · Raw Football Potential");
  const token = useSearchParams()[0].get("token") ?? "";
  const info = useQuery({
    queryKey: ["invite", token],
    queryFn: () => getJson("/invite", inviteInfoSchema, { token }),
    retry: false,
    enabled: token.length > 0,
  });
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    initialValues: { email: "", name: "", password: "", confirm: "" },
    validate: zodValidate(formSchema),
  });

  const submit = form.onSubmit(async (v) => {
    setError(null);
    try {
      await apiRequest("POST", "/api/invite/accept", okSchema, {
        token,
        password: v.password,
        ...(v.name ? { name: v.name } : {}),
        ...(v.email ? { email: v.email } : {}),
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  });

  const needsEmail = info.data?.purpose === "invite" && !info.data.email;
  return (
    <Center mih="100vh" p="md">
      <Card withBorder padding="lg" radius="md" w="100%" maw={400}>
        <Stack>
          <Title order={2} ff="Bebas Neue" fz="2rem">
            {info.data?.purpose === "reset" ? "Choose a new password" : "Join RFP Admin"}
          </Title>
          {info.isPending && token && <Skeleton h={160} />}
          {(!token || info.isError) && (
            <Alert color="red" variant="light">
              This link is invalid, expired or already used. Ask an owner for a new one.
            </Alert>
          )}
          {done && (
            <>
              <Alert color="green" variant="light">
                All set. You can sign in now.
              </Alert>
              <Button component={Link} to="/admin/login">
                Go to sign in
              </Button>
            </>
          )}
          {info.data && !done && (
            <form onSubmit={submit}>
              <Stack>
                {error && (
                  <Alert color="red" variant="light">
                    {error}
                  </Alert>
                )}
                {info.data.email && <Text size="sm">Account: {info.data.email}</Text>}
                {needsEmail && <TextInput label="Email" {...form.getInputProps("email")} />}
                {info.data.purpose === "invite" && (
                  <TextInput label="Your name" {...form.getInputProps("name")} />
                )}
                <PasswordInput
                  label="Password"
                  description={`At least ${MIN_PASSWORD_LENGTH} characters`}
                  autoComplete="new-password"
                  {...form.getInputProps("password")}
                />
                <PasswordInput
                  label="Repeat password"
                  autoComplete="new-password"
                  {...form.getInputProps("confirm")}
                />
                <Button type="submit">Save password</Button>
              </Stack>
            </form>
          )}
        </Stack>
      </Card>
    </Center>
  );
}
