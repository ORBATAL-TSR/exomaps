# ExoMaps VITA — Client Architecture

> **For future LLMs and developers.** Read this before touching `App.tsx`, the WebGL
> pipeline, or the Flask serving layer. Getting any of these wrong silently breaks
> production in ways that look like unrelated crashes.

---

## 1. Directory layout

```
02_CLIENT/VITA/
├── src/
│   ├── App.tsx                 ← Single root: Canvas + routing + context-loss recovery
│   ├── app/                    ← Infrastructure helpers (NOT scene code)
│   │   ├── lazyWithRetry.ts    ← React.lazy + exponential-backoff for LAN chunk fetches
│   │   ├── ChunkErrorBoundary.tsx  ← Catches ChunkLoadError + render errors, RETRY UI
│   │   └── useWebGLCleanup.ts  ← Disposes Three.js scene on Canvas teardown only
│   ├── scenes/                 ← Heavy, lazily-loaded scene trees (each is a Vite chunk)
│   │   └── SystemFocusView.tsx ← Orrery + planet drill-down (the "orrery" chunk)
│   ├── components/             ← Reusable UI + 3D components (always-loaded or used by scenes)
│   ├── world/                  ← Pure rendering engine: shaders, OrreryComponents, profiles
│   ├── hooks/                  ← React state/data hooks
│   ├── panels/                 ← Colony/terrain overlays
│   └── utils/                  ← verifiedFetch, deterministic, etc.
├── vite.config.ts
└── ARCHITECTURE.md             ← You are here
```

**Rule:** Scene files belong in `src/scenes/`. Every file there becomes its own Rollup
chunk (see `manualChunks` in `vite.config.ts`). Don't put heavy Three.js code directly
in `components/` — it will be included in the initial bundle.

---

## 2. Dev vs. production serving

### Dev (Vite HMR)
```
vite dev  →  http://localhost:1420
              /api/*  →  proxy  →  Flask :5000
```
- 686+ individual ES modules are served over the proxy. Fine for local dev, not for LAN.
- Tauri dev mode uses this.

### LAN preview (recommended for playtesting)
```
npm run build  →  dist/
vite preview   →  https://localhost:1420  (HTTPS, self-signed cert in 07_LOCALRUN/certs/)
               /api/*  →  proxy  →  Flask :5000
```
- Serves the compiled `dist/` bundle. Fast. No waterfall.
- `allowedHosts` in `vite.config.ts` is the allowlist: `exomaps.local`, `localhost`, `192.168.1.77`.

### Production (Flask serves everything)
```
Flask :5000   →  serves dist/index.html  (SPA catch-all)
              →  serves dist/assets/*    (JS/CSS chunks)
              →  serves /api/*           (gateway routes)
```
- `_CLIENT_BUILD` in `app.py` points to `02_CLIENT/VITA/dist`.
- **Critical rule**: Flask returns `404` for any request whose extension is in
  `_ASSET_EXTENSIONS` (`.js .css .wasm .map .png .jpg …`) and the file doesn't exist on disk.
  Do NOT remove this rule. Without it, a missing chunk silently receives `index.html`,
  the browser parses it as JS, throws a `SyntaxError`, and the crash looks like a WebGL death.

---

## 3. WebGL context lifecycle — THE most important section

### 3.1 Single Canvas, persistent for the lifetime of the app

`App.tsx` renders **one** `<Canvas>` that is never unmounted during normal navigation.
`DesktopLayout` (star map) and `SystemFocusView` (orrery) each render their 3D content
inside an R3F `<View>`. `<View.Port />` scissor-renders each View into the shared Canvas.

```
<Canvas>              ← permanent, one WebGL context
  <View.Port />       ← dispatches scissored draw calls to each View
  <CanvasCleanup />   ← disposes resources on Canvas teardown (see §3.3)
</Canvas>

<DesktopLayout>       ← contains <View>  (star map)
<SystemFocusView>     ← contains <View>  (orrery)
```

**Why?** Mounting/unmounting a `<View>` removes React nodes. It does NOT touch the WebGL
context. Shaders and textures stay compiled and resident in VRAM between route changes.
This is essential on D3D11 (ANGLE) where context loss = hard device reset.

### 3.2 Context loss recovery (`canvasKey`)

`App.tsx` listens for `webglcontextlost` / `webglcontextrestored` on the Canvas element.
On restoration, `canvasKey` is incremented. The `key={canvasKey}` prop on the wrapping
`<div>` forces React to unmount + remount the entire Canvas tree, giving R3F a clean slate.

`sfvSystemId` is intentionally **not** cleared on context loss so the user lands back on
the same system after recovery.

**Do not** add an unmount/remount path outside of `canvasKey`. It defeats the whole point.

### 3.3 Resource disposal (`useWebGLCleanup`)

`CanvasCleanup` (rendered inside `<Canvas>`) calls `useWebGLCleanup()` on unmount.
This traverses the Three.js scene, disposes geometries/materials/textures, and calls
`gl.renderLists.dispose()`.

**This only fires when `canvasKey` increments** (context-loss remount), not on navigation.
That is intentional: keeping textures resident avoids re-upload on every route change.

### 3.4 View visibility and `visible={false}`

When `focusedSystem` is null (user is on star map), `SystemFocusView` receives
`active={false}`. The `<View visible={active}>` stops scissor-rendering.

**`useFrame` still fires in invisible Views.** Draw calls do NOT happen.
Shader compilation does NOT happen in invisible Views.

