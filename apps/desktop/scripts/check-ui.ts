import { runTests } from "./run-tests";

process.exitCode = await runTests("ui");
