import { useCallback, useContext } from "react";
import { RegistryContext } from "@effect/atom-react";
import type { Atom, AsyncResult } from "effect/reactivity";
import { executeMutation } from "@showtime/frontend";

export const useRpcMutation = <A, E, W>(atom: Atom.Writable<AsyncResult.AsyncResult<A, E>, W>) => {
  const registry = useContext(RegistryContext);
  return useCallback((input: W) => executeMutation(registry, atom, input), [registry, atom]);
};
