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
const { PurgeOutcome, purgeCutoff, purgeResult, purgeOldSecret } =
  await import('./client-purge.js')

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

describe('purgeCutoff', () => {
  it("returns the newest secret's creation date", () => {
    expect(purgeCutoff([otherClient, listedClient], client)).toStrictEqual({
      cutoff: newerSecret.createdAt
    })
  })

  it.each([
    [
      'secrets created a millisecond apart',
      { id: 'secret-a', createdAt: '2026-10-16T06:25:07.343000+00:00' },
      { id: 'secret-b', createdAt: '2026-10-16T06:25:07.342000+00:00' }
    ],
    [
      'a date without fractional seconds from a later one',
      { id: 'secret-a', createdAt: '2026-10-16T06:25:07.001+00:00' },
      { id: 'secret-b', createdAt: '2026-10-16T06:25:07+00:00' }
    ],
    [
      // 07:25 at UTC+02:00 is 05:25 UTC, though its text sorts after 07:25 UTC
      'dates in different time zones',
      { id: 'secret-a', createdAt: '2026-10-16T07:25:07.342000+00:00' },
      { id: 'secret-b', createdAt: '2026-10-16T07:25:07.342000+02:00' }
    ]
  ])('tells apart %s, in either order', (_, newer, older) => {
    for (const secrets of [
      [newer, older],
      [older, newer]
    ]) {
      expect(purgeCutoff(withSecrets(secrets), client)).toStrictEqual({
        cutoff: newer.createdAt
      })
    }
  })

  // CDP's examples give milliseconds padded to six decimal places, so
  // anything after the millisecond is ignored
  it.each([
    ['the same time', '2026-10-16T06:25:07.342000+00:00'],
    ['the same millisecond', '2026-10-16T06:25:07.342999+00:00']
  ])('refuses two secrets created at %s', (_, createdAt) => {
    const secrets = [olderSecret, { id: 'secret-2', createdAt }]

    expect(purgeCutoff(withSecrets(secrets), client)).toStrictEqual({
      outcome: PurgeOutcome.SAME_TIME
    })
  })

  it('refuses a client with only one secret', () => {
    expect(purgeCutoff(withSecrets([newerSecret]), client)).toStrictEqual({
      outcome: PurgeOutcome.ONE_SECRET
    })
  })

  it.each([
    ['no secrets field', undefined],
    ['no secrets', []],
    [
      'an unreadable creation date',
      [olderSecret, { id: 'secret-2', createdAt: 'yesterday' }]
    ]
  ])("refuses when the client's secrets have %s", (_, secrets) => {
    expect(purgeCutoff(withSecrets(secrets), client)).toStrictEqual({
      outcome: PurgeOutcome.SECRETS_UNREADABLE
    })
  })

  it.each([['Test Client'], ['test CLIENT']])(
    'refuses when another client is named %s',
    (otherName) => {
      const clients = [listedClient, { ...otherClient, clientName: otherName }]

      expect(purgeCutoff(clients, client)).toStrictEqual({
        outcome: PurgeOutcome.NAME_SHARED
      })
    }
  )

  it("refuses when the stored name doesn't match CDP", () => {
    const clients = [{ ...listedClient, clientName: 'Renamed Client' }]

    expect(purgeCutoff(clients, client)).toStrictEqual({
      outcome: PurgeOutcome.NAME_OUT_OF_DATE
    })
  })

  it('refuses a client that is not in CDP', () => {
    expect(purgeCutoff([otherClient], client)).toStrictEqual({
      outcome: PurgeOutcome.NOT_IN_CDP
    })
  })
})

describe('purgeResult', () => {
  const other = { clientId: 'other_client_id', clientName: 'Test Client' }

  it.each([
    ['this client purged', [client], PurgeOutcome.PURGED, 0],
    ['others purged too', [other, client], PurgeOutcome.PURGED, 1],
    ['the client skipped', [], PurgeOutcome.NOT_IN_CDP, 0],
    ['only another client purged', [other], PurgeOutcome.NAME_REUSED, 1],
    ['no client details', undefined, PurgeOutcome.OUTCOME_UNKNOWN, 0]
  ])(
    'reads a response with %s',
    (_, purgedClients, outcome, otherClientsPurged) => {
      expect(purgeResult(purgedClients, clientId)).toStrictEqual({
        outcome,
        otherClientsPurged
      })
    }
  )
})

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
    expect(mockLogger.error).toHaveBeenCalledWith(
      `Not purging client ${clientId}: only one secret`
    )
  })

  it.each([
    ['fails', () => Promise.reject(new Error('Down'))],
    ["can't be read", () => Promise.resolve(undefined)]
  ])('does not purge when the list %s', async (_, listClients) => {
    allCognitoCredentials.mockImplementation(listClients)

    const outcome = await purgeOldSecret(tenantServiceName, client)

    expect(outcome).toBe(PurgeOutcome.SECRETS_UNREADABLE)
    expect(purgeCognitoCredential).not.toHaveBeenCalled()
  })

  it("returns the outcome of CDP's response", async () => {
    purgeCognitoCredential.mockResolvedValue([])

    const outcome = await purgeOldSecret(tenantServiceName, client)

    expect(outcome).toBe(PurgeOutcome.NOT_IN_CDP)
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
