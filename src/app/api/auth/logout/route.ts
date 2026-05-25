import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { VMS_SESSION_COOKIE } from "@/lib/session";

export async function POST(request: Request) {
  const store = await cookies();
  store.delete(VMS_SESSION_COOKIE);
  return NextResponse.redirect(new URL("/login", request.url));
}
