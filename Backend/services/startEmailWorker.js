
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function startTestEmailWorker() {
  // Solo permitir correos automáticos de prueba.
  const enabled =
    process.env.NODE_ENV !== "production" &&
    process.env.EMAIL_MODE === "test" &&
    process.env.EMAIL_AUTO_SEND === "true";

  if (!enabled) {
    console.log("MALFI: envío automático de pruebas desactivado.");
    return;
  }

  if (
    !process.env.RESEND_API_KEY ||
    !process.env.EMAIL_TEST_TO
  ) {
    console.error(
      "MALFI: faltan credenciales o destinatario de prueba."
    );
    return;
  }

  const scriptPath = fileURLToPath(
    new URL("../scripts/sendOrderEmails.js", import.meta.url)
  );

  const backendPath = fileURLToPath(
    new URL("../", import.meta.url)
  );

  if (!existsSync(scriptPath)) {
    console.error(
      "MALFI: no se encontró scripts/sendOrderEmails.js"
    );
    return;
  }

  // Evitar ejecutar dos revisiones al mismo tiempo.
  let running = false;

  function checkPendingEmails() {
    if (running) return;

    running = true;

    const child = spawn(
      process.execPath,
      [scriptPath, "--send"],
      {
        cwd: backendPath,
        env: process.env,
        windowsHide: true
      }
    );

    child.stdout.on("data", (data) => {
      process.stdout.write(`[MALFI correo] ${data}`);
    });

    child.stderr.on("data", (data) => {
      process.stderr.write(`[MALFI correo] ${data}`);
    });

    child.on("error", (error) => {
      console.error(
        "Error al iniciar el trabajador de correos:",
        error.message
      );
    });

    child.on("close", (code) => {
      running = false;

      if (code !== 0) {
        console.error(
          `MALFI: revisión de correos finalizada con código ${code}.`
        );
      }
    });
  }

  // Primera revisión al iniciar el backend.
  checkPendingEmails();

  // Revisar nuevamente cada 60 segundos.
  const timer = setInterval(
    checkPendingEmails,
    60 * 1000
  );

  timer.unref();

  console.log(
    "MALFI: revisión automática de correos activada (cada 60 segundos)."
  );
}
