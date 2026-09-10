import {
  CognitoIdentityProviderClient,
  DescribeUserPoolClientCommand,
  paginateListUserPoolClients
} from '@aws-sdk/client-cognito-identity-provider'

const cognitoClient = new CognitoIdentityProviderClient()

async function describeUserPoolClient(userPoolId, clientId) {
  const { UserPoolClient } = await cognitoClient.send(
    new DescribeUserPoolClientCommand({
      UserPoolId: userPoolId,
      ClientId: clientId
    })
  )

  return {
    UserPoolClient: {
      UserPoolId: UserPoolClient.UserPoolId,
      ClientName: UserPoolClient.ClientName,
      ClientId: UserPoolClient.ClientId,
      LastModifiedDate: UserPoolClient.LastModifiedDate,
      CreationDate: UserPoolClient.CreationDate
    }
  }
}

export async function findAllUserPoolClients(userPoolId) {
  const clientIds = []

  const pages = paginateListUserPoolClients(
    { client: cognitoClient },
    { UserPoolId: userPoolId }
  )

  for await (const page of pages) {
    for (const { ClientId } of page.UserPoolClients ?? []) {
      clientIds.push(ClientId)
    }
  }

  // ListUserPoolClients only returns ClientId/ClientName, so each client is
  // described individually to get LastModifiedDate/CreationDate
  return Promise.all(
    clientIds.map((clientId) => describeUserPoolClient(userPoolId, clientId))
  )
}
