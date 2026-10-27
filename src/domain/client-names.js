/**
 * Client names must be unique ignoring case, so two providers can't end up
 * with names that differ only in case. CDP's own create only rejects an
 * exact match, and its docs don't say how its other actions compare names.
 */

/**
 * @param {string | undefined} a
 * @param {string | undefined} b
 * @returns {boolean} Whether the names match, ignoring case
 */
function sameName(a, b) {
  return (
    typeof a === 'string' &&
    typeof b === 'string' &&
    a.toLowerCase() === b.toLowerCase()
  )
}

/**
 * @param {{ clientName: string }[]} clients
 * @param {string} name
 * @returns {boolean} Whether any of the clients has the name, ignoring case
 */
function isNameTaken(clients, name) {
  return clients.some((client) => sameName(client.clientName, name))
}

/**
 * @param {{ clientId: string, clientName: string }[]} clients
 * @param {{ clientId: string, clientName: string }} client
 * @returns {boolean} Whether another of the clients has this client's name,
 * ignoring case
 */
function sharesName(clients, { clientId, clientName }) {
  return clients.some(
    (other) =>
      other.clientId !== clientId && sameName(other.clientName, clientName)
  )
}

export { isNameTaken, sharesName }
