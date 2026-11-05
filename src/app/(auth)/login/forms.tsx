"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { signIn, signInDemo, type AuthFormState } from "@/server/auth/actions";

const initialState: AuthFormState = {};

function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
      {message}
    </p>
  );
}

export function DemoButton() {
  const [state, action, pending] = useActionState(signInDemo, initialState);

  return (
    <form action={action} className="flex flex-col gap-3">
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Preparing your workspace…" : "Explore the demo"}
      </Button>
      <FormError message={state.error} />
    </form>
  );
}

export function LoginForm() {
  const [state, action, pending] = useActionState(signIn, initialState);

  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Email" name="email" type="email" autoComplete="username" required />
      <Field label="Password" name="password" type="password" autoComplete="current-password" required />
      <FormError message={state.error} />
      <Button type="submit" variant="secondary" disabled={pending} className="w-full">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
