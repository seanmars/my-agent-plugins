/** Where Claude Code wrote `[Image #N]` for a pasted image. */
export type Placeholder = { number: number; start: number; end: number }

const PLACEHOLDER = /\[Image #(\d+)\]/g

/** Every `[Image #N]` in the text, in order, repeats included. */
export function placeholders(text: string): Placeholder[] {
  return [...text.matchAll(PLACEHOLDER)].map((match) => ({
    number: Number(match[1]),
    start: match.index,
    end: match.index + match[0].length,
  }))
}

/** The image numbers the text names, each once, in order. */
export function imageNumbers(text: string): number[] {
  return [...new Set(placeholders(text).map((found) => found.number))]
}
