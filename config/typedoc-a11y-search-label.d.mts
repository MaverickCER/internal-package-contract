export function load(app: {
  renderer: { hooks: { on(name: string, callback: () => unknown): void } }
}): void
