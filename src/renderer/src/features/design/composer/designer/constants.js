/**
 * DesignComposer — centralized constants
 * All magic numbers, colors, and defaults live here.
 * Change once, applies everywhere.
 */

// ── Canvas defaults ──
export const CANVAS_WIDTH = 1920
export const CANVAS_HEIGHT = 1080
export const CANVAS_BG = '#ffffff'

// ── Theme colors (JS-side, mirrors CSS --accent etc.) ──
export const ACCENT = '#7c6aed'
export const ACCENT_LIGHT = '#a78bfa'
export const ROTATION_COLOR = '#ff3366'
export const DEFAULT_FILL = '#cccccc'
export const DEFAULT_STROKE = '#000000'
export const DARK_BG = '#1a1a1a'

// ── Grid defaults ──
export const GRID_SIZE = 50
export const GRID_COLUMNS = 12
export const GRID_MARGIN = 40
export const GRID_GUTTER = 20
export const GRID_ROWS = 6
export const GRID_ROW_GUTTER = 20
export const GRID_OPACITY = 0.15
export const COLOR_GRID_COLORS = ['#f5f5f5', '#ffffff', '#1a1a1a']

// ── Interaction ──
export const SNAP_DIST = 6
export const UNDO_MAX = 40

// ── Shape defaults ──
export const DEFAULT_WIDTH = 100
export const DEFAULT_HEIGHT = 100
export const DEFAULT_STROKE_WIDTH = 2
export const DEFAULT_CORNER_RADIUS = 0

// ── Text defaults ──
export const TEXT_FONT_SIZE = 24
export const TEXT_FONT_MIN = 8
export const TEXT_FONT_MAX = 200
export const TEXT_LINE_HEIGHT = 1.2
export const TEXT_LETTER_SPACING = 0

// ── Effect defaults ──
export const SHADOW_DEFAULTS = { color: '#000000', blur: 10, offsetX: 4, offsetY: 4, opacity: 0.2 }
export const INNER_GLOW_DEFAULTS = { color: '#ffffff', blur: 8, spread: 0, opacity: 0.6 }
export const OUTER_GLOW_DEFAULTS = { color: ACCENT, blur: 15, spread: 0, opacity: 0.6 }

// ── Image insertion scale factors ──
export const IMG_SCALE_INIT = 0.7
export const IMG_SCALE_INSERT = 0.8
export const IMG_SCALE_DROP = 0.5

// ── Timing (ms) ──
export const MEDIA_LOAD_DELAY = 200
export const AUTO_SAVE_DELAY = 500

// ── Export ──
export const JPEG_QUALITY = 0.92
export const EXPORT_SCALES = [1, 2, 3, 4]

// ── Blend modes ──
export const BLEND_MODES = [
  { value: 'source-over',  label: '正常',     group: '基础' },
  { value: 'darken',       label: '变暗',     group: '变暗' },
  { value: 'multiply',     label: '正片叠底', group: '变暗' },
  { value: 'color-burn',   label: '颜色加深', group: '变暗' },
  { value: 'lighten',      label: '变亮',     group: '变亮' },
  { value: 'screen',       label: '滤色',     group: '变亮' },
  { value: 'color-dodge',  label: '颜色减淡', group: '变亮' },
  { value: 'overlay',      label: '叠加',     group: '对比' },
  { value: 'hard-light',   label: '强光',     group: '对比' },
  { value: 'soft-light',   label: '柔光',     group: '对比' },
  { value: 'difference',   label: '差值',     group: '比较' },
  { value: 'exclusion',    label: '排除',     group: '比较' },
  { value: 'hue',          label: '色相',     group: '色彩' },
  { value: 'saturation',   label: '饱和度',   group: '色彩' },
  { value: 'color',        label: '颜色',     group: '色彩' },
  { value: 'luminosity',   label: '明度',     group: '色彩' },
]

// ── Canvas presets ──
export const CANVAS_PRESETS = [
  { group: '横版', items: [
    { label: '16:9',  w: 1920, h: 1080 },
    { label: '4:3',   w: 1440, h: 1080 },
    { label: '3:2',   w: 1620, h: 1080 },
    { label: '21:9',  w: 2520, h: 1080 },
  ]},
  { group: '竖版', items: [
    { label: '9:16',  w: 1080, h: 1920 },
    { label: '3:4',   w: 1080, h: 1440 },
    { label: '2:3',   w: 1080, h: 1620 },
  ]},
  { group: '方形', items: [
    { label: '1:1',   w: 1080, h: 1080 },
    { label: '1:1 2K', w: 2048, h: 2048 },
  ]},
  { group: '高清', items: [
    { label: '4K 16:9', w: 3840, h: 2160 },
    { label: '2K 16:9', w: 2560, h: 1440 },
    { label: '720p',    w: 1280, h: 720 },
  ]},
]
