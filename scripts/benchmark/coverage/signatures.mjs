// What a package's public functions accept, read from its committed API baselines
// (`.repo-contract/api-contract/<entry>/baseline.api.json`), so no build and no TypeScript is needed. A function
// that takes several parameters, or an object with several keys, has several things that can change its cost;
// each one is something a benchmark has to account for.
//
// A baseline is what api-extractor writes, so every package has `members`, every entry point has `members`, and
// every function has `parameters`; and it comes from code that compiled, so a type is never its own base.
// Nothing here guards against a file that is not one.

const WRAPPERS = /^(?:Readonly|Partial|Required)<([\s\S]*)>$/
const GENERIC = /^([A-Za-z_$][\w$]*)<[\s\S]*>$/
const LITERAL = /^\{[\s\S]*\}$/
const MEMBER_KEY = /^\s*(?:readonly\s+)?["']?([\w$-]+)/

/**
 * @param {{ excerptTokens: { text: string }[] }} member
 * @param {{ startIndex: number, endIndex: number }} range
 * @returns {string} the source text of a token range, trimmed.
 */
function textOf(member, range) {
  return member.excerptTokens
    .slice(range.startIndex, range.endIndex)
    .map((token) => token.text)
    .join("")
}

/**
 * @param {string} literal - the text of an object type, braces included.
 * @returns {string[]} its top-level keys, in order. A member that is not a named one (an index or call signature) has none.
 */
export function literalKeys(literal) {
  const body = literal
    .trim()
    .slice(1, -1)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
  const keys = []
  let depth = 0
  let start = 0
  const take = (end) => {
    const key = MEMBER_KEY.exec(body.slice(start, end))
    if (key !== null) keys.push(key[1])
    start = end + 1
  }
  for (const [index, char] of [...body].entries()) {
    if ("{[(<".includes(char)) depth += 1
    else if ("}])".includes(char)) depth -= 1
    else if (char === ">" && body[index - 1] !== "=") depth -= 1
    else if (depth === 0 && ";,\n".includes(char)) take(index)
  }
  take(body.length)
  return keys
}

/**
 * @param {string} type - a parameter's type text.
 * @param {Map<string, object>} declared - the package's interfaces and type aliases, by name.
 * @returns {string[]} the keys of an object type, or none for anything else (a scalar, a union, a function, a type from elsewhere).
 */
export function keysOf(type, declared) {
  const text = type.trim()
  const wrapped = WRAPPERS.exec(text)
  if (wrapped !== null) return keysOf(wrapped[1], declared)
  if (LITERAL.test(text)) return literalKeys(text)
  // A generic type is followed by its own name: its arguments are what it is applied to, not its keys.
  const found = declared.get(GENERIC.exec(text)?.[1] ?? text)
  if (found === undefined) return []
  if (found.kind === "TypeAlias") {
    return keysOf(found.typeText ?? textOf(found, found.typeTokenRange), declared)
  }
  // Stryker disable next-line ArrayDeclaration: equivalent -- a placeholder string has no name, so it adds no key.
  const own = (found.members ?? [])
    .filter((member) => member.name !== undefined)
    .map((member) => member.name)
  // Stryker disable ArrayDeclaration: equivalent -- a placeholder string has no token range, so it reads as an empty type with no keys.
  const bases =
    found.extendsTexts ?? (found.extendsTokenRanges ?? []).map((range) => textOf(found, range))
  // Stryker restore ArrayDeclaration
  const inherited = bases.flatMap((base) => keysOf(base, declared))
  return [...new Set([...inherited, ...own])]
}

/**
 * @param {string} text - source text.
 * @param {number} open - the index of an opening bracket in it.
 * @returns {number} the index of its closing bracket.
 */
function closingOf(text, open) {
  let depth = 0
  for (const [offset, char] of [...text.slice(open)].entries()) {
    if ("([{<".includes(char)) depth += 1
    else if (")]}".includes(char)) depth -= 1
    else if (char === ">" && text[open + offset - 1] !== "=") depth -= 1
    if (depth === 0) return open + offset
  }
  return text.length
}

/**
 * @param {string} list - the text between a function's parentheses.
 * @returns {{ name: string, type: string }[]} its parameters, a rest parameter by its own name.
 */
export function parametersOf(list) {
  const parameters = []
  let depth = 0
  let start = 0
  const take = (end) => {
    const parameter = /^\s*(?:\.\.\.)?([\w$]+)\??\s*:\s*([\s\S]*)/.exec(list.slice(start, end))
    if (parameter !== null) parameters.push({ name: parameter[1], type: parameter[2] })
    start = end + 1
  }
  for (const [index, char] of [...list].entries()) {
    if ("([{<".includes(char)) depth += 1
    else if (")]}".includes(char)) depth -= 1
    else if (char === ">" && list[index - 1] !== "=") depth -= 1
    else if (char === "," && depth === 0) take(index)
  }
  take(list.length)
  return parameters
}

/**
 * @param {string[]} declarations - the text of each entry point's rolled-up `.d.ts`.
 * @returns {Map<string, { name: string, type: string }[]>} the parameters of every function it declares, exported or
 *   not, by the name it is declared under.
 */
function declaredFunctions(declarations) {
  const functions = new Map()
  for (const text of declarations) {
    for (const match of text.matchAll(/^(?:export )?declare function ([\w$]+)\s*(?=[<(])/gm)) {
      const start = match.index + match[0].length
      const open = text[start] === "<" ? text.indexOf("(", closingOf(text, start)) : start
      functions.set(match[1], parametersOf(text.slice(open + 1, closingOf(text, open))))
    }
  }
  return functions
}

/**
 * @param {string[]} declarations - each entry point's rolled-up `.d.ts`.
 * @returns {Map<string, object>} every interface and type alias it declares, exported or not (a function's options
 *   type often is not), in the shape {@link keysOf} reads.
 */
function declaredTypes(declarations) {
  const types = new Map()
  for (const text of declarations) {
    for (const match of text.matchAll(
      /^(?:export )?declare (interface|type) ([\w$]+)\s*(?=[<={]|extends\b)/gm,
    )) {
      const [, kind, name] = match
      let at = match.index + match[0].length
      if (text[at] === "<") at = closingOf(text, at) + 1
      if (kind === "type") {
        const end = text.indexOf(";\n", at)
        types.set(name, {
          kind: "TypeAlias",
          name,
          typeText: text.slice(text.indexOf("=", at) + 1, end),
        })
        continue
      }
      const open = text.indexOf("{", at)
      const head = text.slice(at, open).trim()
      // Stryker disable next-line StringLiteral,ArrayDeclaration: equivalent -- with no `extends` the text is empty, and a placeholder base names no declared type.
      const bases = head.startsWith("extends") ? head.slice("extends".length).split(",") : []
      const keys = literalKeys(text.slice(open, closingOf(text, open) + 1))
      types.set(name, {
        name,
        members: keys.map((key) => ({ name: key })),
        extendsTexts: bases,
      })
    }
  }
  return types
}

/**
 * @param {object[]} packages - parsed `baseline.api.json` files, one per entry point.
 * @param {string[]} [declarations] - each entry point's rolled-up `.d.ts` (`baseline.d.ts`), which also declares the
 *   functions a public object holds (`export const validators: { range: typeof range }`) that the model leaves out.
 * @returns {Map<string, { paths: string[], multiInput: boolean }>} every public function by name (a function held by
 *   a public object is `object.member`): the things that have to be accounted for (a parameter, or each key of an
 *   object parameter that has several), and whether there is more than one of them. Overloads are merged.
 */
// Stryker disable next-line ArrayDeclaration: equivalent -- a placeholder string declares no function and no type.
export function signaturesOf(packages, declarations = []) {
  const members = packages.flatMap((pkg) => pkg.members.flatMap((entry) => entry.members))
  const declared = new Map([
    ...declaredTypes(declarations),
    ...members
      .filter((member) => ["Interface", "TypeAlias"].includes(member.kind))
      .map((member) => [member.name, member]),
  ])
  const signatures = new Map()
  /** Every thing to account for in a function's parameters: each parameter, or each key of an object that has several. */
  const pathsOf = (parameters) => [
    ...new Set(
      parameters.flatMap((parameter) => {
        const keys = keysOf(parameter.type, declared)
        return keys.length > 1 ? keys.map((key) => `${parameter.name}.${key}`) : [parameter.name]
      }),
    ),
  ]
  const isPublic = (member) => ["Public", "Beta"].includes(member.releaseTag)
  for (const member of members) {
    if (member.kind !== "Function" || !isPublic(member)) continue
    const overload = pathsOf(
      member.parameters.map((parameter) => ({
        name: parameter.parameterName,
        type: textOf(member, parameter.parameterTypeTokenRange),
      })),
    )
    const paths = [...new Set([...(signatures.get(member.name)?.paths ?? []), ...overload])]
    signatures.set(member.name, { paths, multiInput: paths.length > 1 })
  }
  const functions = declaredFunctions(declarations)
  for (const member of members) {
    if (member.kind !== "Variable" || !isPublic(member)) continue
    const type = textOf(member, member.variableTypeTokenRange)
    for (const [, key, name] of type.matchAll(/([\w$]+):\s*typeof\s+([\w$]+)/g)) {
      const parameters = functions.get(name)
      if (parameters === undefined) continue
      const paths = pathsOf(parameters)
      signatures.set(`${member.name}.${key}`, { paths, multiInput: paths.length > 1 })
    }
  }
  return signatures
}
