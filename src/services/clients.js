export function findClient(userPoolId, clientId, db) {
  return db
    .collection('clients')
    .findOne({ UserPoolId: userPoolId, ClientId: clientId })
}
