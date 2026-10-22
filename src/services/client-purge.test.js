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
  allCognitoCredentials: vi.fn(),
  purgeCognitoCredential: vi.fn()
}))

const { allCognitoCredentials, purgeCognitoCredential } =
  await import('#/common/helpers/cognito-client.js')
const { PurgeOutcome } = await import('#/domain/client-secrets.js')
const { purgeOldSecret } = await import('./client-purge.js')

const clientId = 'my_client_id'
const client = { clientId, clientName: 'Test Client' }
const olderSecret = {
  id: 'secret-1792131907342',
  createdAt: '2026-10-16T06:25:07.342000+00:00'
}
const newerSecret = {
  id: 'secret-1792218307342',
  createdAt: '2026-10-17T06:25:07.342000+00:00'
}
const listedClient = { ...client, secrets: [newerSecret, olderSecret] }
const otherClient = {
  clientId: 'other_client_id',
  clientName: 'Other Client',
  secrets: [olderSecret, newerSecret]
}

const withSecrets = (secrets) => [otherClient, { ...listedClient, secrets }]

describe('purgeOldSecret', () => {
  const tenantServiceName = 'waste-movement-external-api'

  beforeEach(() => {
    vi.clearAllMocks()
    allCognitoCredentials.mockResolvedValue([otherClient, listedClient])
    purgeCognitoCredential.mockResolvedValue([client])
  })

  it('purges by name, with the newest secret as the cutoff', async () => {
    const outcome = await purgeOldSecret(tenantServiceName, client)

    expect(outcome).toBe(PurgeOutcome.PURGED)
    expect(allCognitoCredentials).toHaveBeenCalledWith(tenantServiceName)
    expect(purgeCognitoCredential).toHaveBeenCalledWith(
      tenantServiceName,
      'Test Client',
      newerSecret.createdAt
    )
  })

  it('does not purge when the checks refuse', async () => {
    allCognitoCredentials.mockResolvedValue(withSecrets([newerSecret]))

    const outcome = await purgeOldSecret(tenantServiceName, client)

    expect(outcome).toBe(PurgeOutcome.ONE_SECRET)
    expect(purgeCognitoCredential).not.toHaveBeenCalled()
    expect(mockLogger.warn).toHaveBeenCalledWith(
      `Not purging client ${clientId}: only one secret`
    )
    expect(mockLogger.error).not.toHaveBeenCalled()
  })

  it.each([
    ['fails', () => Promise.reject(new Error('Down'))],
    ["can't be read", () => Promise.resolve(undefined)]
  ])('does not purge when the list %s', async (_, listClients) => {
    allCognitoCredentials.mockImplementation(listClients)

    const outcome = await purgeOldSecret(tenantServiceName, client)

    expect(outcome).toBe(PurgeOutcome.LIST_UNREADABLE)
    expect(purgeCognitoCredential).not.toHaveBeenCalled()
  })

  it('logs an error when the checks refuse for an unsafe reason', async () => {
    allCognitoCredentials.mockResolvedValue([
      listedClient,
      { ...otherClient, clientName: 'Test Client' }
    ])

    const outcome = await purgeOldSecret(tenantServiceName, client)

    expect(outcome).toBe(PurgeOutcome.NAME_SHARED)
    expect(mockLogger.error).toHaveBeenCalledWith(
      `Not purging client ${clientId}: another client has the same name`
    )
  })

  it("returns and logs the outcome of CDP's response", async () => {
    purgeCognitoCredential.mockResolvedValue([])

    const outcome = await purgeOldSecret(tenantServiceName, client)

    expect(outcome).toBe(PurgeOutcome.NOT_IN_CDP)
    expect(mockLogger.error).toHaveBeenCalledWith(
      `Purging client ${clientId}: not in CDP`
    )
  })

  it('logs a successful purge', async () => {
    await purgeOldSecret(tenantServiceName, client)

    expect(mockLogger.info).toHaveBeenCalledWith(
      `Purged old client secrets for client ${clientId} of ${tenantServiceName}`
    )
  })

  it('logs an error when CDP also purges other clients with the name', async () => {
    purgeCognitoCredential.mockResolvedValue([
      { clientId: 'other_client_id', clientName: 'Test Client' },
      client
    ])

    const outcome = await purgeOldSecret(tenantServiceName, client)

    expect(outcome).toBe(PurgeOutcome.PURGED)
    expect(mockLogger.error).toHaveBeenCalledWith(
      `Purging client ${clientId} also purged 1 other client(s) with the same name`
    )
  })

  it('passes on an error from the purge request', async () => {
    const err = new Error('Refused')
    purgeCognitoCredential.mockRejectedValue(err)

    await expect(purgeOldSecret(tenantServiceName, client)).rejects.toBe(err)
  })
})
