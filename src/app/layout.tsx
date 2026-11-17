import type { Metadata } from "next";
import Link from "next/link";
import { UserMenu } from "@/components/UserMenu";
import { isAppMode } from "@/lib/app-mode";
import { getSession } from "@/lib/scope";
import "./globals.css";

export const metadata: Metadata = {
  title: "GitHub Repo Stats",
  description: "Traffic, clones, stars and forks across all your GitHub repositories",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const appMode = isAppMode();
  const session = appMode ? await getSession() : null;
  // In sign-in mode the section links only make sense once signed in
  const showNav = !appMode || !!session;
  return (
    <html lang="en">
      <body>
        <header className="border-b border-zinc-800">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <nav className="flex items-center gap-5">
              <Link href="/" className="font-semibold tracking-tight">
                📈 Repo Stats
              </Link>
              {showNav && (
                <>
                  <Link href="/" className="text-sm text-zinc-400 hover:text-white">
                    Repositories
                  </Link>
                  <Link href="/me" className="text-sm text-zinc-400 hover:text-white">
                    Your activity
                  </Link>
                </>
              )}
            </nav>
            {appMode ? (
              <UserMenu session={session} />
            ) : (
              <a
                href="https://docs.github.com/en/rest/metrics/traffic"
                className="hidden text-xs text-zinc-500 hover:text-zinc-300 sm:block"
                target="_blank"
              >
                GitHub keeps traffic for 14 days — this app keeps it forever
              </a>
            )}
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
