import { ADMIN_UI_CSS } from "./styles.js";
import { buildAdminMarkup } from "./view.js";
import { ADMIN_BASE_SCRIPT } from "./scripts/base.js";
import { ADMIN_WORKSPACE_SCRIPT } from "./scripts/workspace.js";
import { ADMIN_SCARAB_SCRIPT } from "./scripts/scarabs.js";
import { ADMIN_CAPTURE_SCRIPT } from "./scripts/capture.js";
import { ADMIN_SESSIONS_SCRIPT } from "./scripts/sessions.js";
import { ADMIN_SESSION_INTEL_SCRIPT } from "./scripts/sessionIntel.js";
import { ADMIN_TOKENS_SCRIPT } from "./scripts/tokens.js";
import { ADMIN_REGEX_SCRIPT } from "./scripts/regex.js";
import { ADMIN_OPS_SCRIPT } from "./scripts/ops.js";
import { ADMIN_HEALTH_SCRIPT } from "./scripts/health.js";
import { ADMIN_WIRE_SCRIPT } from "./scripts/wire.js";

const ADMIN_UI_SCRIPT = [
  ADMIN_BASE_SCRIPT,
  ADMIN_WORKSPACE_SCRIPT,
  ADMIN_SCARAB_SCRIPT,
  ADMIN_CAPTURE_SCRIPT,
  ADMIN_SESSIONS_SCRIPT,
  ADMIN_SESSION_INTEL_SCRIPT,
  ADMIN_TOKENS_SCRIPT,
  ADMIN_REGEX_SCRIPT,
  ADMIN_OPS_SCRIPT,
  ADMIN_HEALTH_SCRIPT,
  ADMIN_WIRE_SCRIPT
].join("\n\n");

export function buildAdminUiHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ScarabEV Admin Plane</title>
  <style>${ADMIN_UI_CSS}</style>
</head>
<body>
${buildAdminMarkup()}
<script>${ADMIN_UI_SCRIPT}</script>
</body>
</html>`;
}
