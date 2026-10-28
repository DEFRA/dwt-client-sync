import { describe, it, expect, vi } from 'vitest'

vi.mock('#/common/helpers/user-pool.js', () => ({
  listUserPoolClients: vi.fn()
}))

const { listUserPoolClients } = await import('#/common/helpers/user-pool.js')
const { listClients } = await import('./client-directory.js')

describe('listClients', () => {
  it("returns the service's clients from the user pool", async () => {
    const clients = [{ clientId: 'id-1', clientName: 'Client 1' }]
    listUserPoolClients.mockResolvedValue(clients)

    await expect(
      listClients('waste-movement-external-api')
    ).resolves.toStrictEqual(clients)
    expect(listUserPoolClients).toHaveBeenCalledWith(
      'waste-movement-external-api'
    )
  })

  it('passes on an error listing the clients', async () => {
    const err = new Error('Failed')
    listUserPoolClients.mockRejectedValue(err)

    await expect(listClients('waste-movement-external-api')).rejects.toBe(err)
  })
})
