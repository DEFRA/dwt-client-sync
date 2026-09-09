import { health } from '#/routes/health.js'
import { clients } from '#/routes/clients.js'

export const router = {
  plugin: {
    name: 'router',
    register: (server, _options) => {
      server.route([health, ...clients])
    }
  }
}
