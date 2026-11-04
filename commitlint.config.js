// Conventional Commits: https://www.conventionalcommits.org
// Scopes are optional and free-form, e.g. `feat(editor): …` or `fix: …`.
// AI attribution (e.g. a `Co-authored-by: Claude …` trailer) is rejected too.
import { findAiAttribution } from "./scripts/ai-attribution.ts";

export default {
  extends: ["@commitlint/config-conventional"],
  plugins: [
    {
      rules: {
        "no-ai-attribution": ({ raw }) => {
          const lines = findAiAttribution(raw ?? "");
          return [lines.length === 0, `remove the AI attribution: ${lines.join(" | ")}`];
        },
      },
    },
  ],
  rules: {
    "no-ai-attribution": [2, "always"],
  },
};
