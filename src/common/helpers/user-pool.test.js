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

const { listUserPoolClients } = await import('./user-pool.js')

async function* pages(...results) {
  yield* results
}

describe('listUserPoolClients', () => {
  beforeEach(() => {
    mockPages.mockReset()
  })

  it("uses AWS's Cognito in the configured region when no endpoint is set", () => {
    expect(clientConfigs[0]).toStrictEqual({ region: 'eu-west-2' })
  })

  it('uses the configured endpoint, such as a local Cognito', async () => {
    vi.resetModules()
    vi.stubEnv('COGNITO_USER_POOL_ENDPOINT', 'http://floci:4566')

    try {
      await import('./user-pool.js')
    } finally {
      vi.stubEnv('COGNITO_USER_POOL_ENDPOINT', '')
    }

    expect(clientConfigs.at(-1)).toStrictEqual({
      region: 'eu-west-2',
      endpoint: 'http://floci:4566'
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

    await expect(listUserPoolClients()).resolves.toStrictEqual([
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

    await expect(listUserPoolClients()).resolves.toStrictEqual([])
  })

  it('throws an error naming the pool when a page cannot be read', async () => {
    const err = new Error('Access denied')
    mockPages.mockReturnValue(
      (async function* () {
        yield* []
        throw err
      })()
    )

    await expect(listUserPoolClients()).rejects.toMatchObject({
      message: 'Reading user pool eu-west-2_TEST failed: Access denied',
      cause: err
    })
  })
})
