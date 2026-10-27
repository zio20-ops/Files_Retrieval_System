import { OPS, type PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { encodePng, type RawImage } from './png'

const MIN_EDGE = 80

interface PdfImageObject {
  width: number
  height: number
  kind: number
  data?: Uint8Array | Uint8ClampedArray
}

function toRawImage(object: PdfImageObject): RawImage | null {
  if (!object.data || object.width < MIN_EDGE || object.height < MIN_EDGE) return null
  return {
    width: object.width,
    height: object.height,
    kind: object.kind,
    data: object.data instanceof Uint8Array ? object.data : new Uint8Array(object.data)
  }
}

/**
 * Pulls the raster pictures a scanned page is made of. Reading the operator
 * list (instead of rendering the page) keeps this dependency-free: pdfjs has
 * already decoded the embedded JPEG/PNG streams into raw samples for us.
 */
export async function extractPageImages(page: PDFPageProxy): Promise<Buffer[]> {
  const operatorList = await page.getOperatorList()
  const images: Buffer[] = []
  const seen = new Set<string>()

  for (let i = 0; i < operatorList.fnArray.length; i += 1) {
    const fn = operatorList.fnArray[i]
    let object: PdfImageObject | null = null

    if (fn === OPS.paintInlineImageXObject) {
      object = operatorList.argsArray[i][0] as PdfImageObject
    } else if (fn === OPS.paintImageXObject) {
      const name = operatorList.argsArray[i][0] as string
      if (seen.has(name)) continue
      seen.add(name)
      object = await new Promise<PdfImageObject>((resolve) => {
        page.objs.get(name, (value: unknown) => resolve(value as PdfImageObject))
      })
    } else {
      continue
    }

    const raw = object ? toRawImage(object) : null
    if (raw) images.push(encodePng(raw))
  }
  return images
}
