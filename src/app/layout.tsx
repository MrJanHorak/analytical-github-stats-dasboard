import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "GitHub Repo Stats",
  description: "Traffic, clones, stars and forks across all your GitHub repositories",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-zinc-800">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <Link href="/" className="font-semibold tracking-tight">
              📈 Repo Stats
            </Link>
            <a
              href="https://docs.github.com/en/rest/metrics/traffic"
              className="text-xs text-zinc-500 hover:text-zinc-300"
              target="_blank"
            >
              GitHub keeps traffic for 14 days — this app keeps it forever
            </a>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
