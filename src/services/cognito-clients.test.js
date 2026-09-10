import { mockClient } from 'aws-sdk-client-mock'
import {
  CognitoIdentityProviderClient,
  DescribeUserPoolClientCommand,
  ListUserPoolClientsCommand,
  ResourceNotFoundException
} from '@aws-sdk/client-cognito-identity-provider'

import { findAllUserPoolClients } from './cognito-clients.js'

const cognitoMock = mockClient(CognitoIdentityProviderClient)

const userPoolId = 'eu-west-2_testPool'

describe('#findAllUserPoolClients', () => {
  beforeEach(() => {
    cognitoMock.reset()
  })

  test('Should return all clients across pages mapped to the response contract', async () => {
    cognitoMock
      .on(ListUserPoolClientsCommand, { UserPoolId: userPoolId })
      .resolvesOnce({
        UserPoolClients: [
          {
            ClientId: 'client-1',
            ClientName: 'Client One',
            UserPoolId: userPoolId
          }
        ],
        NextToken: 'page-2'
      })
      .resolvesOnce({
        UserPoolClients: [
          {
            ClientId: 'client-2',
            ClientName: 'Client Two',
            UserPoolId: userPoolId
          }
        ]
      })
    cognitoMock
      .on(DescribeUserPoolClientCommand, {
        UserPoolId: userPoolId,
        ClientId: 'client-1'
      })
      .resolves({
        UserPoolClient: {
          UserPoolId: userPoolId,
          ClientName: 'Client One',
          ClientId: 'client-1',
          LastModifiedDate: new Date('2026-07-10T08:41:31.618Z'),
          CreationDate: new Date('2026-05-19T08:25:53.785Z'),
          ClientSecret: 'super-secret',
          RefreshTokenValidity: 30
        }
      })
    cognitoMock
      .on(DescribeUserPoolClientCommand, {
        UserPoolId: userPoolId,
        ClientId: 'client-2'
      })
      .resolves({
        UserPoolClient: {
          UserPoolId: userPoolId,
          ClientName: 'Client Two',
          ClientId: 'client-2',
          LastModifiedDate: new Date('2026-08-01T10:00:00.000Z'),
          CreationDate: new Date('2026-06-01T10:00:00.000Z')
        }
      })

    const result = await findAllUserPoolClients(userPoolId)

    expect(result).toEqual([
      {
        UserPoolClient: {
          UserPoolId: userPoolId,
          ClientName: 'Client One',
          ClientId: 'client-1',
          LastModifiedDate: new Date('2026-07-10T08:41:31.618Z'),
          CreationDate: new Date('2026-05-19T08:25:53.785Z')
        }
      },
      {
        UserPoolClient: {
          UserPoolId: userPoolId,
          ClientName: 'Client Two',
          ClientId: 'client-2',
          LastModifiedDate: new Date('2026-08-01T10:00:00.000Z'),
          CreationDate: new Date('2026-06-01T10:00:00.000Z')
        }
      }
    ])
  })

  test('Should return an empty array for a user pool with no clients', async () => {
    cognitoMock.on(ListUserPoolClientsCommand).resolves({ UserPoolClients: [] })

    await expect(findAllUserPoolClients(userPoolId)).resolves.toEqual([])
  })

  test('Should throw when the user pool does not exist', async () => {
    cognitoMock.on(ListUserPoolClientsCommand).rejects(
      new ResourceNotFoundException({
        message: 'User pool does not exist.',
        $metadata: {}
      })
    )

    await expect(findAllUserPoolClients(userPoolId)).rejects.toThrow(
      ResourceNotFoundException
    )
  })
})
