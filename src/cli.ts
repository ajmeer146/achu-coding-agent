#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { runAgent } from "./agent.js";

const program = new Command();

program
  .name("achu-agent")
  .description("A general-purpose autonomous AI coding agent")
  .version("0.1.0")
  .argument("[task...]", "Task for the coding agent")
  .action(async (taskParts?: string | string[]) => {
    console.log(chalk.cyan("\n? Achu Coding Agent\n"));

    const task = Array.isArray(taskParts) ? taskParts.join(" ").trim() : (taskParts?.trim() || "");

    if (!task) {
      console.log(chalk.yellow("No task provided."));
      console.log('Example: achu-agent "Fix the login bug"');
      return;
    }

    try {
      const result = await runAgent(task);
      if (!result.success) {
        console.error(chalk.red(`\nTask failed: ${result.error || result.stopReason || "Execution was not successful"}`));
        process.exitCode = 1;
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);

      console.error(chalk.red(`\nAgent error: ${message}`));
      process.exitCode = 1;
    }
  });

void program.parseAsync();
