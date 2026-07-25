/**
 * MotionComposer — animation presets, easing functions and registry.
 *
 * Preset model (v2 — new schema, used by presetEngine + UI):
 *   PRESETS_LIB[stage][key] = {
 *     label, version, category, layerTypes,
 *     props,           // { [propName]: [from, to] }  — value range to interpolate
 *     controls,        // [propName]                 — which props this preset writes
 *     easing,          // 'easeIn' | 'easeOut' | 'easeInOut' | 'spring' | 'bounceOut' | 'linear'
 *     defaultDuration, // seconds (enter/exit only)
 *     loopDuration,    // seconds (continuous only)
 *     stagger,         // seconds per char (textChar only)
 *     paramsSpec,      // { duration:{min,max,default}, strength:{...}, speed:{...}, delay:{...} }
 *   }
 *
 * stage:
 *   - 'enter'      — once, at layer in-point, progress 0→1 over duration
 *   - 'continuous' — looping while between enter end and exit start
 *   - 'exit'       — once, at layer out-point, progress 0→1 over duration
 *   - 'textChar'   — per-character, only for layer.type === 'text'
 *
 * The legacy ENTER_PRESETS / EXIT_PRESETS / CONTINUOUS_PRESETS / TEXT_ANIM_PRESETS
 * exports are kept so old code keeps compiling, but they should be considered
 * superseded by PRESETS_LIB.
 */

// ────────────────────────────────────────────────────────────────────────
// Legacy exports (kept so any older code paths keep working)
// ────────────────────────────────────────────────────────────────────────

export const ENTER_PRESETS = {
  fadeIn:     { label: '淡入',     props: { opacity: [0, 1] } },
  fadeUp:     { label: '上移淡入', props: { opacity: [0, 1], y: [30, 0] } },
  fadeDown:   { label: '下移淡入', props: { opacity: [0, 1], y: [-30, 0] } },
  fadeLeft:   { label: '左移淡入', props: { opacity: [0, 1], x: [40, 0] } },
  fadeRight:  { label: '右移淡入', props: { opacity: [0, 1], x: [-40, 0] } },
  scaleIn:    { label: '缩放淡入', props: { opacity: [0, 1], scaleX: [0.5, 1], scaleY: [0.5, 1] } },
  bounceIn:   { label: '弹入',     props: { opacity: [0, 1], scaleX: [0.3, 1], scaleY: [0.3, 1] }, easing: 'bounceOut' },
  slideUp:    { label: '上滑入',   props: { y: [60, 0] } },
  slideDown:  { label: '下滑入',   props: { y: [-60, 0] } },
}

export const EXIT_PRESETS = {
  fadeOut:    { label: '淡出',     props: { opacity: [1, 0] } },
  fadeUp:     { label: '上移淡出', props: { opacity: [1, 0], y: [0, -30] } },
  fadeDown:   { label: '下移淡出', props: { opacity: [1, 0], y: [0, 30] } },
  scaleOut:   { label: '缩放淡出', props: { opacity: [1, 0], scaleX: [1, 0.5], scaleY: [1, 0.5] } },
}

export const CONTINUOUS_PRESETS = {
  float:     { label: '浮动',   props: { y: [-5, 5] },   loop: true },
  pulse:     { label: '脉冲',   props: { scaleX: [1, 1.05], scaleY: [1, 1.05] }, loop: true },
  rotate:    { label: '旋转',   props: { rotation: [0, 360] }, loop: true },
  slide:     { label: '平移',   props: { x: [-30, 30] },  loop: true },
  breathe:   { label: '呼吸',   props: { opacity: [1, 0.6] }, loop: true },
}

export const TEXT_ANIM_PRESETS = {
  fadeUp:    { label: '上移淡入', props: { opacity: [0, 1], y: [15, 0] } },
  fadeIn:    { label: '淡入',     props: { opacity: [0, 1] } },
  scaleIn:   { label: '缩放淡入', props: { opacity: [0, 1], scaleX: [0.5, 1], scaleY: [0.5, 1] } },
  typewriter:{ label: '打字机',   props: { opacity: [0, 1] } },
}

