import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const nextCli = fileURLToPath(
  new URL("../node_modules/next/dist/bin/next", import.meta.url),
);

const build = spawn(process.execPath, [nextCli, "build"], {
  stdio: "inherit",
  env: {
    ...process.env,
    BUILD_TARGET: "pages",
  },
});

build.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
