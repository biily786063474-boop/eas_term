/**
 * MotionComposer — preset animation "filter layer".
 *
 * Sits between keyframe interpolation and shape rendering.
 * Given the base props produced by `interpolateKeyframes`, applies any
 * enter/continuous/exit preset attached to the layer and returns the
 * final transform props.
 *
 * Design:
 *   - Presets do NOT write back into keyframes — they're additive at render time.
 *   - 3 stage timeline:
 *       [0 .. enterEnd)        → enter preset (one-shot, progress 0→1)
 *       [enterEnd .. exitStart) → continuous preset (loops)
 *       [exitStart .. duration] → exit preset (one-shot, progress 0→1)
 *   - Property composition:
 *       - opacity: enter/exit use MAX over base (so a kf opacity:0 doesn't lock the preset out).
 *                  continuous uses MULTIPLICATION (allows simultaneous fade-in over breathing).
 *       - x, y, rotation: ADDITIVE — preset delta added to base value.
 *       - scaleX, scaleY: MULTIPLICATIVE — preset factor times base scale.
 *   - continuous → exit smoothing: when entering exit, the continuous delta is
 *     "fed in" as the start point so we don't snap back to zero — only for
 *     properties continuous controls but exit doesn't.
 *   - Layer-duration clamp: if enter+exit > layerDuration, both shrink proportionally.
 */
import { PRESETS_LIB, EASINGS, getPresetMeta } from './presets'

const TRANSFORM_KEYS = ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'opacity']

const ZERO_DELTA = Object.freeze({
  x: 0, y: 0, rotation: 0,
  scaleX: 1, scaleY: 1,
  opacity: 1,
  // _opacityMode is informational only — 'mul' (multiply against base)
  // or 'cover' (preset takes precedence via max). Default 'mul'.
})

// ────────────────────────────────────────────────────────────────────────
// Shared helpers
// ────────────────────────────────────────────────────────────────────────

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v }
function lerp(a, b, t) { return a + (b - a) * t }

function getEasing(meta, fallback = 'easeOut') {
  const fn = EASINGS[meta?.easing] || EASINGS[fallback] || EASINGS.linear
  return fn
}

// Initial delta: identity (no transform / multiplicative 1)
function makeDelta() {
  return { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, _opacityMode: 'mul' }
}

// Apply user-tunable strength scalar to a `from→to` range:
// from stays at "displaced" extreme, but scaled by strength. (e.g. strength=2
// means a y:[30,0] becomes y:[60,0])
function rangeWithStrength(range, strength) {
  if (!range || range.length !== 2) return [0, 0]
  const [from, to] = range
  const s = strength == null ? 1 : strength
  // Strength only stretches the "displaced" side relative to the rest position.
  // For most presets `to` is the rest value, so we displace `from` away from `to`.
  return [to + (from - to) * s, to]
}

// Same idea for exit: from = rest (1), to = displaced. We displace `to` further.
function rangeWithStrengthExit(range, strength) {
  if (!range || range.length !== 2) return [0, 0]
  const [from, to] = range
  const s = strength == null ? 1 : strength
  return [from, from + (to - from) * s]
}

// ────────────────────────────────────────────────────────────────────────
// Stage delta calculators
// ────────────────────────────────────────────────────────────────────────

// One-shot (enter / exit): progress 0→1 mapped via easing, then per-prop
// interpolation between [from*strength, to] (for enter) or [from, to*strength]
// (for exit). Returns delta values in the same units the renderer composes.
function calcOneShotDelta(meta, params, progress, isExit) {
  const delta = makeDelta()
  if (!meta || !meta.props) return delta

  const eased = getEasing(meta)(clamp01(progress))
  const strength = params?.strength ?? 1

  for (const [prop, range] of Object.entries(meta.props)) {
    const r = isExit ? rangeWithStrengthExit(range, strength) : rangeWithStrength(range, strength)
    const v = lerp(r[0], r[1], eased)
    if (prop === 'opacity') {
      delta.opacity = clamp01(v)
      delta._opacityMode = 'cover' // enter/exit override base opacity (max policy)
    } else if (prop === 'scaleX' || prop === 'scaleY') {
      // For scale: stored as MULTIPLIER vs base scale. The range itself is in
      // "scale relative to rest=1", so we use `v` directly as multiplier.
      delta[prop] = v
    } else if (prop === 'x' || prop === 'y' || prop === 'rotation') {
      // For these props, the rest value of the range (`to` for enter / `from` for exit)
      // is conventionally 0 — we want the OFFSET from rest, not the absolute value.
      // Compute as: offset = v - restValue.
      const restVal = isExit ? range[0] : range[1]
      delta[prop] = v - restVal
    } else {
      delta[prop] = v
    }
  }
  return delta
}

