import { clerkClient, getAuth } from "@clerk/express";
import type { Request } from "express";

export function browserSession(req: Request): string | undefined {
  if (req.get("sec-fetch-site") === "cross-site") return;
  const auth = getAuth(req);
  if (auth.userId && auth.sessionId) return auth.sessionId;
  return undefined;
}

export async function isLabOperator(req: Request): Promise<boolean> {
  const configured = process.env.LAB_OPERATOR_EMAIL?.trim().toLowerCase();
  const { userId } = getAuth(req);
  if (!configured || !userId) return false;
  const user = await clerkClient.users.getUser(userId);
  return user.emailAddresses.some(address =>
    address.id === user.primaryEmailAddressId &&
    address.verification?.status === "verified" &&
    address.emailAddress.toLowerCase() === configured,
  );
}
