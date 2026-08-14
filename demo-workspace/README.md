# CHECKOUT-417 教学工作区

这个目录是 fake LLM 与真实 DeepSeek 共用的固定离线代码工作区。Agent 只能通过 `read_workspace_file` 读取下列四个路径，只能通过 `apply_patch` 精确修改内存中的 `src/checkout.ts`，不会直接改写这里的原始 fixture，也不会获得通用 Shell。

- `issue.md`：用户报告与验收目标
- `src/checkout.ts`：包含重复抵扣 Bug 的源码
- `tests/checkout.test.ts`：最小回归测试
- `ci.log`：用于展示上下文裁剪的长测试输出

唯一被接受的修复是删除 `calculateTotal()` 返回表达式中第二次出现的 `input.orderDiscount`。补丁必须先通过确定性回归套件，再由 `submit_patch` 验收。
