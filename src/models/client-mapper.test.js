import {
  toClientRecord,
  toClientResponse,
  toClientCredentialsResponse
} from './client-mapper.js'

const tenantServiceName = 'waste-movement-external-api'
const cognitoClient = {
  clientId: 'client-1',
  clientName: 'Client_One',
  clientSecret: 'secret',
  secrets: [
    {
      id: 'client1secret1',
      createdAt: '2026-01-01T01:01:01.100000+00:00'
    }
  ]
}

describe('#toClientRecord', () => {
  it('stores the client against its service, without the secret', () => {
    expect(toClientRecord(cognitoClient, tenantServiceName)).toStrictEqual({
      clientId: 'client-1',
      clientName: 'Client_One',
      tenantServiceName,
      secrets: [
        {
          id: 'client1secret1',
          createdAt: '2026-01-01T01:01:01.100000+00:00'
        }
      ]
    })
  })

  it('does not define secrets when they are null', () => {
    expect(
      toClientRecord({ ...cognitoClient, secrets: null }, tenantServiceName)
    ).toStrictEqual({
      clientId: 'client-1',
      clientName: 'Client_One',
      tenantServiceName
    })
  })

  it('does not define secrets when they are undefined', () => {
    expect(
      toClientRecord(
        { ...cognitoClient, secrets: undefined },
        tenantServiceName
      )
    ).toStrictEqual({
      clientId: 'client-1',
      clientName: 'Client_One',
      tenantServiceName
    })
  })

  it('defines an empty secrets array when secrets are an empty array', () => {
    expect(
      toClientRecord({ ...cognitoClient, secrets: [] }, tenantServiceName)
    ).toStrictEqual({
      clientId: 'client-1',
      clientName: 'Client_One',
      tenantServiceName,
      secrets: []
    })
  })
})

describe('#toClientResponse', () => {
  it('returns only the published fields of a stored client', () => {
    const record = {
      clientId: 'client-1',
      clientName: 'Client_One',
      tenantServiceName,
      lastSynced: '2026-10-15T12:00:00Z',
      secrets: [
        {
          id: 'client1secret1',
          createdAt: '2026-01-01T01:01:01.100000+00:00'
        }
      ]
    }

    expect(toClientResponse(record)).toStrictEqual({
      clientId: 'client-1',
      clientName: 'Client_One',
      tenantServiceName,
      secrets: [
        {
          id: 'client1secret1',
          createdAt: '2026-01-01T01:01:01.100000+00:00'
        }
      ]
    })
  })
})

describe('#toClientCredentialsResponse', () => {
  it('returns the client with its secret, and nothing else', () => {
    expect(
      toClientCredentialsResponse({ ...cognitoClient, createdAt: 'today' })
    ).toStrictEqual({
      clientId: 'client-1',
      clientName: 'Client_One',
      clientSecret: 'secret'
    })
  })
})

describe('client round trip', () => {
  it('returns a synced client as it came from Cognito, with its service', () => {
    const response = toClientResponse(
      toClientRecord(cognitoClient, tenantServiceName)
    )

    expect(response).toStrictEqual({
      clientId: cognitoClient.clientId,
      clientName: cognitoClient.clientName,
      tenantServiceName,
      secrets: cognitoClient.secrets
    })
  })
})
