const encoder = new TextEncoder();
const DEFAULT_ITERATIONS = 100_000;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(input: string): Uint8Array {
  const paddingLength = (4 - (input.length % 4 || 4)) % 4;
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(paddingLength);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function generateToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

export async function hashPassword(
  plaintext: string,
  salt = generateToken(16),
  iterations = DEFAULT_ITERATIONS
): Promise<{ hash: string; salt: string; iterations: number }> {
  const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(plaintext), "PBKDF2", false, ["deriveBits"]);
  const saltBytes = fromBase64Url(salt);
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations,
      salt: saltBytes as BufferSource
    },
    keyMaterial,
    256
  );

  return {
    hash: toBase64Url(new Uint8Array(derivedBits)),
    salt,
    iterations
  };
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}

export async function verifyPassword(
  plaintext: string,
  salt: string,
  iterations: number,
  expectedHash: string
): Promise<boolean> {
  try {
    const candidate = await hashPassword(plaintext, salt, iterations);
    return timingSafeEqual(candidate.hash, expectedHash);
  } catch {
    return false;
  }
}
