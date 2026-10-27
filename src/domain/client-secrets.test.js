import { describe, it, expect } from 'vitest'
import { PurgeOutcome, purgeResult } from './client-secrets.js'

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
