import Hapi from '@hapi/hapi'
import { basicAuth } from '@defra/waste-movement-utils'
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose'

import { config } from '#/config.js'
import { isStsAuthEnabled, stsAuth, stsStrategy } from '#/plugins/sts-auth.js'

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}))

vi.mock('#/common/helpers/logging/logger.js', () => ({
  createLogger: () => mockLogger
}))

const issuer = 'https://example.tokens.sts.global.api.aws'
const audience = 'dwt-client-sync'
const awsAccount = '123456789012'

/**
 * Switches STS auth on, as CDP and STS_AUDIENCE would
 * @returns {void}
 */
function switchOn() {
  config.set('stsAuth.audience', audience)
  config.set('stsAuth.issuer', issuer)
  config.set('stsAuth.jwksUri', `${issuer}/.well-known/jwks.json`)
  config.set('stsAuth.awsAccount', awsAccount)
}

/**
 * @returns {void}
 */
function switchOff() {
  config.set('stsAuth.audience', null)
  config.set('stsAuth.issuer', null)
  config.set('stsAuth.jwksUri', null)
  config.set('stsAuth.awsAccount', null)
}

describe('#stsAuth', () => {
  let server
  let keys
  let ecKeys
  let otherKeys

  const role = (service, account = awsAccount) =>
    `arn:aws:iam::${account}:role/${service}`

  /**
   * @param {object} [overrides] - What to change from a valid token
   * @returns {Promise<string>} A signed token
   */
  async function token({
    sub = role('digital-waste-tracking-admin-ui'),
    aud = audience,
    iss = issuer,
    expiresIn = '5m',
    alg = 'RS256',
    privateKey = keys.privateKey
  } = {}) {
    return new SignJWT({})
      .setProtectedHeader({ alg })
      .setSubject(sub)
      .setAudience(aud)
      .setIssuer(iss)
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .sign(privateKey)
  }

  const call = (authorization) =>
    server.inject({
      method: 'GET',
      url: '/caller',
      headers: authorization ? { authorization } : {}
    })

  beforeAll(async () => {
    keys = await generateKeyPair('RS256')
    ecKeys = await generateKeyPair('ES384')
    otherKeys = await generateKeyPair('RS256')
    switchOn()

    // As the server sets it up: STS tokens first, then the real basic auth
    server = Hapi.server()
    await server.register([
      basicAuth([btoa('tester=secret')]),
      {
        plugin: stsAuth.plugin,
        options: {
          jwks: createLocalJWKSet({
            keys: [
              { ...(await exportJWK(keys.publicKey)), alg: 'RS256' },
              { ...(await exportJWK(ecKeys.publicKey)), alg: 'ES384' }
            ]
          })
        }
      }
    ])
    server.auth.default({ strategies: [stsStrategy, 'basic'] })
    server.route({
      method: 'GET',
      path: '/caller',
      handler: (request) => request.auth.credentials
    })
  })

  afterAll(switchOff)

  afterEach(() => {
    config.set('stsAuth.allowedCallers', [
      'digital-waste-tracking-admin-ui',
      'waste-movement-external-api'
    ])
  })

  test('Should know the calling service from its STS token', async () => {
    const { statusCode, result } = await call(`Bearer ${await token()}`)

    expect(statusCode).toBe(200)
    expect(result).toEqual({ username: 'digital-waste-tracking-admin-ui' })
  })

  test('Should accept an ES384 token, as STS can sign with either', async () => {
    const { statusCode } = await call(
      `Bearer ${await token({ alg: 'ES384', privateKey: ecKeys.privateKey })}`
    )

    expect(statusCode).toBe(200)
  })

  test('Should still accept basic auth', async () => {
    const { statusCode, result } = await call(`Basic ${btoa('tester:secret')}`)

    expect(statusCode).toBe(200)
    expect(result).toEqual({ username: 'tester' })
  })

  test('Should ask for either, when a request has neither', async () => {
    const { statusCode, headers } = await call()

    expect(statusCode).toBe(401)
    expect(headers['www-authenticate']).toBe('Bearer, Basic')
  })

  test.each([
    ['meant for another service', () => token({ aud: 'another-service' })],
    ['from another issuer', () => token({ iss: 'https://another.example' })],
    ['expired', () => token({ expiresIn: '-1m' })],
    [
      'signed with another key',
      () => token({ privateKey: otherKeys.privateKey })
    ],
    ['that is not a token', () => 'not-a-token']
  ])('Should refuse a token %s', async (_, makeToken) => {
    const { statusCode, headers } = await call(`Bearer ${await makeToken()}`)

    // Refused by the STS strategy, rather than left to basic auth
    expect(statusCode).toBe(401)
    expect(headers['www-authenticate']).toBe('Bearer error="Invalid token"')
  })

  test.each([
    ['a service that may not call', role('some-other-service')],
    [
      'a role in another AWS account',
      role('waste-movement-external-api', '210987654321')
    ],
    ['something other than a role', 'not-a-role']
  ])('Should forbid %s', async (_, sub) => {
    const { statusCode } = await call(`Bearer ${await token({ sub })}`)

    expect(statusCode).toBe(403)
    expect(mockLogger.warn).toHaveBeenCalledWith(
      `Refused an STS token from ${sub}: not an allowed caller`
    )
  })

  test('Should ignore spaces in the allowed callers', async () => {
    // As convict leaves them when it splits STS_ALLOWED_CALLERS
    config.set('stsAuth.allowedCallers', [
      'waste-movement-external-api',
      ' digital-waste-tracking-admin-ui'
    ])

    const { statusCode } = await call(`Bearer ${await token()}`)

    expect(statusCode).toBe(200)
  })
})

describe('#isStsAuthEnabled', () => {
  afterEach(switchOff)

  test('Should be on with an audience, and the issuer, keys and account CDP sets', () => {
    switchOn()

    expect(isStsAuthEnabled()).toBe(true)
  })

  test.each([
    ['an audience', 'stsAuth.audience'],
    ['the issuer', 'stsAuth.issuer'],
    ['the keys', 'stsAuth.jwksUri'],
    ['the AWS account', 'stsAuth.awsAccount']
  ])('Should be off without %s', (_, key) => {
    switchOn()
    config.set(key, null)

    expect(isStsAuthEnabled()).toBe(false)
  })
})
