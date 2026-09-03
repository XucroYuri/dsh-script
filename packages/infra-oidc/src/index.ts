import { createPublicKey, createVerify } from 'node:crypto'
import type { AccessTokenVerifierPort, VerifiedCloudSession } from '@script-studio/contracts'
import { asMemberId, asTeamId } from '@script-studio/domain'

export const OIDC_SIGNING_ALGORITHM = 'RS256' as const
const DEFAULT_TEAM_CLAIM = 'team_id'
const DEFAULT_MEMBER_CLAIM = 'member_id'
const DEFAULT_CLOCK_SKEW_SECONDS = 60
const DEFAULT_JWKS_CACHE_SECONDS = 300
const MAX_CLOCK_SKEW_SECONDS = 300
const MAX_TOKEN_BYTES = 16 * 1024

export interface OidcJsonWebKey {
  kty: string
  n: string
  e: string
  kid?: string
  alg?: string
  use?: string
}

export interface OidcJsonWebKeySet {
  keys: readonly OidcJsonWebKey[]
}

export interface OidcClockPort {
  now(): number
}

export interface OidcJwksProviderPort {
  getKeys(forceRefresh?: boolean): Promise<readonly OidcJsonWebKey[]>
}

export interface OidcJwksHttpClientPort {
  getJson(uri: string): Promise<unknown>
}

export interface OidcVerifierOptions {
  issuer: string
  audience: string
  jwks: OidcJwksProviderPort
  teamClaim?: string
  memberClaim?: string
  clock?: OidcClockPort
  clockSkewSeconds?: number
}

export interface FetchJwksProviderOptions {
  clock?: OidcClockPort
  cacheSeconds?: number
}

const systemClock: OidcClockPort = { now: () => Math.floor(Date.now() / 1000) }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireHttpsUri(value: string, field: string): string {
  let parsed: URL
  try { parsed = new URL(value) } catch { throw new Error(`${field} must be a valid URL.`) }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) {
    throw new Error(`${field} must be an https URL without credentials or fragment.`)
  }
  return value
}

function requireIssuer(value: string): string {
  const issuer = requireHttpsUri(value, 'issuer')
  const parsed = new URL(issuer)
  if (parsed.search) throw new Error('issuer must not contain a query string.')
  return issuer
}

function requirePositiveString(value: string, field: string): string {
  if (!value || value.length > 256 || /\s/.test(value)) throw new Error(`${field} must be a non-empty bounded string.`)
  return value
}

function requireSeconds(value: number, field: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new Error(`${field} is outside the allowed range.`)
  return value
}

function isJwk(value: unknown): value is OidcJsonWebKey {
  return isRecord(value)
    && value.kty === 'RSA'
    && typeof value.n === 'string' && value.n.length > 0
    && typeof value.e === 'string' && value.e.length > 0
    && (value.kid === undefined || typeof value.kid === 'string')
    && (value.alg === undefined || typeof value.alg === 'string')
    && (value.use === undefined || typeof value.use === 'string')
}

function parseJwks(value: unknown): readonly OidcJsonWebKey[] {
  if (!isRecord(value) || !Array.isArray(value.keys)) throw new Error('JWKS response is invalid.')
  const keys = value.keys.filter(isJwk)
  if (keys.length === 0) throw new Error('JWKS response contains no RSA keys.')
  return keys
}

export class FetchJwksHttpClient implements OidcJwksHttpClientPort {
  async getJson(uri: string): Promise<unknown> {
    const response = await fetch(uri, {
      headers: { accept: 'application/json' },
      redirect: 'error',
    })
    if (!response.ok) throw new Error(`JWKS request failed with status ${response.status}.`)
    return response.json()
  }
}

export class CachedJwksProvider implements OidcJwksProviderPort {
  private cached: { fetchedAt: number; keys: readonly OidcJsonWebKey[] } | null = null

  private readonly uri: string
  private readonly http: OidcJwksHttpClientPort
  private readonly clock: OidcClockPort
  private readonly cacheSeconds: number

  constructor(uri: string, http: OidcJwksHttpClientPort, options: FetchJwksProviderOptions = {}) {
    this.uri = requireHttpsUri(uri, 'jwksUri')
    this.http = http
    this.clock = options.clock ?? systemClock
    this.cacheSeconds = requireSeconds(options.cacheSeconds ?? DEFAULT_JWKS_CACHE_SECONDS, 'cacheSeconds', 86_400)
  }

  async getKeys(forceRefresh = false): Promise<readonly OidcJsonWebKey[]> {
    const now = this.clock.now()
    if (!forceRefresh && this.cached && now < this.cached.fetchedAt + this.cacheSeconds) return this.cached.keys
    const keys = parseJwks(await this.http.getJson(this.uri))
    this.cached = { fetchedAt: now, keys: Object.freeze([...keys]) }
    return keys
  }
}

interface ParsedJwt {
  header: Record<string, unknown>
  claims: Record<string, unknown>
  signingInput: string
  signature: Buffer
}

function decodeJsonPart(part: string, field: string): Record<string, unknown> {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) throw new Error(`${field} is not base64url.`)
  const decoded = Buffer.from(part, 'base64url')
  if (decoded.toString('base64url') !== part) throw new Error(`${field} has a non-canonical encoding.`)
  const value: unknown = JSON.parse(decoded.toString('utf8'))
  if (!isRecord(value)) throw new Error(`${field} must be a JSON object.`)
  return value
}

