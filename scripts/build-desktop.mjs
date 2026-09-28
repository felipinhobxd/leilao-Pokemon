import { spawn } from "node:child_process";
import { cp, mkdir, access, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextCli = path.join(root, "node_modules", "next", "dist", "bin", "next");

function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", code => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} terminou com código ${code ?? "desconhecido"}.`));
    });
  });
}

await run(process.execPath, [nextCli, "build"], {
  ...process.env,
  DESKTOP_BUILD: "1",
});

await access(nextCli);
const standalone = path.join(root, ".next", "standalone");
const standaloneServer = path.join(standalone, "server.js");
await access(standaloneServer);

await writeFile(
  path.join(standalone, "desktop-public-config.json"),
  JSON.stringify({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
  }),
  "utf8",
);

await mkdir(path.join(standalone, ".next"), { recursive: true });
const staticDir = path.join(root, ".next", "static");
await cp(staticDir, path.join(standalone, ".next", "static"), { recursive: true, force: true });

const publicDir = path.join(root, "public");
try {
  await access(publicDir);
  await cp(publicDir, path.join(standalone, "public"), { recursive: true, force: true });
} catch {
  // public/ é opcional no Next.js; nada a copiar.
}

if (process.platform === "win32") {
  const runtimeDir = path.join(root, "desktop-runtime");
  const runtimeNode = path.join(runtimeDir, "node.exe");
  await mkdir(runtimeDir, { recursive: true });
  await cp(process.execPath, runtimeNode, { force: true });
  await access(runtimeNode);
  console.log("[desktop] Node runtime empacotável preparado:", runtimeNode);
}

console.log("[desktop] Next.js standalone preparado:", standaloneServer);
