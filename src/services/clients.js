export function findClient(userPoolId, clientId, db) {
  return db.collection('clients').findOne({
    'UserPoolClient.UserPoolId': userPoolId,
    'UserPoolClient.ClientId': clientId
  })
}
