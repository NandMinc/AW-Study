// The results key (#161, docs/SECURITY.md "AI work in the background: the results key"): how AI work done in
// the background comes back so that only the student's own unlocked devices can read it. Pure WebCrypto, so it
// runs in the browser and in Node (the AI helper seals with the same calls; tested in results-key.test.ts).
//
// Standard building blocks only: ECDH on P-256, HKDF-SHA-256, AES-256-GCM (the ECIES pattern), HMAC-SHA-256.
import { CryptoError, type EncryptedRecord, type NewResultsKey, type ResultsKey, type SealedResult } from '../types/crypto';
import { decryptBytes, encryptBytes } from './crypto';

const subtle = () => globalThis.crypto.subtle;
const utf8 = new TextEncoder();
const EC = { name: 'ECDH', namedCurve: 'P-256' } as const;

/** Additional data sealing the private part with the data key. */
export const RESULTS_KEY_AAD = 'honed:v1:results-key';
/** HKDF info for a result's key. */
export const RESULT_INFO = 'honed:v1:result';
/** Additional data for a result: binds it to its account and its id. */
export function resultAad(accountId: string, resultId: string): string {
  return `honed:v1:result:${accountId}:${resultId}`;
}

const BUNDLE_VERSION = 1;
const FINGERPRINT_KEY_BYTES = 32;
const PUBLIC_KEY_BYTES = 65; // 0x04, then x and y

function buf(data: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(data);
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function fromBase64url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Makes the account's results key, on an unlocked device: the public key for the server, the private key and a
 * fresh fingerprint key sealed with the data key, and the key ready to use on this device.
 */
export async function newResultsKey(dataKey: CryptoKey): Promise<{ upload: NewResultsKey; key: ResultsKey }> {
  const pair = await subtle().generateKey(EC, true, ['deriveBits']);
  const publicKey = new Uint8Array(await subtle().exportKey('raw', pair.publicKey));
  const pkcs8 = new Uint8Array(await subtle().exportKey('pkcs8', pair.privateKey));
  const fingerprintKey = globalThis.crypto.getRandomValues(new Uint8Array(FINGERPRINT_KEY_BYTES));
  const sealed = await encryptBytes(dataKey, RESULTS_KEY_AAD, concat(Uint8Array.of(BUNDLE_VERSION), fingerprintKey, pkcs8));
  return { upload: { publicKey, sealed }, key: await openBundle(publicKey, fingerprintKey, pkcs8) };
}

/**
 * Opens the account's results key from the server's copy, on an unlocked device. Throws CryptoError 'corrupt'
 * if the sealed part won't open with this data key, and 'invalid' if its private key doesn't belong to the
 * public key the server gave: then the server's key isn't ours, and no work must be sent.
 */
export async function openResultsKey(dataKey: CryptoKey, publicKey: Uint8Array, sealed: EncryptedRecord): Promise<ResultsKey> {
  const bundle = await decryptBytes(dataKey, RESULTS_KEY_AAD, sealed);
  if (bundle[0] !== BUNDLE_VERSION || bundle.length <= 1 + FINGERPRINT_KEY_BYTES) throw new CryptoError('corrupt', 'The results key is damaged.');
  return openBundle(publicKey, bundle.slice(1, 1 + FINGERPRINT_KEY_BYTES), bundle.slice(1 + FINGERPRINT_KEY_BYTES));
}

async function openBundle(publicKey: Uint8Array, fingerprintKey: Uint8Array, pkcs8: Uint8Array): Promise<ResultsKey> {
  if (publicKey.length !== PUBLIC_KEY_BYTES || publicKey[0] !== 4) throw new CryptoError('invalid', 'That isn’t a results public key.');
  let jwk: JsonWebKey;
  try {
    jwk = await subtle().exportKey('jwk', await subtle().importKey('pkcs8', buf(pkcs8), EC, true, ['deriveBits']));
  } catch {
    throw new CryptoError('corrupt', 'The results key is damaged.');
  }
  // The private key's own public point must be the one the server gives out.
  const own = concat(Uint8Array.of(4), fromBase64url(jwk.x ?? ''), fromBase64url(jwk.y ?? ''));
  if (!sameBytes(own, publicKey)) throw new CryptoError('invalid', 'The server’s results key isn’t this account’s.');
  return {
    publicKey: new Uint8Array(publicKey),
    privateKey: await subtle().importKey('pkcs8', buf(pkcs8), EC, false, ['deriveBits']),
    fingerprintKey: await subtle().importKey('raw', buf(fingerprintKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
  };
}

/** The AES-GCM key for one result: HKDF-SHA-256 of the ECDH secret, salted with both public keys. */
async function resultCipherKey(shared: ArrayBuffer, epk: Uint8Array, publicKey: Uint8Array, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  const ikm = await subtle().importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: concat(epk, publicKey), info: utf8.encode(RESULT_INFO) },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  );
}

/**
 * Seals a result to an account's public key (what the AI helper does). A fresh ephemeral key pair each time,
 * thrown away after; additional data binds the result to its account and id.
 */
export async function sealResult(publicKey: Uint8Array, accountId: string, resultId: string, data: Uint8Array): Promise<SealedResult> {
  let recipient: CryptoKey;
  try {
    recipient = await subtle().importKey('raw', buf(publicKey), EC, false, []);
  } catch {
    throw new CryptoError('invalid', 'That isn’t a results public key.');
  }
  const eph = await subtle().generateKey(EC, true, ['deriveBits']);
  const epk = new Uint8Array(await subtle().exportKey('raw', eph.publicKey));
  const shared = await subtle().deriveBits({ name: 'ECDH', public: recipient }, eph.privateKey, 256);
  const key = await resultCipherKey(shared, epk, publicKey, 'encrypt');
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: utf8.encode(resultAad(accountId, resultId)) }, key, buf(data));
  return { v: 1, epk, iv, ct: new Uint8Array(ct) };
}

