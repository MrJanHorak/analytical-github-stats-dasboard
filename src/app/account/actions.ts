"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/scope";
import { SESSION_COOKIE } from "@/lib/session";
import { deleteUserData } from "@/lib/users";

/** "Delete my data" — needs the confirmation box ticked; signs the user out afterwards. */
export async function deleteMyData(formData: FormData) {
  const session = await getSession();
  if (!session || formData.get("confirm") !== session.login) return;
  await deleteUserData(session.userId);
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/?deleted=1");
}
