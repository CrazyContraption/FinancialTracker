import { argon2id } from 'hash-wasm'

export const VAULT_API_URL = import.meta.env.DEV
  ? '/vault-api'
  : 'https://user-vault-api.crazycontraptionmc.workers.dev'

export type VaultRecord = {
  salt: string
  blob: string
  updated_at: string
}

type RegisterResponse = {
  ok: true
  salt: string
  updated_at: string
}

type PushResponse = {
  ok: true
  updated_at: string
}

const ARGON_OPTIONS = {
  iterations: 3,
  memorySize: 19_456,
  parallelism: 1,
  hashLength: 32,
} as const

function toBase64(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

function fromBase64(value: string) {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

async function argonBytes(password: string, salt?: Uint8Array) {
  return argon2id({
    password,
    salt: salt ?? 'username-hash',
    ...ARGON_OPTIONS,
    outputType: 'binary',
  })
}

export async function hashUsername(username: string) {
  return toBase64(await argonBytes(username.trim()))
}

async function deriveKey(password: string, salt: Uint8Array) {
  const keyBytes = await argonBytes(password, salt)
  return crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function encryptVault(value: unknown, password: string, salt: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(password, fromBase64(salt))
  const plaintext = new TextEncoder().encode(JSON.stringify(value))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext))
  const payload = new Uint8Array(iv.length + ciphertext.length)
  payload.set(iv)
  payload.set(ciphertext, iv.length)
  return toBase64(payload)
}

export async function decryptVault<T>(blob: string, password: string, salt: string) {
  const payload = fromBase64(blob)
  const key = await deriveKey(password, fromBase64(salt))
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: payload.slice(0, 12) },
    key,
    payload.slice(12),
  )
  return JSON.parse(new TextDecoder().decode(plaintext)) as T
}

async function request<T>(path: string, body: unknown) {
  const response = await fetch(`${VAULT_API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const error = new Error(`Vault request failed (${response.status})`)
    Object.assign(error, { status: response.status, body: await response.text() })
    throw error
  }
  return response.json() as Promise<T>
}

export function vaultErrorStatus(error: unknown) {
  return typeof error === 'object' && error !== null && 'status' in error
    ? (error as { status?: number }).status
    : undefined
}

export function registerVault(usernameHash: string) {
  return request<RegisterResponse>('/register', { username_hash: usernameHash })
}

export function lookupVault(usernameHash: string) {
  return request<VaultRecord>('/lookup', { username_hash: usernameHash })
}

export function pushVault(usernameHash: string, salt: string, blob: string, updatedAt: string) {
  return request<PushResponse>('/push', {
    username_hash: usernameHash,
    salt,
    blob,
    updated_at: updatedAt,
  })
}
