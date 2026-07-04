import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  PRESETS,
  DEFAULT_ADJ,
  DEFAULT_TRANSFORM,
  NO_LAYERS,
  buildFilter,
  drawToCanvas,
  screenToNormalized,
  type Adjustments,
  type BrushLayer,
  type BrushType,
  type Grade,
  type Stroke,
  type Transform,
} from './filters'
import { BUILTIN_LUTS, parseCube, registerImportedLUT, type LutMeta } from './lut'

const PREVIEW_MAX = 1400 // giới hạn độ phân giải preview cho mượt

const SLIDERS: { key: keyof Adjustments; label: string; min: number; max: number; center: number }[] = [
  { key: 'brightness', label: 'Độ sáng', min: 0, max: 200, center: 100 },
  { key: 'contrast', label: 'Tương phản', min: 0, max: 200, center: 100 },
  { key: 'saturation', label: 'Độ bão hòa', min: 0, max: 200, center: 100 },
  { key: 'warmth', label: 'Tông ấm/lạnh', min: -100, max: 100, center: 0 },
  { key: 'blur', label: 'Làm mờ', min: 0, max: 10, center: 0 },
]

const BLUSH_COLORS = [
  { name: 'Hồng đào', hex: '#ff6b8a' },
  { name: 'Cam san hô', hex: '#ff8f6b' },
  { name: 'Đỏ hồng', hex: '#ff4d6d' },
  { name: 'Hồng nhạt', hex: '#f0a5b8' },
]

type Tool = 'none' | BrushType

