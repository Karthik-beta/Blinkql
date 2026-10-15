import { useEffect } from "react";
import { markOnce, marks } from "@/lib/user-timing";
import wordmarkDark from "../../brand/logo/blinkql-wordmark-dark.svg";
import wordmarkLight from "../../brand/logo/blinkql-wordmark-light.svg";

export function App() {
  // Benchmarked as "time to app shell" (bench/scenarios/time-to-app-shell.ts).
  useEffect(() => {
    markOnce(marks.appShell);
  }, []);

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-11 shrink-0 items-center border-b bg-chrome px-4">
        <img src={wordmarkLight} alt="Blinkql" className="h-5 w-auto dark:hidden" />
        <img src={wordmarkDark} alt="Blinkql" className="hidden h-5 w-auto dark:block" />
      </header>
      <main aria-label="Workspace" className="min-h-0 flex-1" />
    </div>
  );
}
