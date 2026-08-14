# Python Primer: Four Common Syntax Patterns

The tutorial repeatedly uses the following four Python patterns for type annotations, data definitions, asynchronous waiting, and request structures. Understanding them is enough to read the examples that follow.

## Type Annotations Describe Data Shapes

```python
step: int = 1
```

The text to the right of the colon indicates that `step` is expected to be an integer. The Python runtime does not enforce this annotation automatically, but editors and tools such as Pyright and mypy can use it to detect many errors before execution.

## dataclass Groups Related Data

```python
@dataclass
class ToolCall:
    name: str
    arguments: dict[str, Any]
```

`dataclass` generates an initialization method from the declared fields. Here, `ToolCall` contains a tool name and a dictionary of call arguments.

## async / await Waits for a Result

```python
response = await llm.complete(request)
```

`async def` defines an asynchronous function, and `await` waits for the model response while allowing the event loop to process other work. Parallel execution and retries after failure require separate logic.

## Dictionaries and Lists Form Model Requests

```python
request = {"system": rules, "tools": tools}
```

Curly braces create a dictionary, while square brackets create a list. Model requests, tool arguments, and execution events can all use these built-in structures and then be converted to JavaScript Object Notation (JSON), a structured data format.
