import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SignatureV4 } from '@aws-sdk/signature-v4'
import { HttpRequest } from '@smithy/protocol-http'
import { Sha256 } from '@aws-crypto/sha256-js'

// Uses the real signer, so this checks the signature matches the URL that's
// actually sent, as AWS checks it

const credentials = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' }

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }))

vi.mock('@hapi/wreck', () => ({ default: { get: mockGet, post: vi.fn() } }))

vi.mock('@aws-sdk/credential-provider-node', () => ({
  defaultProvider: () => async () => credentials
}))

vi.mock('#/config.js', () => ({
  config: {
    get: vi.fn(() => ({
      baseUrl: 'example.com',
      region: 'eu-west-2',
      signerService: 'execute-api',
      listClientsPath: '/clients/{service-name}',
      protocol: 'https'
    }))
  }
}))

vi.mock('#/common/helpers/logging/logger.js', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
}))

const { allCognitoCredentials } = await import('./cognito-client.js')

/**
 * Signs the request a server would see for this URL, as AWS does to check it.
 * @param {string} sentUrl
 * @returns {Promise<string>} The Authorization header
 */
async function signatureFor(sentUrl) {
  const url = new URL(sentUrl)
  const signed = await new SignatureV4({
    credentials,
    region: 'eu-west-2',
    service: 'execute-api',
    sha256: Sha256
  }).sign(
    new HttpRequest({
      method: 'GET',
      protocol: 'https',
      hostname: url.hostname,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers: { host: url.hostname }
    })
  )

  return signed.headers.authorization
}

describe('allCognitoCredentials signing', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-21T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('signs each page so the signature matches the URL sent, including tokens with + / =', async () => {
    const token = 'N2Vx+c3A3/YXZqMzZu=='
    mockGet
      .mockResolvedValueOnce({
        res: { statusCode: 200 },
        payload: { client_details: [], next_token: token }
      })
      .mockResolvedValueOnce({
        res: { statusCode: 200 },
        payload: { client_details: [], next_token: null }
      })

    await allCognitoCredentials('my-service')

    expect(mockGet).toHaveBeenCalledTimes(2)
    for (const [url, options] of mockGet.mock.calls) {
      expect(options.headers.authorization).toEqual(await signatureFor(url))
    }
    expect(
      new URL(mockGet.mock.calls[1][0]).searchParams.get('next_token')
    ).toBe(token)
  })
})
