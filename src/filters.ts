// ---------------------------------------------------------------------------
// Bộ lọc (filter) kiểu Hypic / Instagram.
// Mỗi preset là một chuỗi CSS filter -> dùng CHUNG cho cả preview lẫn export,
// nên "nhìn thấy sao thì tải về y vậy" (WYSIWYG).
// ---------------------------------------------------------------------------

import { applyLUT, getLUT } from './lut'

export interface Preset {
  id: string
  name: string
  filter: string
}

export const PRESETS: Preset[] = [
  { id: 'original', name: 'Gốc', filter: 'none' },
  { id: 'clarendon', name: 'Clarendon', filter: 'contrast(1.2) saturate(1.35) brightness(1.05)' },
  { id: 'juno', name: 'Juno', filter: 'saturate(1.4) contrast(1.05) sepia(0.12) hue-rotate(-8deg)' },
  { id: 'ludwig', name: 'Ludwig', filter: 'sepia(0.22) contrast(1.05) brightness(1.05) saturate(1.2)' },
  { id: 'gingham', name: 'Gingham', filter: 'brightness(1.05) contrast(0.9) sepia(0.1) hue-rotate(-8deg)' },
  { id: 'lark', name: 'Lark', filter: 'contrast(0.9) brightness(1.1) saturate(1.15)' },
  { id: 'reyes', name: 'Reyes', filter: 'sepia(0.4) brightness(1.1) contrast(0.85) saturate(0.75)' },
  { id: 'aden', name: 'Aden', filter: 'hue-rotate(-18deg) contrast(0.9) saturate(0.85) brightness(1.15)' },
  { id: 'fade', name: 'Fade', filter: 'contrast(0.82) brightness(1.12) saturate(0.88)' },
  { id: 'warm', name: 'Ấm', filter: 'sepia(0.32) saturate(1.35) contrast(1.05) brightness(1.04)' },
  { id: 'cool', name: 'Lạnh', filter: 'hue-rotate(16deg) saturate(1.2) brightness(1.05) contrast(1.02)' },
  { id: 'moon', name: 'Đen trắng', filter: 'grayscale(1) contrast(1.15) brightness(1.08)' },
  { id: 'noir', name: 'Noir', filter: 'grayscale(1) contrast(1.4) brightness(0.95)' },
]

export interface Adjustments {
  brightness: number // 0..200 (100 = gốc)
  contrast: number   // 0..200
  saturation: number // 0..200
  warmth: number     // -100..100
  blur: number       // 0..10 (px)
}

export const DEFAULT_ADJ: Adjustments = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  warmth: 0,
  blur: 0,
}

// Ghép filter của preset + tinh chỉnh của người dùng.
// CSS filter compose theo thứ tự -> các hàm cùng loại sẽ nhân với nhau.
export function buildFilter(preset: Preset, adj: Adjustments): string {
  const parts: string[] = []
  if (preset.filter && preset.filter !== 'none') parts.push(preset.filter)

  parts.push(`brightness(${adj.brightness / 100})`)
  parts.push(`contrast(${adj.contrast / 100})`)
  parts.push(`saturate(${adj.saturation / 100})`)

  if (adj.warmth > 0) {
    parts.push(`sepia(${(adj.warmth / 100) * 0.5})`)
  } else if (adj.warmth < 0) {
    parts.push(`hue-rotate(${(adj.warmth / 100) * 35}deg)`)
    parts.push(`saturate(${1 + Math.abs(adj.warmth) / 400})`)
  }

  if (adj.blur > 0) parts.push(`blur(${adj.blur}px)`)

  return parts.join(' ') || 'none'
}

export interface Transform {
  rotation: number // 0, 90, 180, 270
  flipH: boolean
  flipV: boolean
}

export const DEFAULT_TRANSFORM: Transform = { rotation: 0, flipH: false, flipV: false }

