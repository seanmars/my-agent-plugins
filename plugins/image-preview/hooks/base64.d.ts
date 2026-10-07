// The hooks environment has the TC39 base64 methods (the engine's own examples
// use them); lib es2023 does not type them yet.
interface Uint8ArrayConstructor {
  fromBase64(base64: string): Uint8Array<ArrayBuffer>
}

interface Uint8Array<TArrayBuffer extends ArrayBufferLike = ArrayBufferLike> {
  toBase64(): string
}
