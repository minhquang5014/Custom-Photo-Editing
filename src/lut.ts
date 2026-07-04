// ---------------------------------------------------------------------------
// Engine 3D LUT (Look-Up Table) — nền tảng filter chất lượng "pro".
// Hỗ trợ: nạp file .cube (chuẩn công nghiệp) + vài LUT tự tạo bằng code.
// Áp dụng bằng nội suy trilinear trên khối màu RGB.
// ---------------------------------------------------------------------------

export interface LUT3D {
  size: number
  data: Float32Array // size^3 * 3, thứ tự R chạy nhanh nhất: idx = (r + g*N + b*N*N) * 3
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

// ---- Parse .cube ----
export function parseCube(text: string): LUT3D {
  let size = 0
  const domainMin = [0, 0, 0]
  const domainMax = [1, 1, 1]
  const values: number[] = []

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const upper = line.toUpperCase()
    if (upper.startsWith('LUT_3D_SIZE')) {
      size = parseInt(line.split(/\s+/)[1], 10)
    } else if (upper.startsWith('LUT_1D_SIZE')) {
      throw new Error('LUT 1D chưa hỗ trợ — hãy dùng LUT 3D (.cube).')
    } else if (upper.startsWith('DOMAIN_MIN')) {
      const p = line.split(/\s+/)
      domainMin[0] = +p[1]; domainMin[1] = +p[2]; domainMin[2] = +p[3]
    } else if (upper.startsWith('DOMAIN_MAX')) {
      const p = line.split(/\s+/)
      domainMax[0] = +p[1]; domainMax[1] = +p[2]; domainMax[2] = +p[3]
    } else {
      // Chỉ nhận dòng dữ liệu: 3 số thực. Dòng chữ (TITLE, *_RANGE...) bị bỏ qua.
      const p = line.split(/\s+/)
      if (p.length >= 3 && p.slice(0, 3).every((n) => /^[-+]?[\d.]+(e[-+]?\d+)?$/i.test(n))) {
        values.push(+p[0], +p[1], +p[2])
      }
    }
  }

  if (!size || values.length !== size * size * size * 3) {
    throw new Error('File .cube không hợp lệ hoặc thiếu dữ liệu.')
  }
  // Chuẩn hoá domain về 0..1 nếu cần
  void domainMin; void domainMax
  return { size, data: Float32Array.from(values) }
}

// ---- Sinh LUT từ một hàm biến đổi màu ----
type ColorFn = (r: number, g: number, b: number) => [number, number, number]

export function generateLUT(size: number, fn: ColorFn): LUT3D {
  const data = new Float32Array(size * size * size * 3)
  let i = 0
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const [nr, ng, nb] = fn(r / (size - 1), g / (size - 1), b / (size - 1))
        data[i++] = clamp01(nr)
        data[i++] = clamp01(ng)
        data[i++] = clamp01(nb)
      }
    }
  }
  return { size, data }
}

// ---- Áp dụng LUT lên ImageData (nội suy trilinear) ----
export function applyLUT(px: Uint8ClampedArray, lut: LUT3D, intensity = 1): void {
  const N = lut.size
  const d = lut.data
  const maxIdx = N - 1

  for (let i = 0; i < px.length; i += 4) {
    const r = (px[i] / 255) * maxIdx
    const g = (px[i + 1] / 255) * maxIdx
    const b = (px[i + 2] / 255) * maxIdx

    const r0 = Math.floor(r), g0 = Math.floor(g), b0 = Math.floor(b)
    const r1 = Math.min(r0 + 1, maxIdx), g1 = Math.min(g0 + 1, maxIdx), b1 = Math.min(b0 + 1, maxIdx)
    const fr = r - r0, fg = g - g0, fb = b - b0

    // 8 đỉnh của ô lưới
    const idx = (rr: number, gg: number, bb: number) => (rr + gg * N + bb * N * N) * 3

    let nr = 0, ng = 0, nb = 0
    // trilinear: cộng dồn theo 8 trọng số
    const corners: [number, number, number][] = [
      [r0, g0, b0], [r1, g0, b0], [r0, g1, b0], [r1, g1, b0],
      [r0, g0, b1], [r1, g0, b1], [r0, g1, b1], [r1, g1, b1],
    ]
    const weights = [
      (1 - fr) * (1 - fg) * (1 - fb), fr * (1 - fg) * (1 - fb),
      (1 - fr) * fg * (1 - fb), fr * fg * (1 - fb),
      (1 - fr) * (1 - fg) * fb, fr * (1 - fg) * fb,
      (1 - fr) * fg * fb, fr * fg * fb,
    ]
    for (let c = 0; c < 8; c++) {
      const w = weights[c]
      if (w === 0) continue
      const j = idx(corners[c][0], corners[c][1], corners[c][2])
      nr += d[j] * w
      ng += d[j + 1] * w
      nb += d[j + 2] * w
    }

    if (intensity >= 1) {
      px[i] = nr * 255
      px[i + 1] = ng * 255
      px[i + 2] = nb * 255
    } else {
      // pha trộn với gốc theo cường độ
      px[i] = px[i] * (1 - intensity) + nr * 255 * intensity
      px[i + 1] = px[i + 1] * (1 - intensity) + ng * 255 * intensity
      px[i + 2] = px[i + 2] * (1 - intensity) + nb * 255 * intensity
    }
  }
}