// ────────────────────────────────────────────────────────────────────────
// Easing functions: t ∈ [0, 1] → value ∈ [0, 1]
// ────────────────────────────────────────────────────────────────────────

export const EASINGS = {
  linear:    t => t,
  easeIn:    t => t * t * t,
  easeOut:   t => 1 - (1 - t) ** 3,
  easeInOut: t => t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2,
  bounceOut: t => {
    const n1 = 7.5625, d1 = 2.75
    if (t < 1 / d1) return n1 * t * t
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375
    return n1 * (t -= 2.625 / d1) * t + 0.984375
  },
  spring:    t => 1 - Math.cos(t * Math.PI * 2.5) * Math.exp(-6 * t),
  // Continuous-only — periodic 0→1→0 (sine half-wave)
  sine:      t => Math.sin(t * Math.PI),
  // Continuous-only — periodic 0→1→0 (triangle wave)
  triangle:  t => 1 - Math.abs(t * 2 - 1),
}

// ────────────────────────────────────────────────────────────────────────
// PRESETS_LIB v2 — full metadata (extended after Phase 0 research)
// ────────────────────────────────────────────────────────────────────────

// 2026-06-03 round-13:pen 加入 ALL_LAYERS — pen / path 的预设都是改 x/y/scale/rotation/
// opacity,跟 type 无关;之前漏掉 pen 导致 pen 图层选不到任何入场/持续/出场预设。
const ALL_LAYERS = ['rect', 'ellipse', 'text', 'image', 'video', 'line', 'path', 'pen', 'star', 'polygon', 'gear']
const TEXT_ONLY = ['text']

const STD_DURATION_SPEC = { min: 0.2, max: 2.0, default: 0.6 }
const STD_STRENGTH_SPEC = { min: 0.3, max: 2.5, default: 1.0 }
const STD_SPEED_SPEC    = { min: 0.3, max: 3.0, default: 1.0 }
const STD_DELAY_SPEC    = { min: 0.0, max: 1.0, default: 0.0 }

const enterParams = {
  duration: STD_DURATION_SPEC,
  strength: STD_STRENGTH_SPEC,
  delay: STD_DELAY_SPEC,
}
const exitParams = {
  duration: STD_DURATION_SPEC,
  strength: STD_STRENGTH_SPEC,
}
const continuousParams = {
  speed: STD_SPEED_SPEC,
  strength: STD_STRENGTH_SPEC,
}
const textCharParams = {
  duration: STD_DURATION_SPEC,
  strength: STD_STRENGTH_SPEC,
  stagger: { min: 0.01, max: 0.3, default: 0.05 },
}

