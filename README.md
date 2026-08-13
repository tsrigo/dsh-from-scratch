# dsh-from-scratch

一个原创、可离线运行的 TypeScript 教学 Harness。我们用同一宗“火星中继站恢复审计”，从普通 tool calling 开始，逐步加入上下文投影、插件生命周期、只追加 Session Log、受信任能力实验和跨 Round 续行。

当前教学 checkpoint：M02。

```sh
corepack enable
pnpm install
pnpm demo
pnpm test
```

真实 DeepSeek 与 fake provider 复用同一 `Agent`：

```sh
DEEPSEEK_API_KEY=... DEEPSEEK_MODEL=deepseek-v4-flash \
  pnpm dev -- --provider deepseek
```

默认 base URL 是 `https://api.deepseek.com`。API key 只从环境变量读取；无 key 不影响 demo、测试、教程生成或网站。

## 边界与致谢

本项目不是 DeepSeek Harness 的兼容层，也不实现 Code Runtime、preset loader、权限审批、生产沙箱、Subagent 或 Workflow。PTC 只作为工具呈现方式的静态教学对照。

架构行为参考 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。教学闭环受到 [pi-from-scratch](https://github.com/SaladDay/pi-from-scratch) “渐进实现、文章与真实源码同步、静态 Trace”理念启发。所有源码、文案、章节组织、组件、布局和 Trace 数据均为独立创作。
