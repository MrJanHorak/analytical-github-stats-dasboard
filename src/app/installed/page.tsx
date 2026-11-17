import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * GitHub's "Setup URL": people land here after installing the App (or changing its repos). A quick
 * sign-in round trip refreshes which installations they can see — it's instant when they're already
 * authorised — and the overview then starts their first sync.
 */
export default function Installed() {
  redirect("/api/auth/signin?next=%2F%3Finstalled%3D1");
}
