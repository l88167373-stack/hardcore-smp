/**
 * Chiffrement des jetons avec le trousseau du système (safeStorage d'Electron) :
 * DPAPI sur Windows, Trousseau sur macOS, libsecret/kwallet sur Linux.
 */
import { safeStorage } from 'electron'

export interface Cipher {
  /** Faux si le système n'offre pas de stockage chiffré : les jetons restent alors en mémoire seulement. */
  readonly available: boolean
  encrypt(plain: string): string
  /** Lève une erreur si le texte ne peut pas être déchiffré (trousseau changé, fichier abîmé). */
  decrypt(encoded: string): string
}

export function electronCipher(): Cipher {
  // Sous Linux sans trousseau, Electron se rabat sur un « chiffrement » en clair : on le refuse.
  const plainTextFallback = process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'
  const available = safeStorage.isEncryptionAvailable() && !plainTextFallback
  return {
    available,
    encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
    decrypt: (encoded) => safeStorage.decryptString(Buffer.from(encoded, 'base64'))
  }
}