function parseCompactJwt(token: string): ParsedJwt {
  if (Buffer.byteLength(token, 'utf8') > MAX_TOKEN_BYTES) throw new Error('access token is too large.')
  const parts = token.split('.')
  if (parts.length !== 3 || parts.some(part => !part)) throw new Error('access token is not a compact JWT.')
  const [encodedHeader, encodedClaims, encodedSignature] = parts as [string, string, string]
  if (!/^[A-Za-z0-9_-]+$/.test(encodedSignature)) throw new Error('signature is not base64url.')
  const signature = Buffer.from(encodedSignature, 'base64url')
  if (signature.length === 0 || signature.toString('base64url') !== encodedSignature) throw new Error('signature encoding is invalid.')
  return {
    header: decodeJsonPart(encodedHeader, 'header'),
    claims: decodeJsonPart(encodedClaims, 'claims'),
    signingInput: `${encodedHeader}.${encodedClaims}`,
    signature,
  }
}

function stringClaim(claims: Record<string, unknown>, name: string, field: string): string {
  const value = claims[name]
  if (typeof value !== 'string' || !value) throw new Error(`${field} claim is invalid.`)
  return value
}

function numericClaim(claims: Record<string, unknown>, name: string, field: string, required: boolean): number | undefined {
  const value = claims[name]
  if (value === undefined && !required) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isSafeInteger(value) || value < 0) throw new Error(`${field} claim is invalid.`)
  return value
}

function audienceContains(value: unknown, audience: string): boolean {
  if (typeof value === 'string') return value === audience
  return Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'string') && value.includes(audience)
}

function hasForbiddenKeyReference(header: Record<string, unknown>): boolean {
  return ['jku', 'jwk', 'x5u', 'x5c', 'crit'].some(name => Object.prototype.hasOwnProperty.call(header, name))
}

function matchingKey(keys: readonly OidcJsonWebKey[], kid: string): OidcJsonWebKey | undefined {
  return keys.find(key => key.kid === kid && key.kty === 'RSA' && (key.alg === undefined || key.alg === OIDC_SIGNING_ALGORITHM) && (key.use === undefined || key.use === 'sig'))
}

export class OidcAccessTokenVerifier implements AccessTokenVerifierPort {
  private readonly issuer: string
  private readonly audience: string
  private readonly jwks: OidcJwksProviderPort
  private readonly teamClaim: string
  private readonly memberClaim: string
  private readonly clock: OidcClockPort
  private readonly clockSkewSeconds: number

  constructor(options: OidcVerifierOptions) {
    this.issuer = requireIssuer(options.issuer)
    this.audience = requirePositiveString(options.audience, 'audience')
    this.jwks = options.jwks
    this.teamClaim = requirePositiveString(options.teamClaim ?? DEFAULT_TEAM_CLAIM, 'teamClaim')
    this.memberClaim = requirePositiveString(options.memberClaim ?? DEFAULT_MEMBER_CLAIM, 'memberClaim')
    this.clock = options.clock ?? systemClock
    this.clockSkewSeconds = requireSeconds(options.clockSkewSeconds ?? DEFAULT_CLOCK_SKEW_SECONDS, 'clockSkewSeconds', MAX_CLOCK_SKEW_SECONDS)
  }

  async verify(accessToken: string): Promise<VerifiedCloudSession | null> {
    try {
      const jwt = parseCompactJwt(accessToken)
      if (jwt.header.alg !== OIDC_SIGNING_ALGORITHM || typeof jwt.header.kid !== 'string' || !jwt.header.kid || jwt.header.kid.length > 256 || hasForbiddenKeyReference(jwt.header)) return null
      let key = matchingKey(await this.jwks.getKeys(), jwt.header.kid)
      if (!key) key = matchingKey(await this.jwks.getKeys(true), jwt.header.kid)
      if (!key) return null
      const publicKey = createPublicKey({ key: { kty: 'RSA', n: key.n, e: key.e }, format: 'jwk' })
      const valid = createVerify('RSA-SHA256').update(jwt.signingInput).verify(publicKey, jwt.signature)
      if (!valid) return null

      const now = this.clock.now()
      const subject = stringClaim(jwt.claims, 'sub', 'sub')
      if (subject.length > 255 || !/^[\x00-\x7F]+$/.test(subject)) return null
      if (jwt.claims.iss !== this.issuer || !audienceContains(jwt.claims.aud, this.audience)) return null
      const expiration = numericClaim(jwt.claims, 'exp', 'exp', true)!
      const issuedAt = numericClaim(jwt.claims, 'iat', 'iat', true)!
      const notBefore = numericClaim(jwt.claims, 'nbf', 'nbf', false)
      if (expiration <= now - this.clockSkewSeconds || issuedAt > now + this.clockSkewSeconds || issuedAt > expiration) return null
      if (notBefore !== undefined && notBefore > now + this.clockSkewSeconds) return null
      return {
        subject,
        teamId: asTeamId(stringClaim(jwt.claims, this.teamClaim, this.teamClaim)),
        memberId: asMemberId(stringClaim(jwt.claims, this.memberClaim, this.memberClaim)),
      }
    } catch {
      return null
    }
  }
}
