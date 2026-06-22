import { hiveCore } from './engine.js'
import { createServer, listen } from './hive/create-server.js'
import { loadConfig } from './hive/load-config.js'

const config = loadConfig()
const server = createServer(config)

listen(server, config)
hiveCore.start()

export { server, hiveCore }
