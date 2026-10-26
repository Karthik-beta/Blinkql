// The roadmap shown on the landing page. Keep it in step with the Roadmap & Milestones wiki page
// and the GitHub milestones. The page renders this at build time and never fetches it.

export type MilestoneStatus = "done" | "current" | "planned";

export interface Milestone {
  /** The milestone's code, as used in GitHub milestone titles. */
  code: string;
  name: string;
  /** One line on what the milestone delivers, from its goal on the wiki. */
  summary: string;
  status: MilestoneStatus;
}

export const milestones: readonly Milestone[] = [
  {
    code: "M0",
    name: "Foundations",
    summary: "The project scaffold, CI, deployments and the benchmark harness.",
    status: "done",
  },
  {
    code: "M1",
    name: "Core query loop",
    summary: "Open a file, write SQL and see the results.",
    status: "done",
  },
  {
    code: "M2",
    name: "Performance pass\u00a0I", // no-break space: the numeral never wraps alone
    summary: "Queries never block the page, even on a million rows.",
    status: "done",
  },
  {
    code: "M3",
    name: "Explore and visualize",
    summary: "Column profiles, autocomplete, charts and export.",
    status: "done",
  },
  {
    code: "M4",
    name: "Big files and persistence",
    summary: "Files you keep reopen instantly; remote files by URL.",
    status: "done",
  },
  {
    code: "M5",
    name: "Operations pack",
    summary: "Factory sample data and templates such as OEE and downtime Pareto.",
    status: "done",
  },
  {
    code: "M6",
    name: "Performance pass\u00a0II",
    summary: "A faster first load, offline use and a canvas results grid.",
    status: "current",
  },
  {
    code: "M7",
    name: "Version 1.0",
    summary: "Accessibility, shortcuts, shareable query links and full docs.",
    status: "planned",
  },
];

/** The words shown next to each lamp, so a status never depends on colour alone. */
export const statusLabels: Record<MilestoneStatus, string> = {
  done: "Done",
  current: "In progress",
  planned: "Planned",
};
