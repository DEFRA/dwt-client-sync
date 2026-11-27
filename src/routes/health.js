export const health = {
  method: 'GET',
  path: '/health',
  // Health checks don't send credentials
  options: { auth: false },
  handler: (_request, h) => h.response({ message: 'success' })
}