// ---- Vài look tự chế (procedural) ----
const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b
// S-curve nhẹ tăng tương phản quanh 0.5
const scurve = (x: number, k: number) => clamp01(0.5 + (x - 0.5) * (1 + k))

const LOOKS: Record<string, ColorFn> = {
  // Kodak ấm: đẩy đỏ/vàng, hạ lam, tương phản nhẹ
  kodak: (r, g, b) => [
    scurve(r * 1.06 + 0.02, 0.12),
    scurve(g * 1.01 + 0.005, 0.1),
    scurve(b * 0.93 - 0.005, 0.1),
  ],
  // Fuji: ngả xanh lá dịu, blacks nâng nhẹ, tương phản thấp
  fuji: (r, g, b) => [
    clamp01(0.02 + r * 0.96),
    clamp01(0.03 + g * 0.99),
    clamp01(0.02 + b * 0.95),
  ],
  // Teal & Orange điện ảnh: bóng ngả teal, sáng ngả cam
  teal: (r, g, b) => {
    const t = luma(r, g, b) - 0.5
    return [scurve(r + t * 0.14, 0.14), g, scurve(b - t * 0.14, 0.14)]
  },
  // Vintage phai: nâng blacks, giảm bão hoà, ngả ấm
  vintage: (r, g, b) => {
    const l = luma(r, g, b)
    const desat = 0.22
    return [
      clamp01(0.06 + (r * (1 - desat) + l * desat) * 0.9 + 0.02),
      clamp01(0.05 + (g * (1 - desat) + l * desat) * 0.9),
      clamp01(0.05 + (b * (1 - desat) + l * desat) * 0.86),
    ]
  },
  // Đen trắng film tương phản
  mono: (r, g, b) => {
    const l = scurve(luma(r, g, b), 0.25)
    return [l, l, l]
  },
}

export interface LutMeta {
  id: string
  name: string
}

export const BUILTIN_LUTS: LutMeta[] = [
  { id: 'none', name: 'Gốc' },
  { id: 'kodak', name: 'Kodak' },
  { id: 'fuji', name: 'Fuji' },
  { id: 'teal', name: 'Điện ảnh' },
  { id: 'vintage', name: 'Vintage' },
  { id: 'mono', name: 'B&W Film' },
]

// Cache LUT đã sinh + LUT do người dùng import
const generated = new Map<string, LUT3D>()
const imported = new Map<string, LUT3D>()

export function getLUT(id: string): LUT3D | null {
  if (id === 'none') return null
  if (imported.has(id)) return imported.get(id)!
  if (generated.has(id)) return generated.get(id)!
  const fn = LOOKS[id]
  if (!fn) return null
  const lut = generateLUT(17, fn)
  generated.set(id, lut)
  return lut
}

// Đăng ký LUT nhập từ file .cube, trả về id để chọn
export function registerImportedLUT(name: string, lut: LUT3D): LutMeta {
  const id = `import:${name}:${Date.now()}`
  imported.set(id, lut)
  return { id, name }
}
