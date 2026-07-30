// 屏幕底部的版本水印。
//
// 为什么值得占这一行像素：这个项目同时存在「/Applications 里装的包」、
// 「npx electron . 起的开发实例」和历史遗留的旧包，三者长得一模一样。
// 真出过一次「报的 bug 在代码里根本不存在」——开着的是三个版本前的包，
// 而当时没有任何办法当场看出来。有这行字，第一眼就能排除这类误判。
//
// 非打包运行时额外标 dev：开发实例和正式包同屏时，光看版本号是分不出来的
// （两者版本号一样），而它们的行为可能差着未提交的一堆改动。
import { useStore } from '../store'

export function BuildStamp(): JSX.Element | null {
  // 画布模式下最大化某个模块是「沉浸式细看」，那时候连抽屉把手都让位了，水印也别留
  const maximizedNode = useStore((s) => s.maximizedNode)
  const b = window.api.build
  if (!b?.version || maximizedNode) return null

  return (
    <div className="build-stamp" aria-hidden="true">
      v{b.version}
      {!b.packaged && <em>dev</em>}
    </div>
  )
}
