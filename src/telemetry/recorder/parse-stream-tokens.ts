import { Transform } from "node:stream"

type StreamStats = {
  outputChars: number
  thinkingChars: number
  thinkingStart: number | null
  finishReason: string | null
  responseText: string
}

export function createStreamCounter(startTime: number) {
  let outputChars = 0
  let thinkingChars = 0
  let thinkingStart: number | null = null
  let finishReason: string | null = null
  let responseText = ""
  let buffer = ""

  const transform = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      const text = chunk.toString("utf-8")
      buffer += text

      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith("data: ")) continue

        const jsonStr = trimmed.slice(6)
        if (jsonStr === "[DONE]") continue

        try {
          const parsed = JSON.parse(jsonStr)
          const delta = parsed.choices?.[0]?.delta
          const finish = parsed.choices?.[0]?.finish_reason

          if (finish) {
            finishReason = finish
          }

          if (delta?.reasoning_content) {
            if (thinkingStart === null) {
              thinkingStart = Date.now() - startTime
            }
            thinkingChars += delta.reasoning_content.length
            responseText += delta.reasoning_content
          }

          if (delta?.content) {
            outputChars += delta.content.length
            responseText += delta.content
          }
        } catch {
          // skip unparseable chunks
        }
      }

      callback(null, chunk)
    },
  })

  const getStats = (): StreamStats => ({
    outputChars,
    thinkingChars,
    thinkingStart,
    finishReason,
    responseText,
  })

  return { transform, getStats }
}
