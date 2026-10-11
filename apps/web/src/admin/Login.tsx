import { Alert, Button, Card, Center, PasswordInput, Stack, TextInput, Title } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useDocumentTitle } from "@mantine/hooks";
import { loginInput } from "@rfp/core/admin";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { markAdminSeen } from "../lib/admin-seen";
import { zodValidate } from "./api";

export default function Login() {
  useDocumentTitle("Sign in · Raw Football Potential");
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const form = useForm({
    initialValues: { email: "", password: "" },
    validate: zodValidate(loginInput),
  });

  const submit = form.onSubmit(async (values) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      if (res.status === 429) throw new Error("Too many attempts. Wait a minute and try again.");
      if (!res.ok) throw new Error("That email and password don't match an active account.");
      markAdminSeen();
      await qc.invalidateQueries({ queryKey: ["admin"] });
      const next = params.get("next");
      navigate(next?.startsWith("/admin") ? next : "/admin", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  });

  return (
    <Center mih="100vh" p="md">
      <Card withBorder padding="lg" radius="md" w="100%" maw={380}>
        <form onSubmit={submit}>
          <Stack>
            <Title order={2} ff="Bebas Neue" fz="2rem">
              RFP Admin
            </Title>
            {error && (
              <Alert color="red" variant="light">
                {error}
              </Alert>
            )}
            <TextInput label="Email" autoComplete="username" {...form.getInputProps("email")} />
            <PasswordInput
              label="Password"
              autoComplete="current-password"
              {...form.getInputProps("password")}
            />
            <Button type="submit" loading={busy}>
              Sign in
            </Button>
          </Stack>
        </form>
      </Card>
    </Center>
  );
}
