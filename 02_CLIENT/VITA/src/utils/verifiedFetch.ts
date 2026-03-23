/// <reference types="vite/client" />
/**
 * verifiedFetch — HMAC-SHA256 response authentication.
 *
 * The Flask gateway signs JSON responses with X-Content-Signature: sha256=<hex>.
 * We verify that signature before the caller ever parses the body.
 *
 * ⚠ Security note: VITE_API_SECRET is embedded in the client bundle and visible
 *   to anyone who can inspect it. This stops casual spoofing on the LAN; it is
 *   NOT a substitute for server-authoritative game state validation.
 *   Next step: migrate to Ed25519 (server holds private key, public key in bundle).
 *
 * Usage:
 *   const res = await verifiedFetch('/api/system/Sol');
 *   const data = await res.json();   // identical to plain fetch
 *
 *   // If the signature is absent, a warning is logged (dev-friendly).
 *   // If the signature is present but wrong, an error is thrown.
 */

const _secret = (import.meta.env.VITE_API_SECRET as string | undefined) ?? '';

// Module-level key cache — SubtleCrypto key import is async and expensive to repeat.
let _key: CryptoKey | null = null;

async function getKey(): Promise<CryptoKey | null> {
  if (!_secret) return null;
  if (_key) return _key;
  _key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(_secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return _key;
}

function hexToBytes(hex: string): ArrayBuffer {
  const buf = new ArrayBuffer(hex.length >> 1);
  const view = new Uint8Array(buf);
  for (let i = 0; i < hex.length; i += 2) {
    view[i >> 1] = parseInt(hex.slice(i, i + 2), 16);
  }
  return buf;
}

/**
 * Drop-in replacement for `fetch()` that verifies X-Content-Signature when
 * VITE_API_SECRET is configured. Returns the original Response unmodified so
 * callers can still call `.json()`, `.text()`, etc.
 */
export async function verifiedFetch(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  if (!res.ok) return res;

  const key = await getKey();
  const sigHeader = res.headers.get('X-Content-Signature');

  if (!key) return res; // no secret configured — skip verification (dev mode)

  if (!sigHeader) {
    console.warn(`[verifiedFetch] ${url} — no X-Content-Signature header. Server may not be signing yet.`);
    return res;
  }

  // Clone: read body for verification, return original so caller can read it.
  const clone = res.clone();
  const body = await clone.arrayBuffer();
  const hex = sigHeader.replace(/^sha256=/, '');

  const valid = await crypto.subtle.verify('HMAC', key, hexToBytes(hex), body);
  if (!valid) {
    throw new Error(`[verifiedFetch] Signature mismatch for ${url} — possible data tampering.`);
  }

  return res;
}