export const PRESETS_LIB = {
  // ── ENTER ────────────────────────────────────────────────────────────
  enter: {
    fadeIn: {
      label: '淡入', version: 1, category: 'basic', layerTypes: ALL_LAYERS,
      props: { opacity: [0, 1] }, controls: ['opacity'],
      easing: 'easeOut', defaultDuration: 0.5, paramsSpec: enterParams,
    },
    fadeUp: {
      label: '上移淡入', version: 1, category: 'basic', layerTypes: ALL_LAYERS,
      props: { opacity: [0, 1], y: [30, 0] }, controls: ['opacity', 'y'],
      easing: 'easeOut', defaultDuration: 0.6, paramsSpec: enterParams,
    },
    fadeDown: {
      label: '下移淡入', version: 1, category: 'basic', layerTypes: ALL_LAYERS,
      props: { opacity: [0, 1], y: [-30, 0] }, controls: ['opacity', 'y'],
      easing: 'easeOut', defaultDuration: 0.6, paramsSpec: enterParams,
    },
    fadeLeft: {
      label: '左移淡入', version: 1, category: 'basic', layerTypes: ALL_LAYERS,
      props: { opacity: [0, 1], x: [40, 0] }, controls: ['opacity', 'x'],
      easing: 'easeOut', defaultDuration: 0.6, paramsSpec: enterParams,
    },
    fadeRight: {
      label: '右移淡入', version: 1, category: 'basic', layerTypes: ALL_LAYERS,
      props: { opacity: [0, 1], x: [-40, 0] }, controls: ['opacity', 'x'],
      easing: 'easeOut', defaultDuration: 0.6, paramsSpec: enterParams,
    },
    scaleIn: {
      label: '缩放淡入', version: 1, category: 'basic', layerTypes: ALL_LAYERS,
      props: { opacity: [0, 1], scaleX: [0.5, 1], scaleY: [0.5, 1] }, controls: ['opacity', 'scaleX', 'scaleY'],
      easing: 'easeOut', defaultDuration: 0.6, paramsSpec: enterParams,
    },
    bounceIn: {
      label: '弹入', version: 1, category: 'bouncy', layerTypes: ALL_LAYERS,
      props: { opacity: [0, 1], scaleX: [0.3, 1], scaleY: [0.3, 1] }, controls: ['opacity', 'scaleX', 'scaleY'],
      easing: 'bounceOut', defaultDuration: 0.7, paramsSpec: enterParams,
    },
    springIn: {
      label: '弹簧入', version: 1, category: 'bouncy', layerTypes: ALL_LAYERS,
      props: { opacity: [0, 1], scaleX: [0.6, 1], scaleY: [0.6, 1] }, controls: ['opacity', 'scaleX', 'scaleY'],
      easing: 'spring', defaultDuration: 0.8, paramsSpec: enterParams,
    },
    popIn: {
      label: '弹跳入', version: 1, category: 'bouncy', layerTypes: ALL_LAYERS,
      props: { opacity: [0, 1], scaleX: [0.0, 1], scaleY: [0.0, 1] }, controls: ['opacity', 'scaleX', 'scaleY'],
      easing: 'bounceOut', defaultDuration: 0.6, paramsSpec: enterParams,
    },
    slideUp: {
      label: '上滑入', version: 1, category: 'basic', layerTypes: ALL_LAYERS,
      props: { y: [60, 0] }, controls: ['y'],
      easing: 'easeOut', defaultDuration: 0.5, paramsSpec: enterParams,
    },
    slideDown: {
      label: '下滑入', version: 1, category: 'basic', layerTypes: ALL_LAYERS,
      props: { y: [-60, 0] }, controls: ['y'],
      easing: 'easeOut', defaultDuration: 0.5, paramsSpec: enterParams,
    },
    slideLeft: {
      label: '左滑入', version: 1, category: 'basic', layerTypes: ALL_LAYERS,
      props: { x: [80, 0] }, controls: ['x'],
      easing: 'easeOut', defaultDuration: 0.5, paramsSpec: enterParams,
    },
    slideRight: {
      label: '右滑入', version: 1, category: 'basic', layerTypes: ALL_LAYERS,
      props: { x: [-80, 0] }, controls: ['x'],
      easing: 'easeOut', defaultDuration: 0.5, paramsSpec: enterParams,
    },
    zoomBlast: {
      label: '冲击放大', version: 1, category: 'dramatic', layerTypes: ALL_LAYERS,
      props: { opacity: [0, 1], scaleX: [1.6, 1], scaleY: [1.6, 1] }, controls: ['opacity', 'scaleX', 'scaleY'],
      easing: 'easeOut', defaultDuration: 0.45, paramsSpec: enterParams,
    },
    spinIn: {
      label: '旋转入', version: 1, category: 'dramatic', layerTypes: ALL_LAYERS,
      props: { opacity: [0, 1], rotation: [-180, 0], scaleX: [0.4, 1], scaleY: [0.4, 1] },
      controls: ['opacity', 'rotation', 'scaleX', 'scaleY'],
      easing: 'easeOut', defaultDuration: 0.7, paramsSpec: enterParams,
    },
    flipIn: {
      label: '翻转入', version: 1, category: 'dramatic', layerTypes: ALL_LAYERS,
      props: { opacity: [0, 1], scaleY: [0.0, 1] }, controls: ['opacity', 'scaleY'],
      easing: 'easeOut', defaultDuration: 0.6, paramsSpec: enterParams,
    },
    smoothFadeUp: {
      label: '柔和上移', version: 1, category: 'elegant', layerTypes: ALL_LAYERS,
      props: { opacity: [0, 1], y: [12, 0] }, controls: ['opacity', 'y'],
      easing: 'easeInOut', defaultDuration: 0.9, paramsSpec: enterParams,
    },
    gentleScale: {
      label: '柔和缩放', version: 1, category: 'elegant', layerTypes: ALL_LAYERS,
      props: { opacity: [0, 1], scaleX: [0.92, 1], scaleY: [0.92, 1] }, controls: ['opacity', 'scaleX', 'scaleY'],
      easing: 'easeOut', defaultDuration: 0.8, paramsSpec: enterParams,
    },
    rubberIn: {
      label: '橡胶入', version: 1, category: 'playful', layerTypes: ALL_LAYERS,
      props: { opacity: [0, 1], scaleX: [1.3, 1], scaleY: [0.6, 1] }, controls: ['opacity', 'scaleX', 'scaleY'],
      easing: 'bounceOut', defaultDuration: 0.7, paramsSpec: enterParams,
    },
    wobbleIn: {
      label: '摇摆入', version: 1, category: 'playful', layerTypes: ALL_LAYERS,
      props: { opacity: [0, 1], rotation: [15, 0], x: [-20, 0] }, controls: ['opacity', 'rotation', 'x'],
      easing: 'spring', defaultDuration: 0.7, paramsSpec: enterParams,
    },
  },

  // ── EXIT ─────────────────────────────────────────────────────────────
  exit: {
    fadeOut: {
      label: '淡出', version: 1, category: 'basic', layerTypes: ALL_LAYERS,
      props: { opacity: [1, 0] }, controls: ['opacity'],
      easing: 'easeIn', defaultDuration: 0.5, paramsSpec: exitParams,
    },
    fadeUp: {
      label: '上移淡出', version: 1, category: 'basic', layerTypes: ALL_LAYERS,
      props: { opacity: [1, 0], y: [0, -30] }, controls: ['opacity', 'y'],
      easing: 'easeIn', defaultDuration: 0.5, paramsSpec: exitParams,
    },
    fadeDown: {
      label: '下移淡出', version: 1, category: 'basic', layerTypes: ALL_LAYERS,
      props: { opacity: [1, 0], y: [0, 30] }, controls: ['opacity', 'y'],
      easing: 'easeIn', defaultDuration: 0.5, paramsSpec: exitParams,
    },
    fadeLeft: {
      label: '左移淡出', version: 1, category: 'basic', layerTypes: ALL_LAYERS,
      props: { opacity: [1, 0], x: [0, -40] }, controls: ['opacity', 'x'],
      easing: 'easeIn', defaultDuration: 0.5, paramsSpec: exitParams,
    },
    fadeRight: {
      label: '右移淡出', version: 1, category: 'basic', layerTypes: ALL_LAYERS,
      props: { opacity: [1, 0], x: [0, 40] }, controls: ['opacity', 'x'],
      easing: 'easeIn', defaultDuration: 0.5, paramsSpec: exitParams,
    },
    scaleOut: {
      label: '缩放淡出', version: 1, category: 'basic', layerTypes: ALL_LAYERS,
      props: { opacity: [1, 0], scaleX: [1, 0.5], scaleY: [1, 0.5] }, controls: ['opacity', 'scaleX', 'scaleY'],
      easing: 'easeIn', defaultDuration: 0.5, paramsSpec: exitParams,
    },
    zoomBlastOut: {
      label: '冲击放大出', version: 1, category: 'dramatic', layerTypes: ALL_LAYERS,
      props: { opacity: [1, 0], scaleX: [1, 1.6], scaleY: [1, 1.6] }, controls: ['opacity', 'scaleX', 'scaleY'],
      easing: 'easeIn', defaultDuration: 0.45, paramsSpec: exitParams,
    },
    spinOut: {
      label: '旋转出', version: 1, category: 'dramatic', layerTypes: ALL_LAYERS,
      props: { opacity: [1, 0], rotation: [0, 180], scaleX: [1, 0.4], scaleY: [1, 0.4] },
      controls: ['opacity', 'rotation', 'scaleX', 'scaleY'],
      easing: 'easeIn', defaultDuration: 0.6, paramsSpec: exitParams,
    },
    flipOut: {
      label: '翻转出', version: 1, category: 'dramatic', layerTypes: ALL_LAYERS,
      props: { opacity: [1, 0], scaleY: [1, 0] }, controls: ['opacity', 'scaleY'],
      easing: 'easeIn', defaultDuration: 0.5, paramsSpec: exitParams,
    },
    shrinkOut: {
      label: '缩小消失', version: 1, category: 'elegant', layerTypes: ALL_LAYERS,
      props: { opacity: [1, 0], scaleX: [1, 0.85], scaleY: [1, 0.85] }, controls: ['opacity', 'scaleX', 'scaleY'],
      easing: 'easeIn', defaultDuration: 0.7, paramsSpec: exitParams,
    },
    gentleFade: {
      label: '柔和淡出', version: 1, category: 'elegant', layerTypes: ALL_LAYERS,
      props: { opacity: [1, 0] }, controls: ['opacity'],
      easing: 'easeInOut', defaultDuration: 0.9, paramsSpec: exitParams,
    },
    slideOff: {
      label: '滑出', version: 1, category: 'basic', layerTypes: ALL_LAYERS,
      props: { x: [0, 80] }, controls: ['x'],
      easing: 'easeIn', defaultDuration: 0.5, paramsSpec: exitParams,
    },
  },

  // ── CONTINUOUS (loop) ────────────────────────────────────────────────
  // For continuous, easing is applied to a periodic 0→1→0 phase (sine recommended).
  continuous: {
    float: {
      label: '浮动', version: 1, category: 'subtle', layerTypes: ALL_LAYERS,
      props: { y: [-5, 5] }, controls: ['y'],
      easing: 'sine', loopDuration: 2.0, paramsSpec: continuousParams,
    },
    pulse: {
      label: '脉冲', version: 1, category: 'subtle', layerTypes: ALL_LAYERS,
      props: { scaleX: [1, 1.05], scaleY: [1, 1.05] }, controls: ['scaleX', 'scaleY'],
      easing: 'sine', loopDuration: 1.2, paramsSpec: continuousParams,
    },
    breathe: {
      label: '呼吸', version: 1, category: 'subtle', layerTypes: ALL_LAYERS,
      props: { opacity: [1, 0.6] }, controls: ['opacity'],
      easing: 'sine', loopDuration: 2.5, paramsSpec: continuousParams,
    },
    sway: {
      label: '摇摆', version: 1, category: 'subtle', layerTypes: ALL_LAYERS,
      props: { rotation: [-3, 3] }, controls: ['rotation'],
      easing: 'sine', loopDuration: 2.5, paramsSpec: continuousParams,
    },
    bob: {
      label: '点头', version: 1, category: 'subtle', layerTypes: ALL_LAYERS,
      props: { y: [-3, 3], rotation: [-1.5, 1.5] }, controls: ['y', 'rotation'],
      easing: 'sine', loopDuration: 1.6, paramsSpec: continuousParams,
    },
    rotate: {
      label: '旋转', version: 1, category: 'continuous', layerTypes: ALL_LAYERS,
      props: { rotation: [0, 360] }, controls: ['rotation'],
      easing: 'linear', loopDuration: 4.0, paramsSpec: continuousParams,
    },
    driftX: {
      label: '左右漂移', version: 1, category: 'continuous', layerTypes: ALL_LAYERS,
      props: { x: [-30, 30] }, controls: ['x'],
      easing: 'sine', loopDuration: 4.0, paramsSpec: continuousParams,
    },
    driftY: {
      label: '上下漂移', version: 1, category: 'continuous', layerTypes: ALL_LAYERS,
      props: { y: [-25, 25] }, controls: ['y'],
      easing: 'sine', loopDuration: 4.0, paramsSpec: continuousParams,
    },
    heartbeat: {
      label: '心跳', version: 1, category: 'attention', layerTypes: ALL_LAYERS,
      props: { scaleX: [1, 1.12], scaleY: [1, 1.12] }, controls: ['scaleX', 'scaleY'],
      easing: 'triangle', loopDuration: 0.9, paramsSpec: continuousParams,
    },
    wobble: {
      label: '摇晃', version: 1, category: 'attention', layerTypes: ALL_LAYERS,
      props: { rotation: [-8, 8], x: [-3, 3] }, controls: ['rotation', 'x'],
      easing: 'triangle', loopDuration: 0.6, paramsSpec: continuousParams,
    },
    glow: {
      label: '微光', version: 1, category: 'attention', layerTypes: ALL_LAYERS,
      props: { opacity: [1, 0.85] }, controls: ['opacity'],
      easing: 'sine', loopDuration: 1.4, paramsSpec: continuousParams,
    },
  },

  // ── TEXT-CHAR (per-character, text-only) ─────────────────────────────
  textChar: {
    typewriter: {
      label: '打字机', version: 1, category: 'classic', layerTypes: TEXT_ONLY,
      props: { opacity: [0, 1] }, controls: ['opacity'],
      easing: 'linear', stagger: 0.05, defaultDuration: 0.05, paramsSpec: textCharParams,
    },
    fadeInChar: {
      label: '逐字淡入', version: 1, category: 'classic', layerTypes: TEXT_ONLY,
      props: { opacity: [0, 1] }, controls: ['opacity'],
      easing: 'easeOut', stagger: 0.04, defaultDuration: 0.4, paramsSpec: textCharParams,
    },
    riseInChar: {
      label: '逐字上飞', version: 1, category: 'classic', layerTypes: TEXT_ONLY,
      props: { opacity: [0, 1], y: [12, 0] }, controls: ['opacity', 'y'],
      easing: 'easeOut', stagger: 0.04, defaultDuration: 0.5, paramsSpec: textCharParams,
    },
    bounceLetter: {
      label: '逐字弹跳', version: 1, category: 'playful', layerTypes: TEXT_ONLY,
      props: { opacity: [0, 1], scaleX: [0.4, 1], scaleY: [0.4, 1] }, controls: ['opacity', 'scaleX', 'scaleY'],
      easing: 'bounceOut', stagger: 0.05, defaultDuration: 0.5, paramsSpec: textCharParams,
    },
    flipLetter: {
      label: '逐字翻转', version: 1, category: 'dramatic', layerTypes: TEXT_ONLY,
      props: { opacity: [0, 1], scaleY: [0, 1] }, controls: ['opacity', 'scaleY'],
      easing: 'easeOut', stagger: 0.05, defaultDuration: 0.5, paramsSpec: textCharParams,
    },
    explodeIn: {
      label: '中心爆开', version: 1, category: 'dramatic', layerTypes: TEXT_ONLY,
      props: { opacity: [0, 1], scaleX: [0, 1], scaleY: [0, 1] }, controls: ['opacity', 'scaleX', 'scaleY'],
      easing: 'easeOut', stagger: 0.03, defaultDuration: 0.45, paramsSpec: textCharParams,
    },
    focusIn: {
      label: '聚焦入', version: 1, category: 'elegant', layerTypes: TEXT_ONLY,
      props: { opacity: [0, 1], scaleX: [1.4, 1], scaleY: [1.4, 1] }, controls: ['opacity', 'scaleX', 'scaleY'],
      easing: 'easeOut', stagger: 0.05, defaultDuration: 0.6, paramsSpec: textCharParams,
    },
    slamIn: {
      label: '逐字砸入', version: 1, category: 'dramatic', layerTypes: TEXT_ONLY,
      props: { opacity: [0, 1], y: [-30, 0], scaleX: [1.3, 1], scaleY: [1.3, 1] },
      controls: ['opacity', 'y', 'scaleX', 'scaleY'],
      easing: 'easeOut', stagger: 0.04, defaultDuration: 0.4, paramsSpec: textCharParams,
    },
    waveText: {
      label: '波浪起伏', version: 1, category: 'playful', layerTypes: TEXT_ONLY,
      props: { y: [-6, 6] }, controls: ['y'],
      easing: 'sine', stagger: 0.06, loopDuration: 1.2, paramsSpec: textCharParams,
    },
    splitFade: {
      label: '分裂淡入', version: 1, category: 'elegant', layerTypes: TEXT_ONLY,
      props: { opacity: [0, 1], y: [6, 0] }, controls: ['opacity', 'y'],
      easing: 'easeOut', stagger: 0.07, defaultDuration: 0.45, paramsSpec: textCharParams,
    },
  },
}