This means: **never** use `useFrame` to detect that rendering has occurred on first
paint. The old `onReady` pattern in `ProceduralPlanet` fired on the first `useFrame`
tick regardless of visibility — this was a bug that caused D3D11 TDR by signalling
"ready" before the GPU ever compiled the shader.

### 3.5 Shader warmup (`gl.compileAsync`)

`SystemFocusView` includes a `<ShaderWarmup>` component that calls `gl.compileAsync()`
with `WORLD_FRAG` (the 3305-line planet fragment shader) as soon as the View mounts
(even while `visible=false`).

`gl.compileAsync` uses `WEBGL_parallel_shader_compile` internally. It is truly
non-blocking — shader compilation happens on a worker thread and the Promise resolves
when done. This is the only safe way to pre-warm shaders in a D3D11 context.

**Do not** replace this with any synchronous compilation path (e.g. `gl.compile()`),
a `useFrame` render of a warmup mesh, or a fake `setTimeout`. All of those either block
the GPU thread (TDR risk) or fire too early (before compilation).

---

## 4. Chunk loading

`SystemFocusView` is the heaviest component (~200 KB+ including Three.js scene code).
It is code-split into the `"orrery"` Rollup chunk via `vite.config.ts`:

```typescript
manualChunks: {
  'orrery': ['./src/scenes/SystemFocusView'],
}
```

`App.tsx` loads it via `lazyWithRetry` — `React.lazy` with exponential-backoff retry
(800 → 1600 → 3200 ms) for transient LAN network failures:

```typescript
const SystemFocusView = lazyWithRetry(
  () => import('./scenes/SystemFocusView').then(m => ({ default: m.SystemFocusView }))
);
```

`ChunkErrorBoundary` wraps the `<Suspense>` and catches two cases:
- `ChunkLoadError` (network / deploy mismatch) → shows RETRY + ← STAR MAP
- Runtime render error (null deref, bad uniform) → same recovery UI

**If you add a new heavy scene**, follow the same pattern:
1. Place it in `src/scenes/`
2. Add a `manualChunks` entry in `vite.config.ts`
3. Import via `lazyWithRetry` in `App.tsx`
4. Wrap with `ChunkErrorBoundary + Suspense`

---

## 5. SRI (Subresource Integrity)

The `sriPlugin()` in `vite.config.ts` adds `integrity="sha384-..."` to every `<script>`
and `<link rel="stylesheet">` in the built `index.html`.

**Critical implementation detail**: hashes are computed in the `closeBundle` hook by
reading the actual bytes written to disk — NOT from `chunk.code` in `generateBundle`.
Vite's modulepreload injection modifies entry chunks on disk after `generateBundle`, so
hashing `chunk.code` produces a mismatch that the browser will block.

If the build produces an SRI mismatch error (`Failed to find a valid digest in the
'integrity' attribute`), the cause is almost always the hash being computed from
in-memory bytes before Vite finishes its post-processing. **Do not** move the hashing
logic into `generateBundle` or `transformIndexHtml`.

---

## 6. API security (`verifiedFetch`)

All API calls go through `src/utils/verifiedFetch.ts`. It verifies the
`X-Content-Signature: sha256=<hmac>` response header before returning the JSON body.
Flask signs responses using a shared secret from `EXOMAPS_API_SECRET`.

**Do not** use `fetch()` directly for gateway API calls. Game state data will be sent
through this same channel and spoofed responses are a known threat model.

The signature scheme: `HMAC-SHA256(secret, response_body_bytes)` → hex → `sha256=<hex>`.
If the header is absent or the HMAC doesn't match, `verifiedFetch` throws — the caller
should surface this as a load error, not silently continue.

---

## 7. Loading screen progress protocol

`App.tsx` passes `onLoadStage` and `onSubProgress` to `SystemFocusView`.
`LoadingScreen` maps these to a progress bar. The milestones:

| Event | Stage | subProgress | Bar % |
|-------|-------|-------------|-------|
| System clicked | `'connecting'` | 0 | 0–33% |
| Fetch started | `'scene'` | 0 | 33–68% |
| Data loaded, warmup started | `'scene'` | 0 | 68% |
| `compileAsync` resolves | `'scene'` | 0.5 | 82% |
| Shader compiled (shaderWarmed) | `'scene'` | 1.0 | 95% |
| Ready signal | `'ready'` | — | 100% |

The bar is driven by **real events**, not timers. Do not reintroduce time-based tweens
for the scene stage — they masked loading failures and made the % meaningless.

---

## 8. Anti-patterns (do not do these)

| Anti-pattern | Why it's wrong |
|---|---|
| `const C = lazy(() => import('./components/BigScene'))` | Missing retry + no chunk boundary — one network hiccup = broken route |
| Hashing `chunk.code` in `generateBundle` for SRI | Produces wrong hash after Vite's modulepreload injection |
| Flask catch-all returning `index.html` for missing `.js` | Missing chunk silently parses as HTML → SyntaxError looks like WebGL death |
| `useFrame` to detect first render / warmup | `useFrame` fires in invisible Views where no draw calls happen |
| `gl.compile()` or sync render for warmup | Blocks GPU thread → D3D11 TDR on shaders > ~1000 lines |
| Unmounting and remounting `<Canvas>` for navigation | Destroys WebGL context, forces full shader recompilation |
| Clearing `sfvSystemId` on back-navigation | SFV unmounts, compiled shaders evicted, TDR risk on next visit |
| Direct `fetch()` for API calls (bypassing `verifiedFetch`) | No HMAC verification — spoofable |
| Adding city lights to planets | Permanently off roadmap per feedback |
