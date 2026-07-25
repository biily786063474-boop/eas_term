/**
 * DesignComposer — Konva image filters
 * Each filter operates on raw imageData pixels.
 * Used as Konva node filters via node.cache() + node.filters([...])
 */

export function HalftoneFilter(imageData) {
  const d = imageData.data, w = imageData.width, dotSize = this.getAttr('halftoneSize') || 6
  for (let y = 0; y < imageData.height; y += dotSize) {
    for (let x = 0; x < w; x += dotSize) {
      let sum = 0, count = 0
      for (let dy = 0; dy < dotSize && y + dy < imageData.height; dy++) {
        for (let dx = 0; dx < dotSize && x + dx < w; dx++) {
          const i = ((y + dy) * w + x + dx) * 4
          sum += (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114)
          count++
        }
      }
      const avg = sum / count
      const radius = (avg / 255) * dotSize * 0.5
      for (let dy = 0; dy < dotSize && y + dy < imageData.height; dy++) {
        for (let dx = 0; dx < dotSize && x + dx < w; dx++) {
          const i = ((y + dy) * w + x + dx) * 4
          const cx = dotSize / 2, cy = dotSize / 2
          const dist = Math.sqrt((dx - cx) ** 2 + (dy - cy) ** 2)
          if (dist > radius) { d[i] = 255; d[i + 1] = 255; d[i + 2] = 255 }
        }
      }
    }
  }
}

export function PosterizeFilter(imageData) {
  const d = imageData.data, levels = this.getAttr('posterizeLevels') || 4
  const step = 255 / (levels - 1)
  for (let i = 0; i < d.length; i += 4) {
    d[i]     = Math.round(d[i] / step) * step
    d[i + 1] = Math.round(d[i + 1] / step) * step
    d[i + 2] = Math.round(d[i + 2] / step) * step
  }
}

export function ThresholdFilter(imageData) {
  const d = imageData.data, t = (this.getAttr('thresholdVal') || 128)
  for (let i = 0; i < d.length; i += 4) {
    const v = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) >= t ? 255 : 0
    d[i] = d[i + 1] = d[i + 2] = v
  }
}

export function EmbossFilter(imageData) {
  const d = imageData.data, w = imageData.width, h = imageData.height
  const src = new Uint8ClampedArray(d)
  const s = this.getAttr('embossStrength') || 2
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4
      const tl = ((y - 1) * w + x - 1) * 4
      const br = ((y + 1) * w + x + 1) * 4
      d[i]     = Math.min(255, Math.max(0, 128 + (src[br] - src[tl]) * s))
      d[i + 1] = Math.min(255, Math.max(0, 128 + (src[br + 1] - src[tl + 1]) * s))
      d[i + 2] = Math.min(255, Math.max(0, 128 + (src[br + 2] - src[tl + 2]) * s))
    }
  }
}

export function DuotoneFilter(imageData) {
  const d = imageData.data
  const dark = this.getAttr('duotoneDark') || [30, 0, 80]
  const light = this.getAttr('duotoneLight') || [255, 200, 50]
  for (let i = 0; i < d.length; i += 4) {
    const gray = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255
    d[i]     = dark[0] + (light[0] - dark[0]) * gray
    d[i + 1] = dark[1] + (light[1] - dark[1]) * gray
    d[i + 2] = dark[2] + (light[2] - dark[2]) * gray
  }
}

export function SolarizeFilter(imageData) {
  const d = imageData.data
  for (let i = 0; i < d.length; i += 4) {
    d[i]     = d[i] > 128 ? 255 - d[i] : d[i]
    d[i + 1] = d[i + 1] > 128 ? 255 - d[i + 1] : d[i + 1]
    d[i + 2] = d[i + 2] > 128 ? 255 - d[i + 2] : d[i + 2]
  }
}
