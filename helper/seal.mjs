// Sealing a finished result to an account's results key (#161, docs/SECURITY.md "AI work in the background").
// The same construction as the app's sealResult (src/lib/results-key.ts), with Node's own WebCrypto: a fresh
// ephemeral P-256 key pair, ECDH with the account's public key, HKDF-SHA-256 (salt: the ephemeral public key
// then the account's, info "honed:v1:result"), AES-256-GCM with additional data
// "honed:v1:result:<account id>:<result id>". tests/helper/queue.test.mjs opens what this seals with the app's
// own openResult, so the two can't drift apart.
import { webcrypto } from 'node:crypto';

const subtle = webcrypto.subtle;
const EC = { name: 'ECDH', namedCurve: 'P-256' };
const utf8 = new TextEncoder();

/** Whether these bytes are a P-256 public key a result can be sealed to. */
export async function isResultsPublicKey(raw) {
  if (!(raw instanceof Uint8Array) || raw.length !== 65 || raw[0] !== 4) return false;
  try {
    await subtle.importKey('raw', raw, EC, false, []);
    return true;
  } catch {
    return false;
  }
}

/** Seals `data` (bytes) to the account's public key: { v: 1, epk, iv, ct } with bytes as Uint8Array. */
export async function sealResult(publicKey, accountId, resultId, data) {
  const recipient = await subtle.importKey('raw', publicKey, EC, false, []);
  const eph = await subtle.generateKey(EC, true, ['deriveBits']);
  const epk = new Uint8Array(await subtle.exportKey('raw', eph.publicKey));
  const shared = await subtle.deriveBits({ name: 'ECDH', public: recipient }, eph.privateKey, 256);
  const ikm = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const salt = new Uint8Array(epk.length + publicKey.length);
  salt.set(epk, 0);
  salt.set(publicKey, epk.length);
  const key = await subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: utf8.encode('honed:v1:result') }, ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8.encode(`honed:v1:result:${accountId}:${resultId}`) }, key, data));
  return { v: 1, epk, iv, ct };
}
