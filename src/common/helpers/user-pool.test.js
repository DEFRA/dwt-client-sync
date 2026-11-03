import https from 'node:https'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockPages, clientConfigs } = vi.hoisted(() => ({
  mockPages: vi.fn(),
  clientConfigs: []
}))

vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: class {
    constructor(clientConfig) {
      clientConfigs.push(clientConfig)
    }
  },
  paginateListUserPoolClients: (...args) => mockPages(...args)
}))

// Set here, so the tests don't depend on the shell's environment
vi.stubEnv('AWS_REGION', 'eu-west-2')
vi.stubEnv('COGNITO_USER_POOL_ID', 'eu-west-2_TEST')
vi.stubEnv('COGNITO_USER_POOL_ENDPOINT', '')
vi.stubEnv('COGNITO_SERVICE_SYNC_LIST', 'waste-movement-external-api')

const { listUserPoolClients } = await import('./user-pool.js')

const service = 'waste-movement-external-api'

async function* pages(...results) {
  yield* results
}

// Pages that fail to load, as when Cognito can't be reached. The yield is
// only there because a generator must have one
async function* failingPages(err) {
  yield* []
  throw err
}

describe('listUserPoolClients', () => {
  beforeEach(() => {
    mockPages.mockReset()
  })

  it("uses AWS's Cognito in the configured region when no endpoint is set", () => {
    expect(clientConfigs[0]).toStrictEqual({
      region: 'eu-west-2',
      requestHandler: expect.any(Object)
    })
  })

  it('uses the configured endpoint, such as a local Cognito', async () => {
    vi.resetModules()
    vi.stubEnv('COGNITO_USER_POOL_ENDPOINT', 'http://floci:4566')

    try {
      await import('./user-pool.js')
    } finally {
      vi.stubEnv('COGNITO_USER_POOL_ENDPOINT', '')
    }

    expect(clientConfigs.at(-1)).toMatchObject({
      region: 'eu-west-2',
      endpoint: 'http://floci:4566'
    })
  })

  it("goes through the proxy in the environment, as CDP's are", () => {
    const { httpsAgent, ...timeouts } = clientConfigs[0].requestHandler

    expect(httpsAgent).toBeInstanceOf(https.Agent)
    expect(httpsAgent.keepAlive).toBe(true)
    expect(httpsAgent.options.proxyEnv).toBe(process.env)
    expect(timeouts).toStrictEqual({
      connectionTimeout: 5_000,
      requestTimeout: 30_000
    })
  })

  it('returns the id and name of every client on every page of the pool', async () => {
    mockPages.mockReturnValue(
      pages(
        {
          UserPoolClients: [
            { ClientId: 'id-1', ClientName: 'Client 1', UserPoolId: 'pool' }
          ]
        },
        { UserPoolClients: [{ ClientId: 'id-2', ClientName: 'Client 2' }] }
      )
    )

    await expect(listUserPoolClients(service)).resolves.toStrictEqual([
      { clientId: 'id-1', clientName: 'Client 1' },
      { clientId: 'id-2', clientName: 'Client 2' }
    ])
    expect(mockPages).toHaveBeenCalledWith(
      { client: expect.anything() },
      { UserPoolId: 'eu-west-2_TEST', MaxResults: 60 }
    )
  })

  it('returns no clients for a page without any', async () => {
    mockPages.mockReturnValue(pages({}))

    await expect(listUserPoolClients(service)).resolves.toStrictEqual([])
  })

  it.each([
    ['another service', 'waste-movement-external-api', 'other-service'],
    [
      'one of several managed services, as only one pool is configured',
      'waste-movement-external-api,other-service',
      'waste-movement-external-api'
    ]
  ])(
    'refuses to read the clients of %s',
    async (_, syncList, tenantServiceName) => {
      vi.resetModules()
      vi.stubEnv('COGNITO_SERVICE_SYNC_LIST', syncList)

      try {
        const { listUserPoolClients: list } = await import('./user-pool.js')

        await expect(list(tenantServiceName)).rejects.toThrow(
          `The user pool is only configured for a single managed service, so can't read ${tenantServiceName}'s clients`
        )
        expect(mockPages).not.toHaveBeenCalled()
      } finally {
        vi.stubEnv('COGNITO_SERVICE_SYNC_LIST', 'waste-movement-external-api')
      }
    }
  )

  it('throws an error naming the pool when a page cannot be read', async () => {
    const err = new Error('Access denied')
    mockPages.mockReturnValue(failingPages(err))

    await expect(listUserPoolClients(service)).rejects.toMatchObject({
      message: 'Reading user pool eu-west-2_TEST failed: Error: Access denied',
      cause: err
    })
  })

  it('lists the reasons for a failed connection, whose error has no message', async () => {
    const err = new AggregateError([
      new Error('connect ECONNREFUSED 1.2.3.4:443'),
      new Error('connect ENETUNREACH ::1:443')
    ])
    mockPages.mockReturnValue(failingPages(err))

    await expect(listUserPoolClients(service)).rejects.toMatchObject({
      message:
        'Reading user pool eu-west-2_TEST failed: AggregateError: connect ECONNREFUSED 1.2.3.4:443; connect ENETUNREACH ::1:443',
      cause: err
    })
  })

  it.each([
    [
      'the code of a failed connection with no reasons',
      Object.assign(new AggregateError([]), { code: 'ECONNREFUSED' }),
      'AggregateError: ECONNREFUSED'
    ],
    ['something thrown that is not an error', undefined, 'undefined']
  ])('describes %s', async (_, thrown, description) => {
    mockPages.mockReturnValue(failingPages(thrown))

    await expect(listUserPoolClients(service)).rejects.toMatchObject({
      message: `Reading user pool eu-west-2_TEST failed: ${description}`
    })
  })
})
