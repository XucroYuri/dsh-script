import { createSign, generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  CachedJwksProvider,
  OIDC_SIGNING_ALGORITHM,
  OidcAccessTokenVerifier,
  type OidcClockPort,
  type OidcJsonWebKey,
  type OidcJwksHttpClientPort,
  type OidcJwksProviderPort,
} from '../src/index.js'

const now = 1_700_000_000
const clock: OidcClockPort = { now: () => now }
const issuer = 'https://issuer.example.com/tenant'
const audience = 'script-studio-web'

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function keyMaterial() {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = pair.publicKey.export({ format: 'jwk' }) as OidcJsonWebKey
  return { privateKey: pair.privateKey, jwk: { ...jwk, kid: 'key-1', alg: OIDC_SIGNING_ALGORITHM, use: 'sig' } }
}

const trusted = keyMaterial()

function token(claims: Record<string, unknown>, privateKey = trusted.privateKey, header: Record<string, unknown> = { alg: OIDC_SIGNING_ALGORITHM, kid: 'key-1' }): string {
  const encodedHeader = base64url(header)
  const encodedClaims = base64url(claims)
  const signingInput = `${encodedHeader}.${encodedClaims}`
  const signature = createSign('RSA-SHA256').update(signingInput).sign(privateKey).toString('base64url')
  return `${signingInput}.${signature}`
}

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: issuer,
    sub: 'oidc|writer',
    aud: audience,
    exp: now + 300,
    iat: now - 10,
    team_id: 'team-1',
    member_id: 'member-1',
    ...overrides,
  }
}

class StaticJwks implements OidcJwksProviderPort {
  readonly refreshes: boolean[] = []

  constructor(private readonly keys: readonly OidcJsonWebKey[]) {}

  async getKeys(forceRefresh = false): Promise<readonly OidcJsonWebKey[]> {
    this.refreshes.push(forceRefresh)
    return this.keys
  }
}

describe('OIDC JWT verifier', () => {
  it('verifies RS256, issuer, audience, time and Team/member claims', async () => {
    const verifier = new OidcAccessTokenVerifier({
      issuer,
      audience,
      jwks: new StaticJwks([trusted.jwk]),
      clock,
    })

    await expect(verifier.verify(token(claims({ aud: [audience, 'other-service'] })))).resolves.toEqual({
      subject: 'oidc|writer',
      teamId: 'team-1',
      memberId: 'member-1',
    })
  })

  it('rejects a validly shaped token whose signature or trust claims fail', async () => {
    const other = keyMaterial()
    const jwks = new StaticJwks([trusted.jwk])
    const verifier = new OidcAccessTokenVerifier({ issuer, audience, jwks, clock })

    await expect(verifier.verify(token(claims(), other.privateKey))).resolves.toBeNull()
    await expect(verifier.verify(token(claims({ iss: 'https://evil.example.com/tenant' })))).resolves.toBeNull()
    await expect(verifier.verify(token(claims({ aud: 'other-client' })))).resolves.toBeNull()
    await expect(verifier.verify(token(claims({ exp: now - 61 })))).resolves.toBeNull()
  })

  it('rejects unsupported algorithms and key-source headers before JWKS access', async () => {
    const jwks = new StaticJwks([trusted.jwk])
    const verifier = new OidcAccessTokenVerifier({ issuer, audience, jwks, clock })

    await expect(verifier.verify(token(claims(), trusted.privateKey, { alg: 'HS256', kid: 'key-1' }))).resolves.toBeNull()
    await expect(verifier.verify(token(claims(), trusted.privateKey, { alg: OIDC_SIGNING_ALGORITHM, kid: 'key-1', jku: 'https://evil.example.com/jwks' }))).resolves.toBeNull()
    await expect(verifier.verify(token(claims(), trusted.privateKey, { alg: OIDC_SIGNING_ALGORITHM, kid: 'key-1', crit: ['unknown'] }))).resolves.toBeNull()
    expect(jwks.refreshes).toEqual([])
  })

  it('rejects future/not-before and invalid domain identity claims', async () => {
    const verifier = new OidcAccessTokenVerifier({ issuer, audience, jwks: new StaticJwks([trusted.jwk]), clock })

    await expect(verifier.verify(token(claims({ iat: now + 61 })))).resolves.toBeNull()
    await expect(verifier.verify(token(claims({ nbf: now + 61 })))).resolves.toBeNull()
    await expect(verifier.verify(token(claims({ team_id: 'not a stable id' })))).resolves.toBeNull()
  })

  it('caches JWKS and supports explicit refresh for key rotation', async () => {
    let reads = 0
    const http: OidcJwksHttpClientPort = {
      async getJson(): Promise<unknown> {
        reads += 1
        return { keys: [trusted.jwk] }
      },
    }
    let currentTime = 100
    const cached = new CachedJwksProvider('https://issuer.example.com/jwks', http, { clock: { now: () => currentTime }, cacheSeconds: 300 })

    await cached.getKeys()
    await cached.getKeys()
    expect(reads).toBe(1)
    currentTime = 401
    await cached.getKeys()
    expect(reads).toBe(2)
    await cached.getKeys(true)
    expect(reads).toBe(3)
  })
})
