// What a published benchmark page shows of a failure's message: its first line, with every absolute path cut to
// its file name. A stack trace and the paths of the machine that ran the benchmark stay in results.json.

/**
 * Where a path inside a message can start: after whitespace, a quote, a parenthesis or `=` (`path=/tmp/x.json`),
 * or after a `:` that follows a word of two or more characters and comes directly before a single `/`
 * (`key:/tmp/x.json`) -- never inside a URL (`https://`) or after a drive letter (`D:/`).
 */
const DELIMITER = /([\s'"`()=]|(?<=[^\s'"`()=]{2}):(?=\/(?!\/)))/

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
