#!/usr/bin/env node

// 导出插件入口（用于 OpenClaw 插件系统）
// 注意：此文件不应导入任何 CLI 相关模块
export { default } from './plugin';
export { default as plugin } from './plugin';
