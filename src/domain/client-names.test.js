import { describe, it, expect } from 'vitest'
import { isNameTaken, sharesExactName } from './client-names.js'

const clients = [
  { clientId: 'id-1', clientName: 'Acme_Waste' },
  { clientId: 'id-2', clientName: 'Beta_Tracking' }
]

describe('isNameTaken', () => {
  it.each([['Acme_Waste'], ['acme_WASTE']])(
    'finds %s, ignoring case',
    (name) => {
      expect(isNameTaken(clients, name)).toBe(true)
    }
  )

  it('does not find a new name', () => {
    expect(isNameTaken(clients, 'Gamma Logistics')).toBe(false)
  })

  it('ignores a client with no name', () => {
    expect(isNameTaken([{ clientId: 'id-3' }], 'Gamma Logistics')).toBe(false)
  })
})

describe('sharesExactName', () => {
  it('ignores the client itself', () => {
    expect(sharesExactName(clients, clients[0])).toBe(false)
  })

  it('finds another client with exactly the same name', () => {
    const withOther = [
      ...clients,
      { clientId: 'id-3', clientName: clients[0].clientName }
    ]

    expect(sharesExactName(withOther, clients[0])).toBe(true)
  })

  it('ignores a name that differs only in case, as CDP matches names exactly', () => {
    const withOther = [
      ...clients,
      { clientId: 'id-3', clientName: clients[0].clientName.toUpperCase() }
    ]

    expect(sharesExactName(withOther, clients[0])).toBe(false)
  })
})
