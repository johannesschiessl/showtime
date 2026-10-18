import { useSyncExternalStore } from "react";

const subscribe = (onChange: () => void) => {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
};
const visible = () => document.visibilityState === "visible";

export const useDocumentVisible = () => useSyncExternalStore(subscribe, visible, () => false);
