import { createHash } from 'node:crypto'

/** Stable fingerprint for a paired runtime public key. */
export function fingerprintPeerPublicKey(publicKeyB64: string): string {
  return createHash('sha256').update(Buffer.from(publicKeyB64, 'base64')).digest('base64url')
}
