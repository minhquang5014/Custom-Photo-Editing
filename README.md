# PicLite — Custom Photo Editing

Web chỉnh ảnh chạy **100% trên trình duyệt** (không upload ảnh đi đâu), dùng được trên cả điện thoại và máy tính. Định hướng làm kho filter/template kiểu Hypic / Xingtu.

## Tính năng
- 📤 Up ảnh (bấm chọn hoặc kéo–thả)
- 🎨 **Bộ lọc nhanh** — 13 preset kiểu Instagram (Clarendon, Juno, Ludwig, ...)
- 🎞️ **Filter LUT (pro)** — engine 3D LUT với nội suy trilinear:
  - LUT tự chế: Kodak, Fuji, Điện ảnh (teal & orange), Vintage, B&W Film
  - Slider cường độ + **nhập file `.cube`** bất kỳ
- 🖌️ **Chỉnh sáng vùng** — cọ tô nâng vùng tối bằng gamma lift (không cần AI), viền mềm
- 🎚️ Tinh chỉnh: độ sáng, tương phản, bão hòa, tông ấm/lạnh, làm mờ
- 🔄 Xoay / lật
- 💾 Tải về JPEG full-res, đúng y preview (WYSIWYG)

## Công nghệ
React + TypeScript + Vite. Xử lý ảnh bằng HTML5 Canvas, không cần server.

## Chạy local
```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # build production vào dist/
```

## Cấu trúc
- `src/filters.ts` — pipeline render (CSS filter → LUT → nâng sáng vùng → xoay/lật), có cache
- `src/lut.ts` — engine 3D LUT: parser `.cube`, nội suy trilinear, look procedural
- `src/App.tsx` — giao diện + state

## Lộ trình
- [x] Filter cơ bản + tinh chỉnh
- [x] Chỉnh sáng vùng (local adjustment)
- [x] Engine 3D LUT + import `.cube`
- [ ] Hệ thống Template (LUT + overlay + frame + tỉ lệ crop)
- [ ] Crop tỉ lệ IG (1:1, 4:5)
- [ ] PWA (cài như app trên điện thoại)
- [ ] AI (làm sau)
