# Python 阅读准备：四种常用语法

教程会反复使用下面四种 Python 写法，分别用于类型说明、数据定义、异步等待和请求结构。理解它们即可阅读后续示例。

## 类型标注说明数据形状

```python
step: int = 1
```

冒号右边说明 `step` 预期是整数。Python 运行时不会自动强制检查它，但编辑器和 Pyright、mypy 等工具能提前发现许多错误。

## dataclass 装下相关数据

```python
@dataclass
class ToolCall:
    name: str
    arguments: dict[str, Any]
```

`dataclass` 根据字段自动生成初始化方法。这里的 `ToolCall` 包含工具名称和一组调用参数。

## async / await 表示等待结果

```python
response = await llm.complete(request)
```

`async def` 定义异步函数，`await` 等待模型返回，同时允许事件循环处理其他任务。并行执行和失败重试需要另外编写逻辑。

## 字典和列表组成模型请求

```python
request = {"system": rules, "tools": tools}
```

花括号创建字典，方括号创建列表。模型请求、工具参数和过程事件都可以使用这两种内置结构表达，再转换为 JavaScript 对象表示法（JavaScript Object Notation，JSON）。JSON 是一种结构化数据格式。
