/**
 * Composer state migration — central entry for the 4 Composer suites.
 *
 * Why this module exists:
 *   Each Composer (DesignComposer / MotionComposer / VideoComposer /
 *   SkeletonComposer) persists an opaque blob to the node payload
 *   (_designerState / _motionState / _videoComposeState / _skeletonState).
 *   When the schema changes, old projects must keep loading.
 *
 *   Before this module:
 *   - Only MotionComposer had a versioned schema (v=2) with inline migration
 *     code in store.js.
 *   - The other three relied on `|| defaults` fallbacks scattered across
 *     `restore()` — no explicit version, no central place to add migrations.
 *
 *   After this module:
 *   - `serialize()` of each store stamps `v: SCHEMA_VERSIONS[type]` on the
 *     output, so future migrations have a version anchor.
 *   - `restore()` of each store runs the saved blob through
 *     `migrateState(state, type)` as its first line. That is the single
 *     entry point for schema migrations.
 *
 * Contract:
 *   - migrateState is a pure function: same input → same output, no side
 *     effects.
 *   - migrateState is idempotent: migrateState(migrateState(x, t), t) ===
 *     migrateState(x, t) (in terms of structural equality of fields the
 *     UI cares about — references may differ because we shallow-clone).
 *   - Old states without `v` (or with `v < baseline`) are treated as
 *     legacy and run through every step up to the current version.
 *   - The function never throws on malformed input; it falls back to a
 *     baseline-shaped object so the Composer can still mount.
 *
 * Adding a new schema version (e.g. design v1 → v2):
 *   1. Bump SCHEMA_VERSIONS.design to 2.
 *   2. Add a `migrateDesignV1ToV2(state)` step in the chain.
 *   3. Update the Composer's CONTRACT.md schema-versions table.
 *   4. Update store.js serialize() to write the new fields.
 */

// Current schema versions per Composer.
// IMPORTANT: when bumping, also update the corresponding migration chain
// below AND the Composer's CONTRACT.md.
export const SCHEMA_VERSIONS = Object.freeze({
  design:   1,  // baseline: { objects, canvasWidth, canvasHeight, backgroundColor, bgOpacity }
  motion:   2,  // v=1: layers without presets; v=2: every layer carries `presets: {enter, continuous, exit}`
  video:    1,  // baseline: { tracks, duration, zoom, currentTime, mediaPool, aspectRatio }
  skeleton: 1,  // baseline: { canvasWidth, canvasHeight, backgroundColor, joints, bones, shapes }
  // Jitter-style compound Composer (Phase 1 骨架 — Phase 2/3 续):
  //   { mode: 'design'|'animate', designState (v=1 子结构), motionState (v=2 子结构 + sourceId) }
  // normalize 时把子结构分别 fanout 给 design / motion 的 normalizer,不重复迁移逻辑。
  unified:  1,
})

const COMPOSER_TYPES = Object.freeze(['design', 'motion', 'video', 'skeleton', 'unified'])

/**
 * Public entry: migrate a saved Composer blob to the current schema version.
 *
 * @param {object|null|undefined} state - raw saved state (or null on first open)
 * @param {'design'|'motion'|'video'|'skeleton'} type - Composer kind
 * @returns {object|null} migrated state, or null if input was null/undefined
 */
export function migrateState(state, type) {
  if (state == null) return state
  if (typeof state !== 'object') return state
  if (!COMPOSER_TYPES.includes(type)) return state

  // Detect version. Legacy blobs without `v` are treated as v=1.
  const fromVersion = typeof state.v === 'number' && state.v >= 1 ? state.v : 1
  const targetVersion = SCHEMA_VERSIONS[type]

  // Already at target — short-circuit to keep idempotency cheap.
  if (fromVersion >= targetVersion) {
    // Still run a "normalize at current version" pass so legacy blobs that
    // are missing fields (e.g. motion v=2 layer without `presets`) get
    // patched. This is what makes migrateState idempotent: running it twice
    // on an already-migrated state must not mutate observable behaviour.
    return normalizeAtCurrent(state, type)
  }

  // Step through each version. Today none of the Composers have a chain
  // longer than one step, but the structure is here for future v→v+1
  // migrations.
  let cur = state
  let curV = fromVersion
  while (curV < targetVersion) {
    cur = applyMigrationStep(cur, type, curV, curV + 1)
    curV += 1
  }
  return normalizeAtCurrent(cur, type)
}

