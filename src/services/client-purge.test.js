import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn()
}))

vi.mock('#/common/helpers/logging/logger.js', () => ({
  createLogger: () => mockLogger
}))

vi.mock('#/common/helpers/cognito-client.js', () => ({
  purgeCognitoCredential: vi.fn()
}))

vi.mock('#/services/clients.js', () => ({
  findClients: vi.fn()
}))

const { purgeCognitoCredential } =
  await import('#/common/helpers/cognito-client.js')
const { findClients } = await import('#/services/clients.js')
const { PurgeOutcome } = await import('#/domain/client-secrets.js')
const { purgeOldSecret } = await import('./client-purge.js')

const db = {}
const tenantServiceName = 'waste-movement-external-api'
const clientId = 'my_client_id'
const client = { clientId, clientName: 'Test Client' }
const otherClient = { clientId: 'other_client_id', clientName: 'Other Client' }

describe('purgeOldSecret', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findClients.mockResolvedValue([client, otherClient])
    purgeCognitoCredential.mockResolvedValue([client])
  })

  it('purges by name, without a cutoff, using the stored clients', async () => {
    const outcome = await purgeOldSecret(db, tenantServiceName, client)

    expect(outcome).toBe(PurgeOutcome.PURGED)
    expect(findClients).toHaveBeenCalledWith(tenantServiceName, db)
    expect(purgeCognitoCredential).toHaveBeenCalledWith(
      tenantServiceName,
      'Test Client'
    )
  })

  it.each([['Test Client'], ['test CLIENT']])(
    'does not purge when another stored client is named %s',
    async (otherName) => {
      findClients.mockResolvedValue([
        client,
        { ...otherClient, clientName: otherName }
      ])

      const outcome = await purgeOldSecret(db, tenantServiceName, client)

      expect(outcome).toBe(PurgeOutcome.NAME_SHARED)
      expect(purgeCognitoCredential).not.toHaveBeenCalled()
      expect(mockLogger.error).toHaveBeenCalledWith(
        `Not purging client ${clientId}: another client has the same name`
      )
    }
  )

  it("returns and logs the outcome of CDP's response", async () => {
    purgeCognitoCredential.mockResolvedValue([])

    const outcome = await purgeOldSecret(db, tenantServiceName, client)

    expect(outcome).toBe(PurgeOutcome.NOT_IN_CDP)
    expect(mockLogger.error).toHaveBeenCalledWith(
      `Purging client ${clientId}: not in CDP`
    )
  })

  it('logs an error when CDP also purges other clients with the name', async () => {
    purgeCognitoCredential.mockResolvedValue([
      { clientId: 'other_client_id', clientName: 'Test Client' },
      client
    ])

    const outcome = await purgeOldSecret(db, tenantServiceName, client)

    expect(outcome).toBe(PurgeOutcome.PURGED)
    expect(mockLogger.error).toHaveBeenCalledWith(
      `Purging client ${clientId} also purged 1 other client(s) with the same name`
    )
  })

  it('logs a successful purge', async () => {
    await purgeOldSecret(db, tenantServiceName, client)

    expect(mockLogger.info).toHaveBeenCalledWith(
      `Purged old client secrets for client ${clientId} of ${tenantServiceName}`
    )
  })

  it.each([
    ['reading the stored clients', () => findClients],
    ['the purge request', () => purgeCognitoCredential]
  ])('passes on an error from %s', async (_, mock) => {
    const err = new Error('Failed')
    mock().mockRejectedValue(err)

    await expect(purgeOldSecret(db, tenantServiceName, client)).rejects.toBe(
      err
    )
  })
})
