import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOut } from "@/server/auth/actions";

export function SignOutButton() {
  return (
    <form action={signOut}>
      <Button type="submit" variant="ghost" size="icon" aria-label="Sign out">
        <LogOut aria-hidden />
      </Button>
    </form>
  );
}
