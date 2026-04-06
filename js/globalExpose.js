// Global exposure helper for browser runtime hooks/debug helpers.

export function exposeGlobals(globals) {
  Object.assign(window, globals);
}

