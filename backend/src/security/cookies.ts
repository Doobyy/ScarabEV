interface CookieOptions {
  httpOnly?: boolean;
  secure?: boolean;
  path?: string;
  sameSite?: "Strict" | "Lax" | "None";
  maxAgeSeconds?: number;
}

export function parseCookieHeader(cookieHeader: string | null): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) {
    return cookies;
  }

  for (const rawPart of cookieHeader.split(";")) {
    const part = rawPart.trim();
    if (!part) {
      continue;
    }
    const eqIndex = part.indexOf("=");
    if (eqIndex <= 0) {
      continue;
    }

    const key = part.slice(0, eqIndex).trim();
    const value = decodeURIComponent(part.slice(eqIndex + 1).trim());
    cookies[key] = value;
  }

  return cookies;
}

export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path ?? "/"}`);
  parts.push(`SameSite=${options.sameSite ?? "Strict"}`);

  if (typeof options.maxAgeSeconds === "number") {
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`);
  }
  if (options.httpOnly) {
    parts.push("HttpOnly");
  }
  if (options.secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}
