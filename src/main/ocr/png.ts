import { deflateSync } from 'node:zlib'

export interface RawImage {
  width: number
  height: number
  /** pdfjs ImageKind: 1 = 1bpp grayscale, 2 = RGB, 3 = RGBA. */
  kind: number
  data: Uint8Array
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer: Buffer): number {
  let crc = -1
  for (let i = 0; i < buffer.length; i += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff]
  }
  return (crc ^ -1) >>> 0
}

function chunk(type: string, payload: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(payload.length, 0)
  head.write(type, 4, 'latin1')
  const tail = Buffer.alloc(4)
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), payload])), 0)
  return Buffer.concat([head, payload, tail])
}

/**
 * Tesseract reads image files, not raw pixel arrays, so the page samples that
 * pdfjs decodes are wrapped into a plain truecolor PNG here (no dependency,
 * zlib is enough) before being handed over.
 */
export function encodePng(image: RawImage): Buffer {
  const { width, height, kind, data } = image
  const rgb = Buffer.alloc(width * height * 3)

  if (kind === 2 || kind === 3) {
    const stride = kind === 2 ? 3 : 4
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const from = pixel * stride
      if (kind === 2 || data[from + 3] === 255) {
        rgb[pixel * 3] = data[from]
        rgb[pixel * 3 + 1] = data[from + 1]
        rgb[pixel * 3 + 2] = data[from + 2]
      } else {
        // Composite over white: scanned pages use alpha for paper edges.
        const alpha = data[from + 3]
        for (let channel = 0; channel < 3; channel += 1) {
          rgb[pixel * 3 + channel] = Math.round(
            (data[from + channel] * alpha + 255 * (255 - alpha)) / 255
          )
        }
      }
    }
  } else {
    const rowBytes = Math.ceil(width / 8)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const byte = data[y * rowBytes + (x >> 3)]
        const bit = (byte >> (7 - (x & 7))) & 1
        const level = bit === 1 ? 255 : 0
        const at = (y * width + x) * 3
        rgb[at] = level
        rgb[at + 1] = level
        rgb[at + 2] = level
      }
    }
  }

  const raw = Buffer.alloc(height * (width * 3 + 1))
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 3 + 1)] = 0
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}
