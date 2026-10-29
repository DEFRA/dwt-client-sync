import { describe, it, expect } from 'vitest'
import { PurgeOutcome, purgeResult, removeOldestSecret } from './client-secrets.js'

const clientId = 'my_client_id'
const client = { clientId, clientName: 'Test Client' }

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

describe('removeOldestSecret', () => {
  it('drops the secret with the oldest createdAt', () => {
    expect(removeOldestSecret([
      { id: 'a', createdAt: '2026-01-16T06:25:07.342000+00:00' },
      { id: 'b', createdAt: '2026-02-16T06:25:07.342000+00:00' },
    ])).toStrictEqual([
      { id: 'b', createdAt: '2026-02-16T06:25:07.342000+00:00' },
    ])
  })

  it('keeps the only secret', () => {
    expect(removeOldestSecret([
      { id: 'a', createdAt: '2026-01-16T06:25:07.342000+00:00' },
    ])).toStrictEqual([
      { id: 'a', createdAt: '2026-01-16T06:25:07.342000+00:00' },
    ])
  })

  it('returns secrets unchanged when the array is empty', () => {
    expect(removeOldestSecret([])).toStrictEqual([])
  })

  it('returns secrets unchanged when they are not an array', () => {
    expect(removeOldestSecret(undefined)).toBeUndefined()
  })

  it.each([
    ['only a date', '2026-02-16'],
    ['no time', '2026-02-16T06:25:07'],
    ['3 digit fraction', '2026-02-16T06:25:07.342'],
    ['7 digit fraction', '2026-02-16T06:25:07.3420000'],
    ['Z suffix', '2026-02-16T06:25:07.342000Z'],
    ['offset without colon', '2026-02-16T06:25:07.342000+0000'],
    ['no timezone', '2026-02-16T06:25:07.342000'],
    ['garbage', 'not-a-date'],
  ])('fails when a secret has a %s createdAt', (_, createdAt) => {
    expect(() => {
      removeOldestSecret([
        { id: 'a', createdAt: '2026-01-16T06:25:07.342000+00:00' },
        { id: 'b', createdAt },
      ])
    }).toThrow(`a secret with a bad createdAt date was provided: '${createdAt}'`)
  })
})
