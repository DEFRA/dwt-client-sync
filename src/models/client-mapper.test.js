import {
  toClientRecord,
  toClientResponse,
  toClientCredentialsResponse
} from './client-mapper.js'

const tenantServiceName = 'waste-movement-external-api'
const cognitoClient = {
  clientId: 'client-1',
  clientName: 'Client One',
  clientSecret: 'secret'
}

describe('#toClientRecord', () => {
  it('stores the client against its service, without the secret', () => {
    expect(toClientRecord(cognitoClient, tenantServiceName)).toStrictEqual({
      clientId: 'client-1',
      clientName: 'Client One',
      tenantServiceName
    })
  })
})

describe('#toClientResponse', () => {
  it('returns only the published fields of a stored client', () => {
    const record = {
      clientId: 'client-1',
      clientName: 'Client One',
      tenantServiceName,
      lastSynced: '2026-10-15T12:00:00Z'
    }

    expect(toClientResponse(record)).toStrictEqual({
      clientId: 'client-1',
      clientName: 'Client One',
      tenantServiceName
    })
  })
})

describe('#toClientCredentialsResponse', () => {
  it('returns the client with its secret, and nothing else', () => {
    expect(
      toClientCredentialsResponse({ ...cognitoClient, createdAt: 'today' })
    ).toStrictEqual({
      clientId: 'client-1',
      clientName: 'Client One',
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
      tenantServiceName
    })
  })
})
