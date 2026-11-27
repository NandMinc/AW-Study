// The shared contract for milestone 3's encryption (docs/SECURITY.md). The data layer (#16), the
// screens (#17) and backups (#18) code against these types and the function signatures in
// src/lib/crypto.ts and src/lib/passkey.ts. Change them only in their own small PR, announced in
// those issues.
//
// Bytes are Uint8Array: IndexedDB stores them as they are; backups (#18) encode them as base64url.

/** Every way of unlocking. */
export type UnlockMethod = 'passphrase' | 'passkey' | 'recovery' | 'google';

/** Key derivation for a passphrase: PBKDF2-HMAC-SHA-256. */
export interface Pbkdf2Params {
  name: 'PBKDF2';
  hash: 'SHA-256';
  iterations: number;
  salt: Uint8Array; // 16 random bytes
}

/** Key derivation from a high-entropy secret (a recovery key, a passkey's PRF output). */
export interface HkdfParams {
  name: 'HKDF';
  hash: 'SHA-256';
  salt: Uint8Array; // 16 random bytes
  info: string; // what the key is for, e.g. "honed:v1:recovery"
}

interface EntryBase {
  id: string; // random, so one entry can be removed or replaced
  createdAt: string; // ISO time
  wrap: 'AES-KW'; // how the data key is wrapped
  wrapped: Uint8Array; // the data key, wrapped with this entry's key-encryption key
}

/** One wrapped copy of the data key. */
export type KeyringEntry =
  | (EntryBase & { method: 'passphrase'; kdf: Pbkdf2Params })
  | (EntryBase & { method: 'recovery'; kdf: HkdfParams })
  | (EntryBase & {
      method: 'passkey';
      kdf: HkdfParams;
      credentialId: Uint8Array; // which passkey
      prfSalt: Uint8Array; // the 32 bytes the passkey's PRF is evaluated on
      label: string; // shown in Settings, e.g. "iPhone" (the user can edit it)
    })
  | (EntryBase & {
      // Google unlock (#101, docs/SECURITY.md "Google unlock"): wrapped under the account's key, which the
      // sync server keeps and gives out only after a fresh Google sign-in. Opt-in.
      method: 'google';
      kdf: HkdfParams;
      email: string; // the Google account, shown in Settings
    });

/** All the ways this user can unlock. Stored in `meta` (#16) and in backups (#18). */
export interface Keyring {
  v: 1;
  entries: KeyringEntry[];
}

/** A record's private part, encrypted. */
export interface EncryptedRecord {
  v: 1;
  iv: Uint8Array; // 12 random bytes, never reused
  ct: Uint8Array; // AES-GCM ciphertext with its 16-byte tag
}

/**
 * This device's remembered unlock (#99, docs/SECURITY.md "Remembering a device"): the data key wrapped
 * by a device key that can't be read out of the page. Kept in this device's `meta` only: never in the
 * keyring, a backup or a sync.
 */
export interface RememberedKey {
  v: 1;
  deviceKey: CryptoKey; // AES-GCM 256, extractable: false
  iv: Uint8Array; // 12 random bytes
  wrapped: Uint8Array; // the data key, AES-GCM-wrapped by deviceKey
  at: string; // ISO time it was remembered
}

/** What the user gives to unlock. */
export type UnlockSecret =
  | { method: 'passphrase'; passphrase: string }
  | { method: 'recovery'; recoveryKey: string }
  | { method: 'passkey'; credentialId: Uint8Array; prfOutput: Uint8Array }
  | { method: 'google'; googleKey: Uint8Array }; // the account's Google unlock key, from the sync server

/**
 * An account's results key, open on a device (#161, docs/SECURITY.md "AI work in the background"): the
 * public key (raw P-256, 65 bytes) the server seals results to, the private key that opens them and the key
 * that turns page fingerprints into keyed ones. Both keys are non-extractable.
 */
export interface ResultsKey {
  publicKey: Uint8Array;
  privateKey: CryptoKey;
  fingerprintKey: CryptoKey;
}

/** A new results key as it goes to the server: the public key, and the private part sealed with the data key. */
export interface NewResultsKey {
  publicKey: Uint8Array;
  sealed: EncryptedRecord;
}

/** A result sealed to an account's results key: an ephemeral public key (raw P-256), a 12-byte IV, AES-GCM. */
export interface SealedResult {
  v: 1;
  epk: Uint8Array;
  iv: Uint8Array;
  ct: Uint8Array;
}

export type CryptoErrorCode =
  | 'wrong-secret' // doesn't unlock this keyring
  | 'invalid' // badly formed input (e.g. a recovery key failing its check)
  | 'corrupt' // a record or entry that won't decrypt or parse
  | 'unsupported'; // the browser lacks something (e.g. PRF)

export class CryptoError extends Error {
  constructor(
    readonly code: CryptoErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CryptoError';
  }
}
