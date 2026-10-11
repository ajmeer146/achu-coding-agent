import { task } from "@trigger.dev/sdk";

export const diagnosticPing = task({
  id: "diagnostic-ping",
  run: async () => {
    return {
      ok: true,
      task: "diagnostic-ping",
      message: "Worker execution verified",
    };
  },
});