// ---------------------------------------------------------------------------
// Chỉnh sáng cục bộ (local adjustment) bằng cọ tô.
// Mỗi nét cọ (Stroke) lưu theo toạ độ CHUẨN HOÁ 0..1 của ảnh GỐC (chưa xoay),
// nên áp dụng được cho mọi độ phân giải (preview & export) và mọi góc xoay.
// ---------------------------------------------------------------------------

export interface Stroke {
  u: number // tâm X, 0..1 theo chiều rộng ảnh gốc
  v: number // tâm Y, 0..1 theo chiều cao ảnh gốc
  r: number // bán kính, chuẩn hoá theo cạnh dài của ảnh
}

export interface Local {
  amount: number // -100..100: độ sáng cộng thêm trong vùng tô
  strokes: Stroke[]
}

export const NO_LOCAL: Local = { amount: 0, strokes: [] }

// Đường cong nâng vùng tối (shadow lift) bằng gamma. amount: -100..100.
// gamma < 1 -> kéo vùng tối sáng lên mạnh, vùng sáng gần như giữ nguyên.
// Trả về LUT 256 phần tử để tra nhanh.
function buildLiftLUT(amount: number): Uint8ClampedArray {
  const gamma = amount >= 0 ? 1 / (1 + amount / 60) : 1 + -amount / 60
  const gain = amount >= 0 ? 1 + amount / 500 : 1
  const lut = new Uint8ClampedArray(256)
  for (let i = 0; i < 256; i++) {
    const n = i / 255
    lut[i] = Math.pow(n, gamma) * gain * 255
  }
  return lut
}

// "Grade" = phần chỉnh màu toàn ảnh: CSS filter (preset + tinh chỉnh) + LUT 3D.
export interface Grade {
  filter: string
  lutId: string
  lutIntensity: number // 0..1
}

const gradeKey = (g: Grade) => `${g.filter}|${g.lutId}|${g.lutIntensity}`

// Lớp "graded" (đã áp filter + LUT) trong không gian ảnh gốc — cache để tái dùng.
let gradeCache: { key: string; canvas: HTMLCanvasElement } | null = null

function getGradedLayer(img: HTMLImageElement, grade: Grade, w: number, h: number): HTMLCanvasElement {
  const key = `${img.src}|${gradeKey(grade)}|${w}x${h}`
  if (gradeCache && gradeCache.key === key) return gradeCache.canvas

  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.filter = grade.filter && grade.filter !== 'none' ? grade.filter : 'none'
  ctx.drawImage(img, 0, 0, w, h)

  const lut = getLUT(grade.lutId)
  if (lut && grade.lutIntensity > 0) {
    const data = ctx.getImageData(0, 0, w, h)
    applyLUT(data.data, lut, grade.lutIntensity)
    ctx.putImageData(data, 0, 0)
  }

  gradeCache = { key, canvas: c }
  return c
}

// Đường cong nâng vùng tối áp lên lớp đã graded.
let liftCache: { key: string; canvas: HTMLCanvasElement } | null = null

function getLiftedLayer(graded: HTMLCanvasElement, gKey: string, amount: number): HTMLCanvasElement {
  const w = graded.width
  const h = graded.height
  const key = `${gKey}|${amount}|${w}x${h}`
  if (liftCache && liftCache.key === key) return liftCache.canvas

  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(graded, 0, 0)

  const lut = buildLiftLUT(amount)
  const data = ctx.getImageData(0, 0, w, h)
  const px = data.data
  for (let i = 0; i < px.length; i += 4) {
    px[i] = lut[px[i]]
    px[i + 1] = lut[px[i + 1]]
    px[i + 2] = lut[px[i + 2]]
  }
  ctx.putImageData(data, 0, 0)

  liftCache = { key, canvas: c }
  return c
}

