/** Convert a whole-bit capacity to the bytes required to contain it. */
export const bitsToBytes = (bits: number) => Math.ceil(bits / 8);