// Stages and their default param shape ────────────────────────────────────
// (used by store when applying a preset for the first time)
function defaultParamsForStage(stage) {
  switch (stage) {
    case 'enter':      return { duration: STD_DURATION_SPEC.default, delay: 0, strength: 1 }
    case 'continuous': return { speed: 1, strength: 1 }
    case 'exit':       return { duration: STD_DURATION_SPEC.default, strength: 1 }
    default:           return {}
  }
}

/**
 * Get the data record for a single preset, with current schema.
 * Returns `null` if not found.
 */
export function getPresetMeta(stage, name) {
  if (!stage || !name) return null
  const map = PRESETS_LIB[stage]
  if (!map) return null
  return map[name] || null
}

/**
 * Build the default config object that is stored on `layer.presets[stage]`
 * when a preset is first applied. Returns `null` if invalid.
 */
export function getPresetDefault(stage, name, layerType) {
  const meta = getPresetMeta(stage, name)
  if (!meta) return null
  // Layer type compatibility check
  if (meta.layerTypes && meta.layerTypes.length && !meta.layerTypes.includes('all')
      && layerType && !meta.layerTypes.includes(layerType)) return null

  const cfg = { name, ...defaultParamsForStage(stage) }
  if (stage === 'enter' || stage === 'exit') {
    cfg.duration = meta.defaultDuration ?? cfg.duration
  }
  return cfg
}

/**
 * Returns array of preset entries for a given stage, optionally filtered by layer type.
 *  [{ name, label, category, ...meta }]
 */
export function getPresetsByStage(stage, layerType) {
  const map = PRESETS_LIB[stage]
  if (!map) return []
  const out = []
  for (const [name, meta] of Object.entries(map)) {
    if (layerType && meta.layerTypes && meta.layerTypes.length
        && !meta.layerTypes.includes('all')
        && !meta.layerTypes.includes(layerType)) continue
    out.push({ name, ...meta })
  }
  return out
}

/**
 * Whether a layer type supports per-character text animations.
 */
export function supportsTextChar(layerType) {
  return layerType === 'text'
}

// Legacy helper kept for any old callers
export function getPresetData(type, name) {
  const map = type === 'enter' ? ENTER_PRESETS
            : type === 'exit'  ? EXIT_PRESETS
            : type === 'textChar' ? TEXT_ANIM_PRESETS
            : CONTINUOUS_PRESETS
  return map[name] || null
}
