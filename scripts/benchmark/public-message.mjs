// What a published benchmark page shows of a failure's message: its first line, with every absolute path cut to
// its file name. A stack trace and the paths of the machine that ran the benchmark stay in results.json.

/** Characters that delimit a path inside a message: whitespace, quotes and parentheses. */
const DELIMITER = /([\s'"`()])/

/**
 * @param {string} token - one word of a message.
 * @returns {string} the token, or `…/<file name>` when it is an absolute path with at least one folder.
 */
function redact(token) {
  const absolute = token.startsWith("/") || /^[A-Za-z]:[\\/]/.test(token)
  const segments = token.split(/[\\/]/)
  return absolute && segments.length > 2 ? `…/${segments[segments.length - 1]}` : token
}

/**
 * @param {string} message - an error message, possibly with a stack trace.
 * @returns {string} its first line, with absolute paths reduced to their file name.
 */
export function publicMessage(message) {
  return message.split("\n")[0].split(DELIMITER).map(redact).join("")
}
