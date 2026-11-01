# Codexify browser companion recovery runbook

This note records a machine-specific Codexify fix for the Admin Windows workstation. The installed Codexify project root is `D:\Projects\Lightbox\lightbox`; configuration and runtime live under `C:\Users\Admin\.codexify`.

## Incident and root causes

The ChatGPT browser repeatedly came to the foreground about every three minutes. Codexify runs its companion with a visible Chromium window (`headless: false`) and a five-second recovery watchdog. In the installed companion bundle, `ChatGptDriver.liveness()` treated a 1.5-second `page.evaluate(() => true)` timeout as a dead browser even when the tab still existed. The watchdog then stopped and relaunched the companion, creating a new visible window.

A second loop made the shared ChatGPT tab visit `https://chatgpt.com/settings/billing`: `completeAccountPlan()` rejected a generic but valid `Pro` label, so the plan cache expired after 60 seconds and retried the billing lookup. Repeated billing navigation could leave the tab busy and contribute to slow health checks.

Earlier, multiple orphaned `codexify.exe service run` processes also competed for ports 3000/3120 and logged “address already in use.” Those stale processes were cleared and the installed scheduled service was started as one instance.

## Applied local fixes

The active Windows companion bundle is `C:\Users\Admin\.codexify\browser\runtime\2.3.25\app\resources\app.asar` (Codexify 2.3.25 was reported as current at the time of repair). Its `dist/main.js` was patched in place:

- The 1.5-second liveness timeout now returns “alive”; the existing catch still reports false if the page/context is actually closed.
- `completeAccountPlan()` now accepts any non-empty plan label, including generic `Pro`, so it is cached and does not repeatedly navigate to Billing.
- The ASAR entry integrity hash was recalculated. The active `dist/main.js` hash is `a5ea50b0271d03fff429359f55608b48f1b364eef29d18334fc3eb34f459747f`.

Because the companion is intentionally headful, a hidden logon task keeps its window off-screen. Task `Codexify-Browser-Background` runs `C:\Users\Admin\.codexify\service\keep-browser-background.ps1`; the script targets only Chrome processes whose command line uses `C:\Users\Admin\.codexify\browser\chrome-profile` and hides those windows. Normal Chrome is unaffected. Browser automation remains enabled in `codexify.config.json`.

The Codexify service uses its installed scheduled task `Codexify`; its health endpoint is `http://127.0.0.1:3000/health`. The configured Codex CLI path is `C:\Users\Admin\AppData\Local\OpenAI\Codex\bin\22cfb1d302613eae\codex.exe`.

## Verification at repair time

After the bundle patch, the same Chrome root process (PID 11516) remained running and its window stayed hidden for more than three minutes. `codexify browser status` reported ready; `codexify doctor` reported 16 passes, zero warnings, and zero failures, including an authenticated/ready companion, healthy service, and valid Codex CLI path. `agentChat.automation.enabled` remained `true`.

## Reapplying after a Codexify update

An official update can replace this local bundle patch. Before reapplying, inspect the new version and current upstream source; do not patch blindly if upstream already includes equivalent fixes.

1. Check `codexify doctor`, `codexify browser status`, and the current `app.asar` version. Verify the bundle still contains the two affected behaviors: a 1.5-second liveness timeout that resolves false, and a plan-completeness check that rejects generic `Pro`.
2. Stop the companion with `codexify browser stop` before editing `app.asar`. Keep a copy of that exact version's original archive first.
3. Locate `dist/main.js` by parsing the ASAR header, not by reusing offsets from another release. Change only the liveness timeout fallback to resolve true (leave the catch for a genuinely closed page intact); accept non-empty `Pro` as a complete plan label. Preserve entry sizes/offsets if possible, then recompute and update the ASAR `integrity.hash` and `integrity.blocks` values for `dist/main.js`.
4. Start the companion with `codexify browser start`. Confirm `codexify browser status` says ready and authenticated, `codexify doctor` is fully healthy, automation remains enabled, the dedicated Chrome window is hidden, and its PID remains stable for at least one three-minute interval.
5. Confirm there is one Codexify service instance and that ports 3000/3120 are owned by it if the service again reports an address-in-use error. Do not terminate unrelated Chrome processes.

The reinstall command `codexify browser install` previously remained running without completing while the installed artifact was already present; its exact process was stopped. Check for a stuck installer before retrying it.

## Backup status

The original archive is `C:\Users\Admin\.codexify\browser\runtime\2.3.25\app\resources\app.asar.pre-liveness-fix-20261031.bak`. The user asked to delete it, but the environment rejected two direct removal attempts with “blocked by policy”; it therefore remained present at the last check. The active `app.asar` is separate and must not be removed when handling that backup request.
