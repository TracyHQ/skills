/**
 * The engine's log goes to stderr, never to stdout.
 *
 * stdout carries exactly two machine-readable things: a progress line per beat and one summary
 * object at the end. Mixing log lines into it would force every caller to guess which line is
 * data. The shape mirrors the desktop app's `loggerService` so the engine's own code did not
 * have to change when it moved out of Electron.
 */
type Fields = Record<string, unknown>

const write = (level: string, message: string, fields?: Fields) => {
  const line = fields ? `${message} ${JSON.stringify(fields)}` : message
  process.stderr.write(`[${level}] ${line}\n`)
}

export const loggerService = {
  withContext: (context: string) => ({
    info: (message: string, fields?: Fields) => write('info', `${context}: ${message}`, fields),
    warn: (message: string, fields?: Fields) => write('warn', `${context}: ${message}`, fields),
    error: (message: string, fields?: Fields) => write('error', `${context}: ${message}`, fields)
  })
}