/**
 * Per-version migration step. Pure: returns a new object, never mutates input.
 */
function applyMigrationStep(state, type, from, to) {
  if (type === 'motion' && from === 1 && to === 2) {
    return migrateMotionV1ToV2(state)
  }
  // No other migrations defined yet — pass through.
  return state
}

/**
 * Final normalization at the current schema version. Idempotent.
 * Ensures every field expected by the current Composer is present, even on
 * blobs that say `v: <target>` but happen to be missing fields.
 *
 * NOTE: these normalizations are intentionally minimal — they only patch
 * fields the existing `restore()` functions already tolerated being missing.
 * No new defaults are introduced here that the Composer didn't already use.
 */
function normalizeAtCurrent(state, type) {
  switch (type) {
    case 'design':   return normalizeDesign(state)
    case 'motion':   return normalizeMotion(state)
    case 'video':    return normalizeVideo(state)
    case 'skeleton': return normalizeSkeleton(state)
    case 'unified':  return normalizeUnified(state)
    default:         return state
  }
}

// ── unified (Jitter-style compound) ─────────────────────────────────────────

/**
 * Unified Composer state:
 *   { v:1, mode:'design'|'animate', designState (v=1 子结构), motionState (v=2 子结构 + sourceId) }
 *
 * Strategy: 不内嵌迁移逻辑,把子结构 fanout 给 design / motion 的 normalizer。
 * 这样 design v→v+x / motion v→v+x 升级时,unified 自动跟着升级,零额外维护。
 *
 * 子结构允许为 null/undefined(初次打开 / 用户尚未编辑该模式),Composer 内部
 * 自行 fallback 到空 store(沿用现有 design/motion restore() 的 `|| defaults`
 * 兜底)。
 */
function normalizeUnified(state) {
  const mode = (state.mode === 'design' || state.mode === 'animate') ? state.mode : 'design'
  // 子结构存在才迁移,不强制造空对象(避免 store.restore() 把空 {} 当成"已保存空白稿"覆盖默认值)
  const designState = state.designState != null ? migrateState(state.designState, 'design') : null
  const motionState = state.motionState != null ? migrateState(state.motionState, 'motion') : null
  return {
    ...state,
    v: SCHEMA_VERSIONS.unified,
    mode,
    designState,
    motionState,
  }
}

// ── motion ───────────────────────────────────────────────────────────────────

const EMPTY_MOTION_PRESETS = () => ({ enter: null, continuous: null, exit: null })

/**
 * Motion v1 → v2:
 *   v1 layers may be missing the `presets` field entirely.
 *   v2 requires every layer to carry { enter, continuous, exit }.
 *
 * Behaviour matches the inline migration that used to live in
 * MotionComposer/store.js#restore (pre-P2-3).
 */
function migrateMotionV1ToV2(state) {
  const incomingLayers = Array.isArray(state.layers) ? state.layers : []
  const layers = incomingLayers.map(l => ({
    ...l,
    presets: l?.presets || EMPTY_MOTION_PRESETS(),
  }))
  return { ...state, layers, v: 2 }
}

function normalizeMotion(state) {
  const incomingLayers = Array.isArray(state.layers) ? state.layers : []
  // Defensive: even at v=2, some imported state could be missing `presets`
  // on individual layers (e.g. layers added by `importDesignState` then
  // re-serialized prior to this module — the old restore() also patched
  // them, so we keep that behaviour).
  const needsPatch = incomingLayers.some(l => !l?.presets)
  if (!needsPatch && state.v === SCHEMA_VERSIONS.motion) return state
  return {
    ...state,
    v: SCHEMA_VERSIONS.motion,
    layers: incomingLayers.map(l => ({
      ...l,
      presets: l?.presets || EMPTY_MOTION_PRESETS(),
    })),
  }
}

// ── design ──────────────────────────────────────────────────────────────────

