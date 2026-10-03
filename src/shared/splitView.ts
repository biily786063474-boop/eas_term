// 插件发布分屏（panel/split.open）请求里的一格。shared 层：宿主判定（panelHostActions）与渲染层计算（store/canvas/splitLayout）共用
export interface SplitWant { key: string; url: string; companion: { panelId: string; props: Record<string, unknown> } }