// Dựng ảnh đã chỉnh trong "không gian ảnh gốc" (chưa xoay), đã nướng sẵn cả
// grade (filter + LUT) lẫn vùng tô sáng cục bộ. Trả về canvas kích thước w×h.
function renderImageSpace(
  img: HTMLImageElement,
  grade: Grade,
  local: Local,
  maxSize: number,
): HTMLCanvasElement {
  const longest = Math.max(img.naturalWidth, img.naturalHeight)
  const scale = longest > maxSize ? maxSize / longest : 1
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))

  const graded = getGradedLayer(img, grade, w, h)
  const base = document.createElement('canvas')
  base.width = w
  base.height = h
  const bctx = base.getContext('2d')!
  bctx.drawImage(graded, 0, 0)

  if (local.amount !== 0 && local.strokes.length > 0) {
    // Lớp ảnh đã nâng vùng tối (gamma lift) — dựng từ lớp graded, có cache
    const bright = document.createElement('canvas')
    bright.width = w
    bright.height = h
    const brctx = bright.getContext('2d')!
    brctx.drawImage(getLiftedLayer(graded, `${img.src}|${gradeKey(grade)}|${w}x${h}`, local.amount), 0, 0)

    // Mặt nạ vùng tô (trắng = áp dụng, viền mềm)
    const mask = document.createElement('canvas')
    mask.width = w
    mask.height = h
    const mctx = mask.getContext('2d')!
    const longestPx = Math.max(w, h)
    for (const s of local.strokes) {
      const cx = s.u * w
      const cy = s.v * h
      const rad = Math.max(1, s.r * longestPx)
      const g = mctx.createRadialGradient(cx, cy, rad * 0.35, cx, cy, rad)
      g.addColorStop(0, 'rgba(255,255,255,1)')
      g.addColorStop(1, 'rgba(255,255,255,0)')
      mctx.fillStyle = g
      mctx.beginPath()
      mctx.arc(cx, cy, rad, 0, Math.PI * 2)
      mctx.fill()
    }

    // Chỉ giữ lớp sáng ở nơi có mặt nạ, rồi chồng lên ảnh nền
    brctx.globalCompositeOperation = 'destination-in'
    brctx.drawImage(mask, 0, 0)
    bctx.drawImage(bright, 0, 0)
  }

  return base
}

// Vẽ ảnh lên canvas với filter + vùng sáng cục bộ + xoay/lật.
// Dùng cho cả preview (maxSize nhỏ) lẫn export (maxSize = ảnh gốc).
export function drawToCanvas(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  grade: Grade,
  transform: Transform,
  local: Local = NO_LOCAL,
  maxSize = Infinity,
): void {
  const src = renderImageSpace(img, grade, local, maxSize)
  const w = src.width
  const h = src.height

  const { rotation, flipH, flipV } = transform
  const swap = rotation === 90 || rotation === 270
  canvas.width = swap ? h : w
  canvas.height = swap ? w : h

  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.save()
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate((rotation * Math.PI) / 180)
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1)
  ctx.drawImage(src, -w / 2, -h / 2, w, h)
  ctx.restore()
}

// Chuyển toạ độ pixel trên canvas hiển thị -> toạ độ chuẩn hoá (u,v) của ảnh
// gốc, bằng cách đảo ngược phép xoay/lật đã áp dụng khi vẽ.
export function screenToNormalized(
  px: number,
  py: number,
  canvasW: number,
  canvasH: number,
  transform: Transform,
): { u: number; v: number } {
  const { rotation, flipH, flipV } = transform
  const swap = rotation === 90 || rotation === 270
  const imgW = swap ? canvasH : canvasW
  const imgH = swap ? canvasW : canvasH

  const x = px - canvasW / 2
  const y = py - canvasH / 2
  const theta = (rotation * Math.PI) / 180
  // Đảo xoay: R(-θ)
  const rx = x * Math.cos(theta) + y * Math.sin(theta)
  const ry = -x * Math.sin(theta) + y * Math.cos(theta)
  // Đảo lật
  const a = rx / (flipH ? -1 : 1)
  const b = ry / (flipV ? -1 : 1)

  return { u: a / imgW + 0.5, v: b / imgH + 0.5 }
}
