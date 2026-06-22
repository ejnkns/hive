import Fastify from 'fastify'
import { logger } from './shared/logger.js'
import { hiveCore } from '../engine.js'
import type { HiveConfig } from './load-config.js'

export function createServer(config: HiveConfig) {
  const server = Fastify({ logger: false })

  server.post('/v1/chat/completions', async (request, reply) => {
    const result = await hiveCore.handleChatCompletion(request.body as Record<string, unknown>)

    if (!result.success) {
      return reply.status(result.statusCode ?? 500).send({ error: result.error })
    }

    reply.header('Content-Type', 'text/event-stream')
    return reply.send(result.stream)
  })

  server.get('/health', async (_request, reply) => {
    reply.send({ status: 'ok' })
  })

  return server
}

export function listen(server: ReturnType<typeof createServer>, config: HiveConfig): void {
  server.listen({ port: config.port, host: config.host }, (err) => {
    if (err) {
      logger.error(`failed to start server: ${err.message}`)
      process.exit(1)
    }
    logger.info(`proxy listening on http://${config.host}:${config.port}`)
  })
}