/** Opens a sealed result. Throws CryptoError 'corrupt' if it's damaged, moved, or sealed to another key. */
export async function openResult(key: ResultsKey, accountId: string, resultId: string, sealed: SealedResult): Promise<Uint8Array> {
  if (
    sealed?.v !== 1 ||
    !(sealed.epk instanceof Uint8Array) ||
    sealed.epk.length !== PUBLIC_KEY_BYTES ||
    !(sealed.iv instanceof Uint8Array) ||
    sealed.iv.length !== 12 ||
    !(sealed.ct instanceof Uint8Array)
  ) {
    throw new CryptoError('corrupt', 'This result is damaged.');
  }
  try {
    const epk = await subtle().importKey('raw', buf(sealed.epk), EC, false, []);
    const shared = await subtle().deriveBits({ name: 'ECDH', public: epk }, key.privateKey, 256);
    const cipher = await resultCipherKey(shared, sealed.epk, key.publicKey, 'decrypt');
    const plain = await subtle().decrypt({ name: 'AES-GCM', iv: buf(sealed.iv), additionalData: utf8.encode(resultAad(accountId, resultId)) }, cipher, buf(sealed.ct));
    return new Uint8Array(plain);
  } catch {
    throw new CryptoError('corrupt', 'This result won’t open: it’s damaged, moved, or for another account.');
  }
}

/**
 * A page fingerprint as it goes to the server: HMAC-SHA-256 with the account's fingerprint key, in hex. The
 * server can match a page within the account, never look one up or match it between accounts.
 */
export async function keyedFingerprint(key: ResultsKey, fingerprint: { text: string; look: string }): Promise<string> {
  const mac = new Uint8Array(await subtle().sign('HMAC', key.fingerprintKey, utf8.encode(`${fingerprint.text}.${fingerprint.look}`)));
  return Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
}
