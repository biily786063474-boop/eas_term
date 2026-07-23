// 组合三个切片为完整应用状态（各切片文件以 type-only 方式引用，无运行时环）

import type { ProjectsSlice } from './projectsSlice'
import type { TabsSlice } from './tabsSlice'
import type { UiSlice } from './uiSlice'
import type { CanvasSlice } from './canvasSlice'

export type AppState = ProjectsSlice & TabsSlice & UiSlice & CanvasSlice