/**
 * NaN/Infinity sanitize for design layer fields.
 *
 * Why this exists:
 *   Konva Transformer 边界条件(多选 + 旋转 + Shift keepRatio + 拖到极小)会
 *   产生 NaN/Infinity transform。客户端代码已经加 safeNum 兜底,但历史已经
 *   被污染的 _designerState 仍存在(同会话内 in-memory 没经过 JSON 序列化所以
 *   NaN 不会变 null;跨会话 JSON.stringify(NaN)='null' 会变 null,某些字段
 *   null 又被代码 || fallback 补上,所以一般跨会话自愈;但 in-memory 同会话
 *   是污染状态)。
 *   这里在 normalize 入口做一次防御性 sanitize,作为最后一道护栏。
 */
const NUMERIC_LAYER_FIELDS = [
  'x', 'y', 'width', 'height', 'rotation',
  'scaleX', 'scaleY', 'opacity',
  'radiusX', 'radiusY', 'radius', 'outerRadius', 'innerRadius',
  'fontSize', 'cornerRadius', 'strokeWidth',
]
const POSITIVE_SIZE_FIELDS = new Set([
  'width', 'height', 'radiusX', 'radiusY', 'radius',
  'outerRadius', 'innerRadius', 'fontSize',
])

function sanitizeObjectNumerics(obj) {
  if (!obj || typeof obj !== 'object') return obj
  let dirty = false
  const patched = { ...obj }
  for (const k of NUMERIC_LAYER_FIELDS) {
    if (k in patched) {
      const v = patched[k]
      if (v != null && !Number.isFinite(v)) {
        // NaN/Infinity:正尺寸字段用安全默认值,坐标/旋转/缩放用 0/1
        if (POSITIVE_SIZE_FIELDS.has(k)) {
          patched[k] = k === 'fontSize' ? 24 : 100
        } else if (k === 'scaleX' || k === 'scaleY' || k === 'opacity') {
          patched[k] = 1
        } else {
          patched[k] = 0
        }
        dirty = true
      }
    }
  }
  // 递归 sanitize children(group/mask)
  if (Array.isArray(patched.children)) {
    const newChildren = patched.children.map(sanitizeObjectNumerics)
    if (newChildren.some((c, i) => c !== patched.children[i])) {
      patched.children = newChildren
      dirty = true
    }
  }
  return dirty ? patched : obj
}

function normalizeDesign(state) {
  // sanitize 所有 objects 的数值字段,防 NaN/Infinity 污染传到 Konva
  let needPatch = false
  let objects = state.objects
  if (Array.isArray(objects)) {
    const sanitized = objects.map(sanitizeObjectNumerics)
    if (sanitized.some((o, i) => o !== objects[i])) {
      objects = sanitized
      needPatch = true
    }
  }
  // canvas 尺寸 / 背景透明度也兜底
  const cw = Number.isFinite(state.canvasWidth) && state.canvasWidth > 0 ? state.canvasWidth : 1920
  const ch = Number.isFinite(state.canvasHeight) && state.canvasHeight > 0 ? state.canvasHeight : 1080
  const bgo = Number.isFinite(state.bgOpacity) ? state.bgOpacity : 1
  const canvasDirty = cw !== state.canvasWidth || ch !== state.canvasHeight || bgo !== state.bgOpacity
  // No structural changes since baseline. Just stamp the version if missing
  // so re-serialization is consistent.
  if (state.v === SCHEMA_VERSIONS.design && !needPatch && !canvasDirty) return state
  return {
    ...state,
    v: SCHEMA_VERSIONS.design,
    ...(needPatch ? { objects } : {}),
    ...(canvasDirty ? { canvasWidth: cw, canvasHeight: ch, bgOpacity: bgo } : {}),
  }
}

// ── video ───────────────────────────────────────────────────────────────────

function normalizeVideo(state) {
  if (state.v === SCHEMA_VERSIONS.video) return state
  return { ...state, v: SCHEMA_VERSIONS.video }
}

// ── skeleton ────────────────────────────────────────────────────────────────

function normalizeSkeleton(state) {
  if (state.v === SCHEMA_VERSIONS.skeleton) return state
  return { ...state, v: SCHEMA_VERSIONS.skeleton }
}
