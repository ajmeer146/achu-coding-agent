#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { runAgent } from "./agent.js";

const program = new Command();

program
  .name("achu-agent")
  .description("A general-purpose autonomous AI coding agent")
  .version("0.1.0")
  .argument("[task]", "Task for the coding agent")
  .action(async (task?: string) => {
    console.log(chalk.cyan("\n? Achu Coding Agent\n"));

    if (!task) {
      console.log(chalk.yellow("No task provided."));
      console.log('Example: achu-agent "Fix the login bug"');
      return;
    }

    try {
      await runAgent(task);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);

      console.error(chalk.red(`\nAgent error: ${message}`));
      process.exitCode = 1;
    }
  });

await program.parseAsync();
