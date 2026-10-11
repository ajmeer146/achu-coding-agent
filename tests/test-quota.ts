import { runAgent } from "../src/agent.js";
import { Workspace } from "../src/tools/workspace.js";

async function run() {
  process.env.NVIDIA_API_KEY = "fake-key"; // we will fail auth
  process.env.WORKSPACE_ROOT = "./tempverify";
  
  try {
    const result = await runAgent("Test the quota exhaustion logic");
    console.log("Result:", result);
  } catch (err: any) {
    console.log("Caught in top level:", err.message);
  }
}
run();
