const prefix = '[hive]'

export const logger = {
  info: (msg: string) => console.log(`${prefix} ${msg}`),
  warn: (msg: string) => console.warn(`${prefix} WARN ${msg}`),
  error: (msg: string) => console.error(`${prefix} ERROR ${msg}`),
  debug: (msg: string) => {
    if (process.env.DEBUG) console.log(`${prefix} DEBUG ${msg}`)
  },
}
