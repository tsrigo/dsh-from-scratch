# TypeScript Primer: Four Common Syntax Patterns

The tutorial repeatedly uses the following four kinds of syntax. When reading a type, first identify the data structure described to the right of the colon. When reading a function, identify the operation it performs at runtime.

## Type Annotations Enable Early Checks

```ts
const step: number = 1;
```

`step` is a variable, `1` is its runtime value, and `: number` gives the editor and compiler an instruction for type checking. The built JavaScript omits this type annotation.

## interface Describes an Object's Fields

```ts
interface ToolCall {
  name: string;
  arguments: JsonValue;
}
```

An `interface` lists the fields that an object must contain. This Tool Call contains a string field named `name` and an `arguments` field represented using JavaScript Object Notation (JSON). JSON is a structured data format.

## async / await Waits for a Result

```ts
const response = await llm.complete(request);
```

An `async` function can use `await`. Here, the code sends a model request and continues the Agent Loop after receiving the result. Parallel execution and retries after failure require separate logic.

## The type Field Identifies the Event Kind

```ts
if (event.type === "tool/result") {
  console.log(event.content);
}
```

The Session Log contains multiple event types. After the code checks `type`, TypeScript can determine that the current branch has fields such as `content` and `name`. The execution trace on the right also classifies events by this field.
