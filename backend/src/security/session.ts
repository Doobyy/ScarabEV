import type { SessionWithUser } from "./types.js";

export function isMutationMethod(method: string): boolean {
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
}

export function isSessionExpired(session: Pick<SessionWithUser, "expiresAt">, now: Date): boolean {
  return Date.parse(session.expiresAt) <= now.getTime();
}

export function shouldRotateSession(
  session: Pick<SessionWithUser, "lastRotatedAt">,
  now: Date,
  rotationSeconds: number
): boolean {
  const lastRotatedAtMs = Date.parse(session.lastRotatedAt);
  return now.getTime() - lastRotatedAtMs >= rotationSeconds * 1000;
}

export function getClientIp(request: Request): string | null {
  const cfConnectingIp = request.headers.get("cf-connecting-ip");
  if (cfConnectingIp?.trim()) {
    return cfConnectingIp.trim();
  }

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (!forwardedFor?.trim()) {
    return null;
  }

  return forwardedFor.split(",")[0]?.trim() || null;
}
