// 3D 查看器（@google/model-viewer）按需下载的钉子。主进程与渲染层共用。
//
// model-viewer 不进主包（用户要求）：首次查看 .glb 时点下载，从自己的服务器拉到
// userData/deps/，SHA256 校验后缓存。托管在 eas.biily.top（既有可信出站，非公共 CDN）。
// 换版本时：改 VERSION + URL + SHA256 + SIZE 四处，并用 scripts/publish-deps.sh 先把新
// bundle 传上去，再发 app（否则用户点下载 404）。

export const MODEL_VIEWER_VERSION = '4.3.1'
/** 落到 userData/deps/ 的本地文件名。 */
export const MODEL_VIEWER_FILE = 'model-viewer-umd.min.js'
/** 服务器上的下载地址（版本写进文件名，避免缓存串版本）。 */
export const MODEL_VIEWER_URL = `https://eas.biily.top/deps/model-viewer-${MODEL_VIEWER_VERSION}-umd.min.js`
/** UMD 自包含 min（含 three.js）的 sha256，下载后逐字节校验。 */
export const MODEL_VIEWER_SHA256 = '4492ad16f4aa7ceef5ec9bab645e62d56e990e5ae9737b0d60d58246fb23c0d5'
/** 字节数，仅用于给用户显示「约 1MB」与进度条分母。 */
export const MODEL_VIEWER_SIZE = 1071671