export default function App() {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [fileName, setFileName] = useState('anh')
  const [presetId, setPresetId] = useState('original')
  const [adj, setAdj] = useState<Adjustments>({ ...DEFAULT_ADJ })
  const [transform, setTransform] = useState<Transform>({ ...DEFAULT_TRANSFORM })

  // Filter LUT
  const [lutId, setLutId] = useState('none')
  const [lutIntensity, setLutIntensity] = useState(100)
  const [importedLuts, setImportedLuts] = useState<LutMeta[]>([])

  // Cọ cục bộ đa công cụ
  const [tool, setTool] = useState<Tool>('none')
  const [brushSize, setBrushSize] = useState(14)
  const [localAmount, setLocalAmount] = useState(45) // tô sáng
  const [blushOpacity, setBlushOpacity] = useState(55) // má hồng
  const [blushColor, setBlushColor] = useState(BLUSH_COLORS[0].hex)
  const strokesRef = useRef<Record<BrushType, Stroke[]>>({ brighten: [], blush: [] })
  const [strokeCount, setStrokeCount] = useState(0)
  const paintingRef = useRef(false)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const thumbRefs = useRef<Record<string, HTMLCanvasElement | null>>({})
  const lutThumbRefs = useRef<Record<string, HTMLCanvasElement | null>>({})
  const ringRef = useRef<HTMLDivElement>(null)

  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0]
  const allLuts = useMemo(() => [...BUILTIN_LUTS, ...importedLuts], [importedLuts])

  const grade: Grade = useMemo(
    () => ({ filter: buildFilter(preset, adj), lutId, lutIntensity: lutIntensity / 100 }),
    [preset, adj, lutId, lutIntensity],
  )

  const currentLayers = useCallback(
    (): BrushLayer[] => [
      { type: 'brighten', amount: localAmount, strokes: strokesRef.current.brighten },
      { type: 'blush', amount: blushOpacity, color: blushColor, strokes: strokesRef.current.blush },
    ],
    [localAmount, blushOpacity, blushColor],
  )

  const drawPreview = useCallback(() => {
    if (!img || !canvasRef.current) return
    drawToCanvas(canvasRef.current, img, grade, transform, currentLayers(), PREVIEW_MAX)
  }, [img, grade, transform, currentLayers])

  useEffect(() => {
    drawPreview()
  }, [drawPreview, strokeCount])

  // Thumbnail bộ lọc CSS (không LUT)
  useEffect(() => {
    if (!img) return
    for (const p of PRESETS) {
      const c = thumbRefs.current[p.id]
      if (c) {
        drawToCanvas(c, img, { filter: buildFilter(p, DEFAULT_ADJ), lutId: 'none', lutIntensity: 1 },
          DEFAULT_TRANSFORM, NO_LAYERS, 140)
      }
    }
  }, [img])

  // Thumbnail filter LUT
  useEffect(() => {
    if (!img) return
    for (const l of allLuts) {
      const c = lutThumbRefs.current[l.id]
      if (c) {
        drawToCanvas(c, img, { filter: 'none', lutId: l.id, lutIntensity: 1 },
          DEFAULT_TRANSFORM, NO_LAYERS, 140)
      }
    }
  }, [img, allLuts])

  const loadFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return
    setFileName(file.name.replace(/\.[^.]+$/, '') || 'anh')
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      strokesRef.current = { brighten: [], blush: [] }
      setStrokeCount(0)
      setImg(image)
      setPresetId('original')
      setLutId('none')
      setLutIntensity(100)
      setAdj({ ...DEFAULT_ADJ })
      setTransform({ ...DEFAULT_TRANSFORM })
      setTool('none')
      URL.revokeObjectURL(url)
    }
    image.src = url
  }, [])

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) loadFile(file)
    e.target.value = ''
  }

  const onImportCube = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const text = await file.text()
      const lut = parseCube(text)
      const meta = registerImportedLUT(file.name.replace(/\.cube$/i, ''), lut)
      setImportedLuts((prev) => [...prev, meta])
      setLutId(meta.id)
    } catch (err) {
      alert('Không đọc được LUT: ' + (err as Error).message)
    }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file) loadFile(file)
  }

  const rotate = (dir: 1 | -1) =>
    setTransform((t) => ({ ...t, rotation: (((t.rotation + dir * 90) % 360) + 360) % 360 }))

  const resetAll = () => {
    setAdj({ ...DEFAULT_ADJ })
    setPresetId('original')
    setLutId('none')
    setLutIntensity(100)
    setTransform({ ...DEFAULT_TRANSFORM })
    strokesRef.current = { brighten: [], blush: [] }
    setStrokeCount((n) => n + 1)
  }

  const clearTool = (t: BrushType) => {
    strokesRef.current[t] = []
    setStrokeCount((n) => n + 1)
  }

  // ---- Cọ tô ----
  const addStroke = (e: React.PointerEvent) => {
    if (tool === 'none') return
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * canvas.width
    const py = ((e.clientY - rect.top) / rect.height) * canvas.height
    const { u, v } = screenToNormalized(px, py, canvas.width, canvas.height, transform)
    strokesRef.current[tool].push({ u, v, r: brushSize / 100 })
    drawPreview()
  }

  const moveRing = (e: React.PointerEvent) => {
    const ring = ringRef.current
    const canvas = canvasRef.current
    if (!ring || !canvas) return
    const rect = canvas.getBoundingClientRect()
    const displayScale = rect.width / canvas.width
    const diameter = (brushSize / 100) * Math.max(canvas.width, canvas.height) * 2 * displayScale
    ring.style.width = `${diameter}px`
    ring.style.height = `${diameter}px`
    ring.style.left = `${e.clientX}px`
    ring.style.top = `${e.clientY}px`
    ring.style.opacity = '1'
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (tool === 'none') return
    e.currentTarget.setPointerCapture(e.pointerId)
    paintingRef.current = true
    addStroke(e)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (tool === 'none') return
    moveRing(e)
    if (paintingRef.current) addStroke(e)
  }
  const onPointerUp = () => {
    if (!paintingRef.current) return
    paintingRef.current = false
    setStrokeCount((n) => n + 1)
  }

  const download = () => {
    if (!img) return
    const canvas = document.createElement('canvas')
    drawToCanvas(canvas, img, grade, transform, currentLayers()) // full-res
    canvas.toBlob(
      (blob) => {
        if (!blob) return
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${fileName}-piclite.jpg`
        a.click()
        URL.revokeObjectURL(url)
      },
      'image/jpeg',
      0.92,
    )
  }

  const toggleTool = (t: BrushType) => setTool((cur) => (cur === t ? 'none' : t))

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="dot" /> PicLite
        </div>
        {img && (
          <div className="topbar-actions">
            <button className="btn ghost" onClick={resetAll}>Đặt lại</button>
            <button className="btn primary" onClick={download}>Tải về</button>
          </div>
        )}
      </header>

      {!img ? (
        <label className="dropzone" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
          <input type="file" accept="image/*" hidden onChange={onInputChange} />
          <div className="dz-icon">🖼️</div>
          <div className="dz-title">Chọn ảnh để bắt đầu</div>
          <div className="dz-sub">Bấm vào đây hoặc kéo–thả ảnh vào · chạy 100% trên máy bạn</div>
        </label>
      ) : (
        <main className="editor">
          <section className="stage">
            <canvas
              ref={canvasRef}
              className={`preview ${tool !== 'none' ? 'painting' : ''}`}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={() => {
                onPointerUp()
                if (ringRef.current) ringRef.current.style.opacity = '0'
              }}
            />
            <div ref={ringRef} className={`brush-ring ${tool}`} />
          </section>

          <aside className="panel">
            <div className="panel-block">
              <div className="panel-label">Filter LUT (pro)</div>
              <div className="filters">
                {allLuts.map((l) => (
                  <button
                    key={l.id}
                    className={`thumb ${l.id === lutId ? 'active' : ''}`}
                    onClick={() => setLutId(l.id)}
                  >
                    <canvas width={70} height={70} ref={(el) => { lutThumbRefs.current[l.id] = el }} />
                    <span>{l.name}</span>
                  </button>
                ))}
              </div>
              {lutId !== 'none' && (
                <div className="slider-row" style={{ marginTop: 12 }}>
                  <div className="slider-head">
                    <span>Cường độ LUT</span>
                    <span className="slider-val">{lutIntensity}</span>
                  </div>
                  <input type="range" min={0} max={100} value={lutIntensity}
                    onChange={(e) => setLutIntensity(Number(e.target.value))} />
                </div>
              )}
              <label className="btn ghost full" style={{ marginTop: 10 }}>
                <input type="file" accept=".cube" hidden onChange={onImportCube} />
                + Nhập LUT .cube
              </label>
            </div>

            <div className="panel-block">
              <div className="panel-label">Bộ lọc nhanh</div>
              <div className="filters">
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    className={`thumb ${p.id === presetId ? 'active' : ''}`}
                    onClick={() => setPresetId(p.id)}
                  >
                    <canvas width={70} height={70} ref={(el) => { thumbRefs.current[p.id] = el }} />
                    <span>{p.name}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="panel-block">
              <div className="panel-label">Cọ chỉnh vùng</div>
              <div className="tools">
                <button
                  className={`btn tool ${tool === 'brighten' ? 'primary' : ''}`}
                  onClick={() => toggleTool('brighten')}
                >
                  ☀️ Tô sáng
                </button>
                <button
                  className={`btn tool ${tool === 'blush' ? 'primary' : ''}`}
                  onClick={() => toggleTool('blush')}
                >
                  🌸 Má hồng
                </button>
              </div>

              {tool === 'brighten' && (
                <div className="brush-controls">
                  <div className="slider-row">
                    <div className="slider-head">
                      <span>Độ sáng vùng</span>
                      <span className="slider-val">{localAmount > 0 ? `+${localAmount}` : localAmount}</span>
                    </div>
                    <input type="range" min={-100} max={100} value={localAmount}
                      onChange={(e) => setLocalAmount(Number(e.target.value))} />
                  </div>
                  <BrushSizeRow value={brushSize} onChange={setBrushSize} />
                  <button className="btn ghost full" onClick={() => clearTool('brighten')}>Xoá vùng tô sáng</button>
                </div>
              )}

              {tool === 'blush' && (
                <div className="brush-controls">
                  <div className="swatches">
                    {BLUSH_COLORS.map((c) => (
                      <button
                        key={c.hex}
                        title={c.name}
                        className={`swatch ${blushColor === c.hex ? 'active' : ''}`}
                        style={{ background: c.hex }}
                        onClick={() => setBlushColor(c.hex)}
                      />
                    ))}
                  </div>
                  <div className="slider-row">
                    <div className="slider-head">
                      <span>Độ đậm má hồng</span>
                      <span className="slider-val">{blushOpacity}</span>
                    </div>
                    <input type="range" min={0} max={100} value={blushOpacity}
                      onChange={(e) => setBlushOpacity(Number(e.target.value))} />
                  </div>
                  <BrushSizeRow value={brushSize} onChange={setBrushSize} />
                  <button className="btn ghost full" onClick={() => clearTool('blush')}>Xoá má hồng</button>
                </div>
              )}
            </div>

            <div className="panel-block">
              <div className="panel-label">Tinh chỉnh</div>
              {SLIDERS.map((s) => (
                <div className="slider-row" key={s.key}>
                  <div className="slider-head">
                    <span>{s.label}</span>
                    <span className="slider-val">{adj[s.key]}</span>
                  </div>
                  <input
                    type="range"
                    min={s.min}
                    max={s.max}
                    value={adj[s.key]}
                    onChange={(e) => setAdj((a) => ({ ...a, [s.key]: Number(e.target.value) }))}
                    onDoubleClick={() => setAdj((a) => ({ ...a, [s.key]: s.center }))}
                  />
                </div>
              ))}
            </div>

            <div className="panel-block">
              <div className="panel-label">Xoay / Lật</div>
              <div className="tools">
                <button className="btn tool" onClick={() => rotate(-1)}>↺ Trái</button>
                <button className="btn tool" onClick={() => rotate(1)}>↻ Phải</button>
                <button className="btn tool" onClick={() => setTransform((t) => ({ ...t, flipH: !t.flipH }))}>⇋ Ngang</button>
                <button className="btn tool" onClick={() => setTransform((t) => ({ ...t, flipV: !t.flipV }))}>⇅ Dọc</button>
              </div>
            </div>

            <label className="btn ghost full">
              <input type="file" accept="image/*" hidden onChange={onInputChange} />
              Chọn ảnh khác
            </label>
          </aside>
        </main>
      )}
    </div>
  )
}

function BrushSizeRow({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="slider-row">
      <div className="slider-head">
        <span>Cỡ cọ</span>
        <span className="slider-val">{value}</span>
      </div>
      <input type="range" min={4} max={40} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  )
}
