import { WifiOff } from "lucide-react";
import { useSyncExternalStore } from "react";

function subscribeToConnection(listener: () => void): () => void {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

const isOnline = () => navigator.onLine;

/** Shown while the browser is offline. Local files still import and query from the cached app. */
export function OfflineIndicator() {
  const online = useSyncExternalStore(subscribeToConnection, isOnline);
  if (online) return null;
  return (
    <p role="status" className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
      <WifiOff className="size-3" aria-hidden />
      Offline
    </p>
  );
}