// Continuous: progress is `(localTime / loopDuration) % 1` mapped to a
// periodic 0→1→0 curve via easing (sine/triangle preferred). Returns delta
// where opacity is "multiplier vs base", and translation/rotation are offsets.
function calcContinuousDelta(meta, params, periodTime) {
  const delta = makeDelta()
  if (!meta || !meta.props) return delta

  const speed = params?.speed ?? 1
  const strength = params?.strength ?? 1
  const period = Math.max(0.05, (meta.loopDuration || 1) / speed)
  const phase = ((periodTime % period) + period) % period / period // 0..1
  const eased = getEasing(meta, 'sine')(phase)

  for (const [prop, range] of Object.entries(meta.props)) {
    const [from, to] = range
    // For continuous loop, treat range as oscillation extremes; "rest" is the
    // midpoint. Easing provides the 0→1→0 shape. Output offset/multiplier from rest.
    const mid = (from + to) / 2
    const halfAmp = (to - from) / 2 * strength
    // eased ∈ [0,1] (sine/triangle reach 1 at midpoint, 0 at edges)
    // We want oscillation around mid: signedAmp = (eased * 2 - 1) * halfAmp
    const signedAmp = (eased * 2 - 1) * halfAmp
    const v = mid + signedAmp

    if (prop === 'opacity') {
      // Rest opacity assumed 1; multiplier = current / 1 = v
      delta.opacity = clamp01(v)
      delta._opacityMode = 'mul'
    } else if (prop === 'scaleX' || prop === 'scaleY') {
      // Rest scale assumed 1; multiplier = v
      delta[prop] = v
    } else if (prop === 'x' || prop === 'y' || prop === 'rotation') {
      // Offset from rest (treat mid as rest if range spans rest, else use 0)
      delta[prop] = v
    }
  }
  return delta
}

// ────────────────────────────────────────────────────────────────────────
// Stage timeline + composition
// ────────────────────────────────────────────────────────────────────────

/**
 * Compute clamped-and-resolved stage durations so enter+exit ≤ layerDuration.
 * Leaves at least 0.05s for continuous when both enter and exit are present.
 */
function resolveStageDurations(presets, layerDuration) {
  const enterDur = presets.enter ? Math.max(0, presets.enter.duration || 0) : 0
  const exitDur  = presets.exit  ? Math.max(0, presets.exit.duration  || 0) : 0
  const min = 0.05 // small buffer between enter and exit
  const total = enterDur + exitDur + (presets.continuous ? min : 0)

  if (layerDuration <= 0 || total <= layerDuration) {
    return { enterDur, exitDur }
  }
  // Shrink enter and exit proportionally
  const slack = Math.max(0, layerDuration - (presets.continuous ? min : 0))
  const k = slack / (enterDur + exitDur || 1)
  return { enterDur: enterDur * k, exitDur: exitDur * k }
}

/**
 * Apply preset filter layer on top of base props.
 *
 *   baseProps      — output of computeAnimatedProps (already has interpolated keyframes)
 *   layer          — full layer object (we read layer.presets)
 *   localTime      — time relative to layer.inPoint
 *   layerDuration  — outPoint - inPoint
 *
 * Returns a NEW object with the same shape as baseProps but with preset deltas applied.
 * If the layer has no presets at all, returns baseProps unchanged (zero-cost).
 */
