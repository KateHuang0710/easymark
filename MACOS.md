# EasyMark macOS 开发与发布

## 1. 支持范围

当前项目使用 Electron 43，并将 `LSMinimumSystemVersion` 配置为 macOS 12.0。项目可构建：

- Apple silicon：`arm64`
- Intel：`x64`
- Universal：同时包含 `arm64` 与 `x64`

Electron 44 起要求 macOS 13 或更高版本；未来升级 Electron 主版本时，应同步重新确认最低系统版本。

## 2. 开发环境

建议安装：

1. 当前 Node.js LTS
2. npm
3. Xcode 或 Xcode Command Line Tools
4. 如需在 Apple silicon 上验证 Intel 构建，安装 Rosetta 2

```bash
xcode-select --install
node --version
npm --version
```

安装依赖并启动：

```bash
npm install
npm run dev
```

## 3. 本地 unsigned 构建

先验证 unpacked `.app`：

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npm run pack:mac
```

产物位于 `release/`。可直接启动 `.app` 做本地检查。若从互联网或其他机器传输 unsigned 应用，Gatekeeper 可能阻止启动；unsigned 构建仅用于开发验证，不应作为正式公开发行包。

指定架构：

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac:arm64
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac:x64
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac:universal
```

## 4. Developer ID 签名

公开分发应加入 Apple Developer Program，并在钥匙串安装 **Developer ID Application** 证书。不要使用 Mac Development、Apple Development 或 Mac App Distribution 证书代替。

检查可用身份：

```bash
security find-identity -v -p codesigning
```

正常情况下 electron-builder 会自动发现 Developer ID Application 身份。CI 中也可以设置：

```bash
export CSC_LINK=/secure/path/DeveloperIDApplication.p12
export CSC_KEY_PASSWORD='...'
```

不要把证书、密码、`.p8`、`.p12` 或任何 Apple 凭据提交到仓库。

项目已启用：

- `hardenedRuntime: true`
- `notarize: true`
- DMG 与 ZIP target
- `.icns` 图标
- Productivity category

electron-builder 默认启用自动 entitlements。只有在签名检查明确需要时才增加自定义 entitlements；避免无理由加入 `get-task-allow` 或放宽 library validation。

## 5. 公证

Apple 已停止接受 `altool`，应使用 `notarytool` 或 electron-builder 的 `@electron/notarize` 集成。公证要求 Developer ID 签名和 hardened runtime。

### 方案 A：Apple ID

```bash
export APPLE_ID='developer@example.com'
export APPLE_APP_SPECIFIC_PASSWORD='xxxx-xxxx-xxxx-xxxx'
export APPLE_TEAM_ID='ABCDE12345'
npm run dist:mac
```

必须使用 Apple ID 的 app-specific password，不要使用账户登录密码。

### 方案 B：App Store Connect API Key（CI 推荐）

```bash
export APPLE_API_KEY='<base64-encoded .p8 content>'
export APPLE_API_KEY_ID='KEYID12345'
export APPLE_API_ISSUER='issuer-uuid'
export APPLE_TEAM_ID='ABCDE12345'
npm run dist:mac
```

### 方案 C：notarytool Keychain profile

先在构建机保存凭据：

```bash
xcrun notarytool store-credentials easymark-notary \
  --apple-id 'developer@example.com' \
  --team-id 'ABCDE12345' \
  --password 'xxxx-xxxx-xxxx-xxxx'
```

然后：

```bash
export APPLE_KEYCHAIN_PROFILE='easymark-notary'
npm run dist:mac
```

成功后 electron-builder 会将公证 ticket staple 到应用。

## 6. 发布前验证

```bash
npm run check
npm audit
npm run dist:mac

codesign --verify --deep --strict --verbose=2 "release/mac-arm64/EasyMark.app"
spctl --assess --type execute --verbose=4 "release/mac-arm64/EasyMark.app"
xcrun stapler validate "release/mac-arm64/EasyMark.app"
```

实际产物目录会随架构和 electron-builder 版本变化，请按 `release/` 中的目录调整命令。

功能检查清单：

- traffic lights 与标题栏不重叠
- `Cmd+Q` 和关闭窗口前，未保存的主栏与右栏内容均落盘
- 创建、快速切换、重命名、删除和双栏编辑
- 粘贴 PNG/JPEG/GIF/WebP，并在重启后正常显示
- 外部链接由默认浏览器打开
- 恶意 Markdown 不执行脚本或事件处理器
- API Key 重启后可读取；ad-hoc 本地包使用无弹窗开发凭据后端并显示对应提示，Developer ID 正式签名包使用 Keychain；仅在加密能力完全不可用时显示 session-only 提示
- PDF/DOCX 导出
- Intel、Apple silicon 至少各做一次真机或 CI smoke test

## 7. 官方参考

- Electron Security Checklist: https://www.electronjs.org/docs/latest/tutorial/security
- electron-builder macOS: https://www.electron.build/docs/mac/
- electron-builder Notarization: https://www.electron.build/docs/notarization/
- Apple Notarization: https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution
