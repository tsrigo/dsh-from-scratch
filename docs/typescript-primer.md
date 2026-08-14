# TypeScript 阅读预检：先认四个路标

你可以边读边学。教程反复使用下面四类语法；遇到类型时，先读冒号右边的“数据形状”，遇到函数时，再看它在运行时做了什么。

## 类型标注负责提前检查

```ts
const step: number = 1;
```

`step` 是变量，`1` 是运行时的值，`: number` 给编辑器和编译器一条检查说明。构建后的 JavaScript 会去掉这段类型标注。

## interface 描述数据清单

```ts
interface ToolCall {
  name: string;
  arguments: JsonValue;
}
```

把 `interface` 当成表格列名：一个工具调用要有字符串 `name`，还要有 JavaScript 对象表示法（JavaScript Object Notation，JSON）格式的 `arguments`。它负责描述对象应当具备的字段。

## async / await 表示等待结果

```ts
const response = await llm.complete(request);
```

`async` 函数允许使用 `await`。这里会发出模型请求，等结果回来，再继续智能体循环。并行和重试需要另外编写逻辑。

## type 字段标明事件种类

```ts
if (event.type === "tool/result") {
  console.log(event.content);
}
```

过程日志里会出现多种事件。先检查 `type`，TypeScript 就知道这个分支拥有 `content`、`name` 等字段。右侧时间线也会按照这个字段给记录分类。
