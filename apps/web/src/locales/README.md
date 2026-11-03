界面语言仅在当前客户端保存。Web 和 Electron 共用此词包；原生手机端没有接入。

组件保留上游英文源码，由 `wuchale.config.ts` 在编译时提取界面文案。新增英文未翻译时回退为英文；不翻译运行时传入的对话、文件、代码或模型名称。语言切换不重新加载页面。设置导航等模块级常量由 `src/i18n/staticUiLabels.ts` 单独接入，新增这类标签时需同时补充其中的显示值。

在 `apps/web` 执行：

```sh
vp run i18n:extract
# 编辑 zh-CN.po；保留数字参数和 <0> 等标记
vp run i18n:check
```

`en.po` 和 `zh-CN.po` 随源码提交；加载器、索引和编译词包由工具生成并忽略。不要手改生成的 JavaScript。提取器关闭外部 AI 翻译；维护词包不需要账号、密钥或付费服务。

编译规则会保护条件、对象键和协议值，并限制 React hook 只进入组件或自定义 hook。同步上游、升级提取器后，运行 `src/i18n/extraction.test.ts`、`src/i18n/localeController.test.ts` 和整页用例 `test/interfaceLocale.renders.tsx`。整页用例使用仓库已有的 `renders` 项目，支持通过 `VITE_I18N_EVIDENCE_DIR` 保存后台截图。

译名采用 thread「对话」、session「会话」、environment「环境」、worktree「工作树」。复用译文的来源和许可证见 [NOTICE.md](./NOTICE.md)。

`patches/wuchale@0.26.7.patch` 修复 JSX 表达式与外层文案错误共用编译状态、嵌套文案穿过未翻译容器后丢失上下文的问题。该补丁由 pnpm 随安装应用；升级 Wuchale 时先复核嵌套 JSX 回归用例，再决定是否移除。编译阶段还会检查生成的上下文绑定。
