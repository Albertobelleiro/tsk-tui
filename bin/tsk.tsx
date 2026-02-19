import { runCLI } from "../src/cli/index.ts";

const args = process.argv.slice(2);
const hasSubcommand = args.length > 0 && !args[0]!.startsWith("-");
const isGlobalFlag =
  args.includes("--help") || args.includes("-h") ||
  args.includes("--version") || args.includes("-v");

if (hasSubcommand || isGlobalFlag) {
  const exitCode = await runCLI(args);
  process.exit(exitCode);
}

// No subcommand → launch TUI (dynamic imports to keep CLI fast)
const { createCliRenderer } = await import("@opentui/core");
const { createRoot } = await import("@opentui/react");
const { TaskStore } = await import("../src/store/task-store.ts");
const { App } = await import("../src/app.tsx");

const store = await TaskStore.create();

const renderer = await createCliRenderer({
  exitOnCtrlC: true,
  useAlternateScreen: true,
});

createRoot(renderer).render(<App store={store} />);
