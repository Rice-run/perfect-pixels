declare module "gifenc" {
  export function GIFEncoder(): {
    writeFrame(
      index: Uint8Array | number[],
      width: number,
      height: number,
      options: {
        palette: number[] | Uint8Array;
        delay?: number;
        repeat?: number;
        transparent?: boolean;
        transparentIndex?: number;
      },
    ): void;
    finish(): void;
    bytes(): Uint8Array;
  };

  export function quantize(
    data: Uint8ClampedArray | Uint8Array,
    maxColors: number,
    options?: { format?: string; oneBitAlpha?: number },
  ): number[] | Uint8Array;

  export function applyPalette(
    data: Uint8ClampedArray | Uint8Array,
    palette: number[] | Uint8Array,
    format?: string,
  ): Uint8Array;
}
