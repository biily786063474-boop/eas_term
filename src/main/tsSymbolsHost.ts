/// <reference types="electron-vite/node" />
// `?nodeWorker` 是 electron-vite 的打包约定：把 tsSymbolsWorker.ts 打成独立 worker 文件，
// 返回一个 (options) => Worker 的工厂。这是本仓库里符号索引唯一的起线程处，
// launchCoverage 按 `?nodeWorker` 关键字盯着它。
import createSymbolsWorker from './tsSymbolsWorker?nodeWorker'
export {createSymbolsWorker}
