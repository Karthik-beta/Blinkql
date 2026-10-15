// Micro-benchmarks with tinybench: hot functions measured in Node, outside the browser.
// Add a task per function under test; keep inputs fixed so runs are comparable.
//
//   pnpm bench:micro
import { Bench } from "tinybench";
import { summarize } from "../harness/stats.ts";

// Fixed pseudo-random input (a linear congruential generator), identical on every run.
let seed = 1;
const random = () => {
  seed = (seed * 1_664_525 + 1_013_904_223) % 2 ** 32;
  return seed / 2 ** 32;
};
const thousandSamples = Array.from({ length: 1_000 }, () => random() * 500);

const bench = new Bench({ name: "micro", time: 500 });
bench.add("summarize 10 samples", () => {
  summarize(thousandSamples.slice(0, 10));
});
bench.add("summarize 1,000 samples", () => {
  summarize(thousandSamples);
});

await bench.run();
process.stdout.write(`${bench.name}\n`);
// biome-ignore lint/suspicious/noConsole: tinybench formats its results as a table for the terminal
console.table(bench.table());
