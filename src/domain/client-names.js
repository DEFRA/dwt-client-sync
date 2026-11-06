/**
 * Client names must be unique ignoring case, so two providers can't end up
 * with names that differ only in case.
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

export { isNameTaken }