export function applyPresetDelta(baseProps, layer, localTime, layerDuration) {
  const presets = layer?.presets
  if (!presets) return baseProps
  if (!presets.enter && !presets.continuous && !presets.exit) return baseProps

  // Handle delay (enter only): t is shifted so the preset starts later
  const enterDelay = presets.enter?.delay || 0
  const t = Math.max(0, localTime - enterDelay)

  const { enterDur, exitDur } = resolveStageDurations(presets, layerDuration)
  const exitStart = Math.max(enterDur, layerDuration - exitDur)

  // ── Pick the active stage ─────────────────────────────────────────────
  let stage = 'continuous'
  let stageProgress = 0
  if (presets.enter && t < enterDur) {
    stage = 'enter'
    stageProgress = enterDur > 0 ? (t / enterDur) : 1
  } else if (presets.exit && localTime >= exitStart) {
    stage = 'exit'
    stageProgress = exitDur > 0 ? ((localTime - exitStart) / exitDur) : 1
  }

  // ── Compute deltas for active stage(s) ───────────────────────────────
  // Continuous always runs in the background (between enterEnd and exitStart);
  // its computed value at the moment of stage transition is preserved as
  // "starting point" for exit smoothing.
  const continuousMeta = presets.continuous ? getPresetMeta('continuous', presets.continuous.name) : null
  const continuousDelta = continuousMeta
    ? calcContinuousDelta(continuousMeta, presets.continuous, t - enterDur)
    : null

  let activeDelta = makeDelta()
  if (stage === 'enter') {
    const meta = getPresetMeta('enter', presets.enter.name)
    activeDelta = calcOneShotDelta(meta, presets.enter, stageProgress, false)
  } else if (stage === 'exit') {
    const meta = getPresetMeta('exit', presets.exit.name)
    const exitDelta = calcOneShotDelta(meta, presets.exit, stageProgress, true)
    activeDelta = exitDelta

    // Smooth handover from continuous → exit for properties continuous controls
    // but exit does NOT control. Lerp from continuous current → 0/identity
    // over exit progress.
    if (continuousDelta && continuousMeta) {
      const exitCtrl = new Set(meta?.controls || [])
      const contCtrl = continuousMeta.controls || []
      for (const prop of contCtrl) {
        if (exitCtrl.has(prop)) continue
        const restVal = (prop === 'scaleX' || prop === 'scaleY' || prop === 'opacity') ? 1 : 0
        const startVal = continuousDelta[prop]
        const blended = lerp(startVal, restVal, clamp01(stageProgress))
        activeDelta[prop] = blended
        if (prop === 'opacity') activeDelta._opacityMode = 'mul'
      }
    }
  } else {
    // continuous active (or no preset for current zone)
    activeDelta = continuousDelta || makeDelta()
  }

  // ── Compose with baseProps ───────────────────────────────────────────
  return composeWithBase(baseProps, activeDelta)
}

function composeWithBase(base, delta) {
  const out = { ...base }
  out.x = (base.x ?? 0) + (delta.x ?? 0)
  out.y = (base.y ?? 0) + (delta.y ?? 0)
  out.rotation = (base.rotation ?? 0) + (delta.rotation ?? 0)
  out.scaleX = (base.scaleX ?? 1) * (delta.scaleX ?? 1)
  out.scaleY = (base.scaleY ?? 1) * (delta.scaleY ?? 1)

  const baseOpacity = base.opacity ?? 1
  if (delta._opacityMode === 'cover') {
    // enter/exit: preset wins via max so a kf opacity=0 doesn't lock us out
    out.opacity = Math.max(baseOpacity, delta.opacity ?? 1)
    // But during exit, we also want to allow fade-out below base
    // The "cover" semantic for exit is: progress 0 → opacity = base, progress 1 → opacity = 0
    // calcOneShotDelta already produces that linear range in delta.opacity, so:
    if (delta.opacity != null && delta.opacity < baseOpacity) {
      out.opacity = delta.opacity
    }
  } else {
    out.opacity = baseOpacity * (delta.opacity ?? 1)
  }
  out.opacity = clamp01(out.opacity)
  return out
}

