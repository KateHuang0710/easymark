<div align="center">
  <img src="build/icon-256x256.png" width="128" height="128" alt="EasyMark icon">
  <h1>EasyMark</h1>
  <p>本地优先、跨平台、AI 辅助的 Markdown 笔记应用</p>

  [![CI](https://github.com/KateHuang0710/easymark/actions/workflows/ci.yml/badge.svg)](https://github.com/KateHuang0710/easymark/actions/workflows/ci.yml)
  [![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
  [![Electron](https://img.shields.io/badge/Electron-43-47848F?logo=electron)](https://www.electronjs.org/)
  [![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)](https://react.dev/)
</div>

EasyMark 使用 Electron、React、TypeScript 和 Vite 构建。笔记以独立 `.md` 文件保存在本地，应用不绑定专有云服务；只有主动调用 AI 功能时，相关内容才会发送到用户配置的 OpenAI-compatible API。

## 功能

- WYSIWYG、Markdown 源码与预览三种编辑模式
- 自动保存、保存失败重试、退出前保存确认
- 最近 10 个本地历史版本，可预览与恢复
- 双栏编辑、全文搜索、查找替换、大纲、阅读模式
- 可视化表格编辑、标题与列表折叠
- 图片粘贴、本地资源管理、Markdown 文件拖放导入
- PDF、DOCX 导出与系统分享
- AI 续写、建议、行内补全、选中文本处理、知识库问答
- Git 初始化、提交、历史与差异查看
- 中英文界面、浅色/深色主题和多种配色

## 平台状态

| 平台 | 构建目标 | 状态 |
| --- | --- | --- |
| macOS | Apple silicon、Intel、Universal DMG/ZIP | 支持 |
| Windows | NSIS 安装包 | 支持 |
| Linux | AppImage | 基础支持 |

## 快速开始

环境要求：Node.js 20 或更高版本、npm。

```bash
git clone https://github.com/KateHuang0710/easymark.git
cd easymark
npm install
npm run dev
```

生产模式本地启动：

```bash
npm start
```

## 数据位置

- 笔记：`Documents/EasyMark Notes/`
- 图片：`Documents/EasyMark Notes/assets/`
- 历史版本：`Documents/EasyMark Notes/.history/`
- 应用设置：Electron `userData` 目录

旧版本的 `Documents/EasyMark/` 数据会在首次启动时保守复制到新目录，原文件不会被删除。

## AI 配置与隐私

在“设置 → AI”中配置 API Key、API 地址和模型。EasyMark 支持 OpenAI-compatible Chat Completions API。

- API Key 由 Electron 主进程管理，不会暴露给 renderer，也不会写入 `localStorage`
- 正式签名的 macOS 版本使用 Keychain，Windows 使用 DPAPI
- macOS 本地/ad-hoc 构建使用无弹窗的本地加密后端
- 更换 API 服务 origin 时必须重新输入 API Key，避免旧凭据发往意外端点
- 笔记不会自动上传；仅在用户主动调用 AI 功能时发送所需上下文

## 开发命令

```bash
npm run dev          # Vite + Electron 开发模式
npm run typecheck    # TypeScript 类型检查
npm run test         # Vitest + Node 测试
npm run test:e2e     # Playwright 编辑器交互测试
npm run build        # 生产构建
npm run check        # 类型检查、测试和构建
```

## 打包

```bash
npm run pack             # 当前平台 unpacked 应用
npm run dist:win         # Windows NSIS
npm run pack:mac         # macOS unpacked .app
npm run dist:mac:arm64   # Apple silicon
npm run dist:mac:x64     # Intel
npm run dist:mac:universal
```

macOS 签名、公证和发布检查见 [MACOS.md](MACOS.md)。应用图标以 `build/icon-source-v2.png` 为源文件，可通过 `python3 scripts/generate_icon.py` 重新生成。

## 安全设计

- renderer 启用 `contextIsolation` 和 sandbox，禁用 Node integration
- IPC 校验 sender，并限制文件名、路径、参数和内容大小
- Markdown HTML 经过 DOMPurify 清理
- 外部导航和新窗口默认拒绝，安全链接交给系统浏览器
- 本地图片通过受限的 `easymark-asset://` 协议加载
- 文件操作防止路径穿越、符号链接访问和意外覆盖

如发现安全问题，请按 [SECURITY.md](SECURITY.md) 私下报告，不要直接创建公开 Issue。

## 项目结构

```text
electron/        Electron 主进程、IPC、文件、AI、导出
src/             React 应用、编辑器、服务与样式
tests/           Node 与 Playwright 测试
public/          帮助文档等静态资源
build/           跨平台应用图标
scripts/         构建辅助脚本
```

## 参与贡献

提交 Issue 或 Pull Request 前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[MIT](LICENSE) © 2026 Xayuan
