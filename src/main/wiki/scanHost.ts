/// <reference types="electron-vite/node" />
// electron-vite ?nodeWorker 工厂：知识库扫描线程唯一的起线程处（launchCoverage 盯 ?nodeWorker）。
import createScanWorker from './scanWorker?nodeWorker'
export {createScanWorker}
