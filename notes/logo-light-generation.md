# Logo 亮色版生成记录

- 工具：内置 imagegen，基于 v3 编辑生成；ImageMagick / iconutil 用于尺寸和平台格式转换。
- 最终源稿：`resources/logo-multi-session-browser-v4.png`，1024×1024。
- 应用 PNG：`resources/icon.png`、`build/icon.png`，512×512。
- Windows / macOS：`build/icon.ico`、`build/icon.icns`，保留原有分辨率集合。
- 外部透明区域沿用 v3 的 alpha 蒙版。

## 首次生成提示词

```text
Use case: precise-object-edit. Asset type: desktop app logo for 多会话测试浏览器. Input image: edit target, existing 1024x1024 logo. Primary request: recolor this exact logo for daytime/light mode; preserve its existing graphic style and geometry. Change only colors: replace the near-black rounded square tile and all browser interior fills with a light warm ivory/off-white (#F7F5EF). Preserve the vivid golden amber (#FFB000) frontmost browser frame. Recolor the middle browser frame to a clear medium slate gray (#7C8794), and the back browser frame to a lighter slate gray (#A9B2BC), both clearly legible on ivory. The three circular controls in each browser should be dark slate gray (#424B56). Constraints: preserve exactly the three overlapping browser windows, their outlines, thick flat strokes, window corner radii, three round controls per window, stacking order, front bottom-left/middle center/back top-right placement, tile silhouette, outer transparent margin and scale. Flat vector-like raster appearance, uniform solid fills, crisp smooth edges. No new objects, no text, no gradients, no shadows, no 3D, no additional border. Canvas must remain 1024x1024 pixels, icon tile bounds remain approximately x100..924 and y100..924, transparent alpha outside the tile. The overall icon must feel bright, warm, clean and professional.
```

## 最终修正提示词

```text
Edit this logo with one focused correction: remove all gradients, grain and mottling so every shape is a completely uniform solid color. Keep the exact existing three overlapping browser window shapes, positions and sizes unchanged. Front frame pure solid #FFB000, middle frame solid #7C8794, back frame solid #A9B2BC, all nine control dots solid #424B56, tile and all interiors solid #F7F5EF. CRITICAL: do not draw a checkerboard. Do not simulate transparency with gray squares. Outside the rounded square tile use pure solid WHITE #FFFFFF background if real alpha cannot be output; no pattern. Preserve current 1024x1024 square composition, approximately 100px outer padding on each side. Flat vector graphic, no shadows, no textures, no gradients, no additional outline, no new objects, no text. The rounded square tile silhouette and its exact bounds must match the original dark logo reference.
```

