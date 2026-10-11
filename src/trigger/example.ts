import { task } from "@trigger.dev/sdk";

export const exampleTask = task({
  id: "example-task",
  run: async (payload: { message: string }) => {
    console.log(`Hello, ${payload.message}!`);
    return { success: true, message: `Processed: ${payload.message}` };
  },
});