/** One image a chip stands for. */
export type ImageRef = {
  /** `<message uuid>:<index>` for a sent image, `draft:<n>` for paste `n` in the draft. */
  id: string
  /** What the chip reads: `Image #1`. */
  label: string
}

/** A sent image's bytes, as the transcript row carried them. */
export type ImageData = {
  mediaType: string
  base64: string
}

/**
 * Where the decoder reads an image: a file Claude Code cached for a paste,
 * or bytes the transcript row carried, kept only while no file is known.
 */
export type DecodeSource = { path: string } | ImageData

/** The chip whose card is open: the drawing that holds it and its image. */
export type OpenHint = {
  site: string
  imageId: string
}

declare module 'claude-code' {
  interface PluginState {
    'image-preview': {
      /** The images a transcript message carried, by the message's uuid. */
      messageImages: StateFamily<ImageRef[]>
      /** The `[Image #N]` placeholders in the prompt draft, in order. */
      draftImages: ImageRef[]
      /** Where each sent image is read from, by its id. */
      imageSource: StateFamily<DecodeSource>
      /** One card at a time, under the chip that opened it. */
      hint: OpenHint | null
      /** The image the large pane shows. */
      expanded: ImageRef | null
    }
  }
}
