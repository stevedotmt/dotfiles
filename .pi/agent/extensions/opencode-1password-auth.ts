import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";

const OP_ITEM = "op://Personal/opencode/api";
const ENV_VARS = ["OPENCODE_API_KEY", "OPENCODE_ZEN_AUTH"] as const;
const TIMEOUT_MS = 15_000;

function readOpSecret(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "op",
      ["read", OP_ITEM],
      {
        timeout: TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
        env: process.env,
      },
      (error, stdout, stderr) => {
        if (error) {
          const message = stderr.trim() || error.message;
          reject(new Error(message));
          return;
        }

        const secret = stdout.trim();
        if (!secret) {
          reject(new Error(`1Password item returned an empty value: ${OP_ITEM}`));
          return;
        }

        resolve(secret);
      },
    );
  });
}

async function loadAuth(ctx: ExtensionContext, notifySuccess = false): Promise<boolean> {
  try {
    const secret = await readOpSecret();

    for (const name of ENV_VARS) {
      process.env[name] = secret;
    }

    // Make the key available to pi's model registry immediately without writing it to auth.json.
    ctx.modelRegistry.authStorage.setRuntimeApiKey("opencode", secret);

    if (notifySuccess) {
      ctx.ui.notify(
        `Loaded opencode auth from 1Password for provider opencode and ${ENV_VARS.join(", ")}`,
        "info",
      );
    }

    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(
      `Failed to load opencode auth from 1Password (${OP_ITEM}): ${message}`,
      "error",
    );
    return false;
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    await loadAuth(ctx, false);
  });

  pi.registerCommand("opencode-auth-refresh", {
    description: "Reload opencode auth from 1Password",
    handler: async (_args, ctx) => {
      await loadAuth(ctx, true);
    },
  });

  pi.registerCommand("opencode-auth-status", {
    description: "Show whether opencode auth is loaded in this pi process",
    handler: async (_args, ctx) => {
      const loaded = ENV_VARS.filter((name) => Boolean(process.env[name]));
      if (loaded.length === ENV_VARS.length) {
        ctx.ui.notify(`Opencode auth is loaded (${ENV_VARS.join(", ")})`, "info");
      } else if (loaded.length > 0) {
        ctx.ui.notify(`Opencode auth is partially loaded (${loaded.join(", ")})`, "warning");
      } else {
        ctx.ui.notify("Opencode auth is not loaded in this pi process", "warning");
      }
    },
  });
}
