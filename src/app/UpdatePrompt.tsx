import { useRegisterSW } from "virtual:pwa-register/react";
import { Button } from "@/components/ui/button";

/**
 * Registers the service worker (production builds only; in dev and tests the hook does nothing)
 * and offers to reload when a new version has been downloaded.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  if (!needRefresh) return null;
  return (
    <div role="status" className="flex shrink-0 items-center gap-2 text-xs">
      <p>A new version of Blinkql is ready.</p>
      <Button variant="outline" size="xs" onClick={() => void updateServiceWorker()}>
        Reload
      </Button>
      <Button variant="ghost" size="xs" onClick={() => setNeedRefresh(false)}>
        Not now
      </Button>
    </div>
  );
}