// ────────────────────────────────────────────────────────────────────────
// Per-character variant (for text layers with textChar preset)
// ────────────────────────────────────────────────────────────────────────

/**
 * Compute a per-character delta for text layers. Each character starts its
 * animation `charIndex * stagger` seconds after the layer's enter delay.
 *
 *   charIndex     — 0-based char index
 *   totalChars    — for normalizing (currently unused, available for future presets)
 *   layer         — layer object (reads layer.presets.enter / exit / continuous)
 *   localTime     — layer-local time
 *   layerDuration — outPoint - inPoint
 *
 * Returns a delta object compatible with composeWithBase. If no textChar-style
 * preset is active, returns the same delta as the layer-level applyPresetDelta
 * would (so the renderer can use it uniformly).
 */
export function applyCharPresetDelta(charIndex, totalChars, layer, localTime, layerDuration) {
  const presets = layer?.presets
  if (!presets) return null

  // textChar presets live in PRESETS_LIB.textChar but are referenced via
  // `presets.enter.name = '<key>'` IF that key exists in textChar.
  // For convenience, we try each stage and prefer textChar metadata when present.
  const tryStage = (stageKey) => {
    const cfg = presets[stageKey]
    if (!cfg) return null
    const charMeta = PRESETS_LIB.textChar?.[cfg.name]
    if (charMeta) return { stageKey, cfg, meta: charMeta }
    return null
  }

  const enterChar = tryStage('enter')
  const exitChar  = tryStage('exit')
  const contChar  = tryStage('continuous')

  // No textChar-style preset → fall back to layer-level delta (so all chars
  // animate together as a block — visually identical to the renderer doing
  // a single transform).
  if (!enterChar && !exitChar && !contChar) {
    return null
  }

  const stagger = (enterChar?.cfg.stagger ?? enterChar?.meta.stagger ?? 0.05)
  const charDelay = charIndex * stagger
  const tEnter = Math.max(0, localTime - charDelay - (presets.enter?.delay || 0))

  // For simplicity per-char we only handle: textChar enter (most common),
  // textChar exit (mirror at end), textChar continuous (waveText etc).
  // Else fall back to identity.
  let delta = makeDelta()

  if (enterChar) {
    const dur = enterChar.cfg.duration ?? enterChar.meta.defaultDuration ?? 0.4
    if (tEnter < dur) {
      const progress = dur > 0 ? clamp01(tEnter / dur) : 1
      delta = calcOneShotDelta(enterChar.meta, enterChar.cfg, progress, false)
      return delta
    }
  }

  if (exitChar) {
    const exitDur = exitChar.cfg.duration ?? exitChar.meta.defaultDuration ?? 0.4
    const exitStart = layerDuration - exitDur - (totalChars - 1 - charIndex) * stagger
    if (localTime >= exitStart) {
      const progress = exitDur > 0 ? clamp01((localTime - exitStart) / exitDur) : 1
      return calcOneShotDelta(exitChar.meta, exitChar.cfg, progress, true)
    }
  }

  if (contChar) {
    // Use char index as phase offset so neighbouring chars are out-of-phase
    const period = Math.max(0.1, (contChar.meta.loopDuration || 1.2) / (contChar.cfg.speed ?? 1))
    const phaseT = (localTime + charIndex * stagger) % period
    return calcContinuousDelta(contChar.meta, contChar.cfg, phaseT)
  }

  return delta // identity
}

/**
 * Convenience: blend a base props object with a per-char delta.
 * Used by renderer's text drawing path.
 */
export function composeCharProps(baseProps, charDelta) {
  if (!charDelta) return baseProps
  return composeWithBase(baseProps, charDelta)
}

/**
 * Tells the renderer whether a layer needs the per-character drawing path
 * (i.e. has at least one `textChar` preset attached).
 */
export function needsCharRendering(layer) {
  if (!layer || layer.type !== 'text') return false
  const p = layer.presets
  if (!p) return false
  for (const stage of ['enter', 'continuous', 'exit']) {
    const cfg = p[stage]
    if (cfg && PRESETS_LIB.textChar?.[cfg.name]) return true
  }
  return false
}
