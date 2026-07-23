# EasyMark

EasyMark 是一款跨平台、AI 辅助的 Markdown 笔记应用，使用 Electron、React、TypeScript 和 Vite 构建。笔记以独立 `.md` 文件保存在用户的 `Documents/EasyMark/` 目录中，图片保存在其 `assets/` 子目录。

## 当前状态

- Windows：支持 NSIS 安装包构建。
- macOS：支持 Apple silicon (`arm64`)、Intel (`x64`) 以及 Universal DMG/ZIP 构建；已配置 hardened runtime、应用图标和原生窗口行为。
- Linux：提供基础 AppImage 构建配置。
- AI：支持 OpenAI-compatible Chat Completions API；API Key 由 Electron 主进程管理，并在系统安全存储可用时加密持久化。

## 核心功能

- WYSIWYG、Markdown 源码、预览三种编辑模式
- 防抖自动保存与退出前保存确认
- 双栏编辑、全文搜索、查找替换、大纲和阅读模式
- 图片粘贴、本地资源安全协议
- PDF 和 DOCX 导出
- AI 续写、建议、行内补全和聊天
- 中英文界面、浅色/深色主题和多种配色

## 环境要求

- Node.js：建议使用当前 LTS 版本
- npm
- macOS 打包：macOS 12 或更高版本；签名和公证需要 Xcode Command Line Tools 与 Apple Developer Program 账号

## 安装与开发

```bash
npm install
npm run dev
```

生产模式本地启动：

```bash
npm start
```

## 质量检查

```bash
npm run typecheck
npm run test
npm run build
npm run check
npm audit
```

`npm run check` 会依次执行 TypeScript 检查、测试和生产构建。

## 打包

```bash
# 当前平台的 unpacked 应用
npm run pack

# Windows
npm run dist:win

# macOS：unpacked .app
npm run pack:mac

# macOS：当前架构 DMG + ZIP
npm run dist:mac

# macOS：指定架构
npm run dist:mac:arm64
npm run dist:mac:x64
npm run dist:mac:universal
```

macOS 签名、公证、unsigned 本地测试和发布检查见 [MACOS.md](./MACOS.md)。

## 数据与隐私

- 笔记不会自动上传；只有用户主动调用 AI 功能时，相关提示和笔记上下文才会发送到用户配置的 API 服务。
- API Key 不保存在 renderer 的 `localStorage`。
- macOS 使用 Keychain、Windows 使用 DPAPI；Linux 的安全存储能力取决于桌面密钥环环境。若安全存储不可用，EasyMark 不会把 Key 明文写入磁盘，设置页会提示该 Key 仅本次运行有效。
- 更换 API 服务的 origin 时必须重新输入 API Key，避免把旧凭据发送到意外端点。

## 安全设计

- Electron renderer 启用 `contextIsolation`、sandbox，禁用 Node integration
- 所有 IPC 均校验 sender，并限制文件名、内容大小和参数格式
- Markdown 输出由 DOMPurify 清理
- 外部导航和新窗口默认拒绝，允许的 HTTP(S)/mailto 链接交给系统浏览器
- 本地图片通过受限的 `easymark-asset://local/` 协议读取
- 笔记操作阻止路径穿越、符号链接访问和重命名覆盖
- 主进程拒绝 renderer 权限请求

## 项目结构

```text
electron/
  main.js          Electron 生命周期、IPC、文件、AI、导出
  preload.js       最小化 contextBridge API
  file-utils.js    文件名与图片输入验证
src/
  App.tsx
  components/
  contexts/
  hooks/
  i18n/
  services/
  styles/
  types/
tests/
public/
build/
```

## 已知后续工作

- 用 Range API 逐步替换编辑器中已废弃的 `document.execCommand`
- 按需注册 highlight.js 语言，降低 renderer bundle 体积
- 增加端到端 UI 测试和自动化签名/公证流水线
- 发布前准备 Developer ID 证书、隐私说明、版本更新策略和崩溃恢复方案
