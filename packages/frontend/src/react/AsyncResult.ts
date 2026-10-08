import { Option } from "effect";
import { AsyncResult } from "effect/reactivity";

export function isFailureWithoutValue<A, E>(result: AsyncResult.AsyncResult<A, E>): boolean {
  return AsyncResult.isFailure(result) && Option.isNone(AsyncResult.value(result));
}

export function asyncResultValueOrElse<A, E>(
  result: AsyncResult.AsyncResult<A, E>,
  orElse: () => A,
): A {
  return Option.getOrElse(AsyncResult.value(result), orElse);
}
