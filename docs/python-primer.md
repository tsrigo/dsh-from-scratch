# Python 阅读预检：先认四个路标

你可以边读边学。Python 把类型、异步等待和数据结构写得很直接；先认出下面四种写法，就足以读完本教程。

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

把 `dataclass` 当成一张数据表：它会根据字段自动生成初始化方法。一个工具调用需要名字和一组参数。

## async / await 表示等待结果

```python
response = await llm.complete(request)
```

`async def` 定义异步函数，`await` 等待模型返回，同时允许事件循环处理别的工作。并行和重试仍需另外编写。

## 字典和列表组成模型请求

```python
request = {"system": rules, "tools": tools}
```

花括号创建字典，方括号创建列表。模型请求、工具参数和过程事件都可以用这两种内置结构表达，再直接转成 JSON。
