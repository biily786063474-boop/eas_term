// 分类的单色线条图标（跟 app 图标一个风格：stroke=currentColor，跟着选中态变色）。
// 分类分类法在 shared/pluginCategories.ts（零 UI 依赖），图标按 id 在这里映射。
// 用户 2026-09-15：分类去掉 emoji，用单色线条 icon。

const PATHS: Record<string, string> = {
  // 办公文档：文档 + 折角 + 文字行
  office: '<path d="M13 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9z"/><path d="M13 3v6h6"/><path d="M8.5 13h7M8.5 16.5h7"/>',
  // 生活出行：定位针
  life: '<path d="M12 21s6.5-5.8 6.5-11A6.5 6.5 0 0 0 5.5 10c0 5.2 6.5 11 6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
  // 开发工具：代码尖括号
  dev: '<path d="M8.5 8.5 4 13l4.5 4.5"/><path d="M15.5 8.5 20 13l-4.5 4.5"/><path d="M13.5 5.5l-3 15"/>',
  // 通讯协作：对话气泡
  comms: '<path d="M20 4H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h4v4l5-4h7a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1z"/>',
  // 自媒体：喇叭
  media: '<path d="M4 10v4a1 1 0 0 0 1 1h2.5L16 20V4L7.5 9H5a1 1 0 0 0-1 1z"/><path d="M19 9a4 4 0 0 1 0 6"/>',
  // 设计创意：钢笔
  design: '<path d="M4 20l1-4L15.5 5.5a2.1 2.1 0 0 1 3 3L8 19l-4 1z"/><path d="M13.5 7.5l3 3"/>',
  // 数据搜索：放大镜
  data: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  // 文件存储：文件夹
  storage: '<path d="M3 7a1 1 0 0 1 1-1h4.5l2 2H20a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7z"/>',
  // 其他：九宫格
  other: '<rect x="4" y="4" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1"/>',
  // 精选：星
  featured: '<path d="M12 3.5l2.6 5.9 6.4.6-4.8 4.3 1.4 6.2L12 17.3 6 20.5l1.4-6.2L2.6 10l6.4-.6z"/>',
  // 已安装：勾
  installed: '<path d="M4.5 12.5l5 5 10-11"/>'
}

export function CategoryIcon({ id, size = 16 }: { id: string; size?: number }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: PATHS[id] ?? PATHS.other }}
    />
  )
}
