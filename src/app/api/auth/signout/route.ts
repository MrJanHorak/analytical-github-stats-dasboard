import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

/** Sign out (a form POST, so it can't be triggered by a link or image). */
export async function POST(req: Request) {
  const res = NextResponse.redirect(new URL("/", req.url), 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
