# 参与贡献

感谢你对 EasyMark 的关注。建议先通过 Issue 说明较大的功能或行为变更，再开始实现，以减少重复工作。

## 开发环境

需要 Node.js 20 或更高版本及 npm。

```bash
npm install
npm run dev
```

## 提交前检查

```bash
npm run check
npm run test:e2e
```

请确保：

- 修改范围聚焦，不夹带无关重构
- 新行为有相应测试，尤其是编辑器、文件系统和凭据相关逻辑
- renderer 不获得 Node.js、文件系统或原始 IPC 权限
- 不提交 API Key、签名证书、`.env`、构建产物或个人笔记
- 中英文界面新增文案保持同步

## Pull Request

Pull Request 应说明：

- 解决的问题和用户可见变化
- 关键实现取舍
- 已运行的测试
- 涉及界面时附上截图或录屏

提交信息建议使用简洁的 Conventional Commits 风格，例如：

```text
fix: preserve list editing after heading shortcuts
feat: add visual table row controls
test: cover editor undo workflows
```
