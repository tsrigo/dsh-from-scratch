# TypeScript 预检：先看懂四个路标

不需要先学完 TypeScript。这个教程只反复使用四类语法；认出它们，就能跟着请求、工具和事件往前走。遇到类型时先读冒号右边的“数据形状”，遇到函数时再问它在运行时做了什么。

## 类型标注不是运行步骤

```ts
const step: number = 1;
```

`step` 是变量，`1` 是运行时的值，`: number` 只是给编辑器和编译器的检查说明。构建后的 JavaScript 不会执行 `number`。

## interface 描述一张数据清单

```ts
interface ToolCall {
  name: string;
  arguments: JsonValue;
}
```

把 `interface` 当成表格列名：一个工具调用必须有字符串 `name` 和 JSON `arguments`。它不创建对象，只约束对象应该长什么样。

## async / await 表示等待结果

```ts
const response = await llm.complete(request);
```

`async` 函数允许使用 `await`。这里的含义很朴素：发出模型请求，等结果回来，再继续 Agent Loop；它不自动并行，也不是重试。

## type 字段告诉我们当前是哪种事件

```ts
if (event.type === "tool/result") {
  console.log(event.content);
}
```

Session Log 里有多种事件。先检查 `type`，TypeScript 就知道这个分支拥有 `content`、`name` 等字段。教程右侧的 Trace 正是同一判断的可视化结果。
