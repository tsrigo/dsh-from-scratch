# TypeScript 阅读准备：四种常用语法

教程会反复使用下面四类语法。阅读类型时，可以先确认冒号右边描述的数据结构；阅读函数时，再确认它在运行时执行的操作。

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

`interface` 列出对象必须具备的字段。这里的工具调用包含字符串 `name`，以及采用 JavaScript 对象表示法（JavaScript Object Notation，JSON）表示的 `arguments`。JSON 是一种结构化数据格式。

## async / await 表示等待结果

```ts
const response = await llm.complete(request);
```

`async` 函数允许使用 `await`。这里先发出模型请求，收到结果后继续 Agent Loop。并行执行和失败重试需要另外编写逻辑。

## type 字段标明事件种类

```ts
if (event.type === "tool/result") {
  console.log(event.content);
}
```

Session Log 中包含多种事件。代码检查 `type` 后，TypeScript 可以确定当前分支拥有 `content`、`name` 等字段。右侧执行记录也按照这个字段分类。
