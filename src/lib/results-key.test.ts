// The results key (#161): making, opening and checking it, sealing and opening results, keyed fingerprints.
import { describe, expect, it } from 'vitest';
import { CryptoError } from '../types/crypto';
import { newDataKey } from './crypto';
import { keyedFingerprint, newResultsKey, openResult, openResultsKey, resultAad, sealResult } from './results-key';

const text = (b: Uint8Array) => new TextDecoder().decode(b);
const bytes = (s: string) => new TextEncoder().encode(s);
const fp = { text: 'a'.repeat(64), look: 'b'.repeat(64) };

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toBeInstanceOf(CryptoError);
  await expect(p).rejects.toMatchObject({ code });
}

describe('newResultsKey and openResultsKey', () => {
  it('makes a key another device opens from the server’s copy, with the same keys', async () => {
    const dataKey = await newDataKey();
    const { upload, key } = await newResultsKey(dataKey);
    expect(upload.publicKey).toHaveLength(65);
    expect(upload.publicKey[0]).toBe(4);
    const other = await openResultsKey(dataKey, upload.publicKey, upload.sealed);
    expect(other.publicKey).toEqual(upload.publicKey);
    // A result sealed for one opens with the other, and both key fingerprints the same way
    const sealed = await sealResult(upload.publicKey, 'acc', 'r1', bytes('hello'));
    expect(text(await openResult(other, 'acc', 'r1', sealed))).toBe('hello');
    expect(text(await openResult(key, 'acc', 'r1', sealed))).toBe('hello');
    expect(await keyedFingerprint(other, fp)).toBe(await keyedFingerprint(key, fp));
  });

  it('keeps the private and fingerprint keys from being read out', async () => {
    const dataKey = await newDataKey();
    const { upload } = await newResultsKey(dataKey);
    const key = await openResultsKey(dataKey, upload.publicKey, upload.sealed);
    expect(key.privateKey.extractable).toBe(false);
    expect(key.fingerprintKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('pkcs8', key.privateKey)).rejects.toThrow();
  });

  it('won’t open with another data key', async () => {
    const { upload } = await newResultsKey(await newDataKey());
    await expectCode(openResultsKey(await newDataKey(), upload.publicKey, upload.sealed), 'corrupt');
  });

  it('refuses a public key that isn’t this account’s (a swapped key)', async () => {
    const dataKey = await newDataKey();
    const ours = await newResultsKey(dataKey);
    const theirs = await newResultsKey(await newDataKey());
    await expectCode(openResultsKey(dataKey, theirs.upload.publicKey, ours.upload.sealed), 'invalid');
    await expectCode(openResultsKey(dataKey, new Uint8Array(65), ours.upload.sealed), 'invalid');
    await expectCode(openResultsKey(dataKey, ours.upload.publicKey.slice(1), ours.upload.sealed), 'invalid');
  });
});

describe('sealResult and openResult', () => {
  it('opens only with the right account, result id and key', async () => {
    const dataKey = await newDataKey();
    const { upload, key } = await newResultsKey(dataKey);
    const sealed = await sealResult(upload.publicKey, 'acc', 'r1', bytes('{"figures":[]}'));
    expect(text(await openResult(key, 'acc', 'r1', sealed))).toBe('{"figures":[]}');
    await expectCode(openResult(key, 'acc2', 'r1', sealed), 'corrupt'); // moved to another account
    await expectCode(openResult(key, 'acc', 'r2', sealed), 'corrupt'); // moved to another result
    const otherKey = (await newResultsKey(await newDataKey())).key;
    await expectCode(openResult(otherKey, 'acc', 'r1', sealed), 'corrupt'); // another account's key
  });

  it('notices any change, and refuses a malformed result', async () => {
    const { upload, key } = await newResultsKey(await newDataKey());
    const sealed = await sealResult(upload.publicKey, 'acc', 'r1', bytes('hello'));
    const flipped = new Uint8Array(sealed.ct);
    flipped[0]! ^= 1;
    await expectCode(openResult(key, 'acc', 'r1', { ...sealed, ct: flipped }), 'corrupt');
    const otherEpk = (await sealResult(upload.publicKey, 'acc', 'r1', bytes('x'))).epk;
    await expectCode(openResult(key, 'acc', 'r1', { ...sealed, epk: otherEpk }), 'corrupt');
    await expectCode(openResult(key, 'acc', 'r1', { ...sealed, iv: new Uint8Array(8) }), 'corrupt');
    await expectCode(openResult(key, 'acc', 'r1', { ...sealed, v: 2 as 1 }), 'corrupt');
  });

  it('uses a fresh ephemeral key and IV every time', async () => {
    const { upload } = await newResultsKey(await newDataKey());
    const a = await sealResult(upload.publicKey, 'acc', 'r1', bytes('same'));
    const b = await sealResult(upload.publicKey, 'acc', 'r1', bytes('same'));
    expect(a.epk).not.toEqual(b.epk);
    expect(a.iv).not.toEqual(b.iv);
    expect(a.ct).not.toEqual(b.ct);
  });

  it('refuses to seal to something that isn’t a public key', async () => {
    await expectCode(sealResult(new Uint8Array(65), 'acc', 'r1', bytes('x')), 'invalid');
  });

  it('binds the account and result id as SECURITY.md says', () => {
    expect(resultAad('acc', 'r1')).toBe('honed:v1:result:acc:r1');
  });
});

describe('keyedFingerprint', () => {
  it('is the same for the same page and account, different for another page or account', async () => {
    const key = (await newResultsKey(await newDataKey())).key;
    const other = (await newResultsKey(await newDataKey())).key;
    const k = await keyedFingerprint(key, fp);
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(await keyedFingerprint(key, fp)).toBe(k);
    expect(await keyedFingerprint(key, { ...fp, look: 'c'.repeat(64) })).not.toBe(k);
    expect(await keyedFingerprint(other, fp)).not.toBe(k);
    expect(k).not.toContain(fp.text); // never the plain hash
  });
});
