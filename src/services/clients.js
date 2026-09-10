export function findClient(userPoolId, clientId, db) {
  return db.collection('clients').findOne({
    'UserPoolClient.UserPoolId': userPoolId,
    'UserPoolClient.ClientId': clientId
  })
}

export function findClients(userPoolId, db) {
  return db
    .collection('clients')
    .find(
      { 'UserPoolClient.UserPoolId': userPoolId },
      { projection: { _id: 0 } }
    )
    .toArray()
}
