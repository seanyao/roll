import { renderInitJourneyAttestSmoke, recommendNext, renderNextRecommendation } from "../lib/init-journey.js";

export const NEXT_USAGE =
  "Usage: roll next\n" +
  "  Print the single best next action for this project's Roll onboarding state.\n" +
  "  当前项目 Roll 接入状态的下一步。\n";

function isHelp(arg: string | undefined): boolean {
  return arg === "help" || arg === "--help" || arg === "-h";
}

export function nextCommand(args: string[]): number {
  if (isHelp(args[0])) {
    process.stdout.write(NEXT_USAGE);
    return 0;
  }
  if (args[0] === "--attest-smoke") {
    if (args.length === 2 && args[1] === "init-journey") {
      process.stdout.write(renderInitJourneyAttestSmoke());
      return 0;
    }
    process.stderr.write("unknown next attest smoke fixture. Expected: roll next --attest-smoke init-journey\n");
    return 1;
  }
  if (args.length > 0) {
    process.stderr.write(NEXT_USAGE);
    return 1;
  }
  process.stdout.write(renderNextRecommendation(recommendNext(process.cwd())));
  return 0;
}
