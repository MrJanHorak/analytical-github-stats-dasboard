import Link from "next/link";
import type { Session } from "@/lib/session";

/** Header (App mode): who's signed in, account page, sign out. */
export function UserMenu({ session }: { session: Session | null }) {
  if (!session)
    return (
      <a href="/api/auth/signin" className="rounded-md bg-zinc-800 px-3 py-1.5 text-sm hover:bg-zinc-700">
        Sign in
      </a>
    );
  return (
    <div className="flex items-center gap-3">
      <Link href="/account" className="flex items-center gap-2 text-sm text-zinc-300 hover:text-white">
        {session.avatarUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`${session.avatarUrl}${session.avatarUrl.includes("?") ? "&" : "?"}s=48`} alt="" width={24} height={24} className="rounded-full" />
        )}
        <span className="hidden sm:inline">{session.login}</span>
      </Link>
      <form action="/api/auth/signout" method="post">
        <button className="text-xs text-zinc-500 hover:text-zinc-300">Sign out</button>
      </form>
    </div>
  );
}
