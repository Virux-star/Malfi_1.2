// MALFI 18.8 - Multiples intentos de Webpay SOLO en modo de integracion.
// Requiere sql/18_8_multiple_webpay_attempts.sql antes de iniciar el backend.
import { finalizeWebpayTest } from "./webpayFinalize.js";
import transbank from "transbank-sdk";
import { randomBytes, randomUUID } from "node:crypto";

const { Environment, IntegrationApiKeys, IntegrationCommerceCodes, Options, WebpayPlus } = transbank;
const isId = id => typeof id === "string" && /^[1-9]\d{0,18}$/.test(id) &&
  BigInt(id) <= 9223372036854775807n;
const matchBank = (bank, a) => bank &&
  String(bank.buy_order) === a.buy_order &&
  String(bank.session_id) === a.session_id &&
  Number.isSafeInteger(Number(bank.amount)) &&
  Number(bank.amount) === Number(a.amount_clp);

export function registerWebpayTest(app, pool, requireAdmin) {
  const tx = new WebpayPlus.Transaction(new Options(
    IntegrationCommerceCodes.WEBPAY_PLUS, IntegrationApiKeys.WEBPAY, Environment.Integration
  ));
  const enabled = () => process.env.NODE_ENV !== "production" &&
    process.env.WEBPAY_TEST_MODE === "true" &&
    process.env.WEBPAY_RETRIES_ENABLED === "true";
  const redirect = (res, result, orderId = null) => {
    const url = new URL("/admin/pedidos", process.env.FRONTEND_URL || "http://localhost:5173");
    url.searchParams.set("webpay", result);
    if (orderId !== null) url.searchParams.set("pedido", String(orderId));
    return res.redirect(303, url.toString());
  };
  const validate = (req, res) => {
    if (!enabled()) { res.status(403).json({ error: "Webpay de pruebas deshabilitado." }); return false; }
    if (!isId(req.params.id)) { res.status(400).json({ error: "ID de pedido no valido." }); return false; }
    return true;
  };

  // Compatibilidad con el panel AdminWebpayReview de la etapa 18.4.
  app.get("/api/admin/webpay/test/status/:id", requireAdmin, async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const found = await pool.query(
        `SELECT o.id, o.status AS order_status, o.payment_status,
                o.inventory_reserved, w.state AS webpay_state,
                w.response_code, w.finalized_at, w.amount_clp,
                w.attempt_no, w.return_reason, w.last_bank_status
         FROM orders o JOIN webpay_test_attempts w ON w.order_id=o.id
         WHERE o.id=$1 AND w.is_current=TRUE`, [req.params.id]
      );
      if (!found.rowCount) return res.status(404).json({error:"Sin intento Webpay actual."});
      return res.json(found.rows[0]);
    } catch (error) {
      console.error("Error consultando Webpay:", error.message);
      return res.status(500).json({error:"No se pudo consultar el intento."});
    }
  });

  // POST: comprobacion SIN cobro ni liberacion. Guarda una observacion del banco.
  app.post("/api/admin/webpay/test/check-retry/:id", requireAdmin, async (req, res) => {
    if (!validate(req, res)) return;
    const id = req.params.id;
    try {
      const order = await pool.query(
        `SELECT status,payment_status,inventory_reserved FROM orders WHERE id=$1`, [id]
      );
      if (!order.rowCount) return res.status(404).json({ error: "Pedido inexistente." });
      const o = order.rows[0];
      const attempts = await pool.query(
        `SELECT attempt_id,attempt_no,state,token_ws,buy_order,session_id,amount_clp,
                created_at,return_reason,last_bank_status,last_status_check_at,finalized_at
         FROM webpay_test_attempts WHERE order_id=$1 AND is_current=TRUE`, [id]
      );
      if (!attempts.rowCount) {
        return res.json({ canRetry: o.status === "pending_payment" &&
          o.payment_status === "pending" && o.inventory_reserved === true,
          reason: "Este pedido no tiene intento anterior." });
      }
      const a = attempts.rows[0];
      if (!a.token_ws) return res.status(409).json({
        canRetry: false, reason: "Intento sin token: requiere revision manual."
      });
      const bank = await tx.status(a.token_ws);
      if (!matchBank(bank, a)) return res.status(409).json({
        canRetry: false, reason: "Los datos de Transbank no coinciden. Revision manual."
      });
      const previous = a.last_status_check_at;
      const previousStatus = a.last_bank_status;
      const sandboxAbandoned = bank.status === "INITIALIZED" &&
        process.env.WEBPAY_ALLOW_INITIALIZED_RETRY_TEST === "true" &&
        ["aborted", "timeout"].includes(a.return_reason) &&
        new Date(a.created_at).getTime() <= Date.now() - 30 * 60_000 &&
        previousStatus === "INITIALIZED" && previous &&
        new Date(previous).getTime() <= Date.now() - 5 * 60_000;
      const manualExpiredTest = bank.status === "INITIALIZED" &&
        process.env.WEBPAY_MANUAL_EXPIRED_RETRY_TEST === "true" &&
        new Date(a.created_at).getTime() <= Date.now() - 60 * 60_000 &&
        previousStatus === "INITIALIZED" && previous &&
        new Date(previous).getTime() <= Date.now() - 5 * 60_000;
      // Preservar la primera consulta para permitir el POST inmediatamente
      // despues de una segunda comprobacion separada al menos 5 minutos.
      await pool.query(
        `UPDATE webpay_test_attempts SET last_bank_status=$2,
            last_status_check_at=CASE WHEN $4::boolean THEN last_status_check_at ELSE NOW() END,
            updated_at=NOW()
         WHERE attempt_id=$1 AND is_current=TRUE AND token_ws=$3`,
        [a.attempt_id, bank.status, a.token_ws,
         Boolean(sandboxAbandoned || manualExpiredTest)]
      );
      const validOrder = o.status === "pending_payment" &&
        o.payment_status === "pending" && o.inventory_reserved === true;
      const canRetry = validOrder && !a.finalized_at &&
        !["processing", "authorized_test"].includes(a.state) &&
        (bank.status === "FAILED" || sandboxAbandoned || manualExpiredTest);
      let reason = `Transbank=${bank.status}. `;
      if (!validOrder) reason += "El pedido no tiene reserva pendiente.";
      else if (bank.status === "AUTHORIZED") reason += "Conciliar este pago; no reintentar.";
      else if (manualExpiredTest && canRetry) reason +=
        "Reintento MANUAL de transaccion expirada: solo integracion. No hay fallo definitivo confirmado.";
      else if (canRetry) reason += "Nuevo intento permitido en integracion.";
      else if (bank.status === "INITIALIZED") reason +=
        "Sin autorizacion confirmada, pero no se considera fallo definitivo.";
      else reason += "No se permite iniciar otro intento automaticamente.";
      return res.json({ canRetry, bankStatus: bank.status, attemptNo: a.attempt_no, reason });
    } catch (error) {
      console.error("Error revisando reintento Webpay:", error.message);
      return res.status(409).json({ error: "No se pudo verificar el intento. Revisa la terminal." });
    }
  });

  // API existente: iniciar Webpay y, si es seguro, crear intento N+1.
  app.post("/api/admin/webpay/test/:id", requireAdmin, async (req, res) => {
    if (!validate(req, res)) return;
    const id = req.params.id;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const orderRes = await client.query(
        `SELECT id,total_clp,status,payment_status,inventory_reserved
         FROM orders WHERE id=$1 FOR UPDATE`, [id]
      );
      const o = orderRes.rows[0];
      if (!o) throw new Error("Pedido no encontrado.");
      if (o.status !== "pending_payment" || o.payment_status !== "pending" ||
          o.inventory_reserved !== true) {
        throw new Error("Solo se puede intentar un pago de un pedido pendiente con reserva activa.");
      }
      const mp = await client.query("SELECT 1 FROM mercado_pago_attempts WHERE order_id=$1", [id]);
      if (mp.rowCount) throw new Error("El pedido tiene intento Mercado Pago; revision manual.");
      const amount = Number(o.total_clp);
      if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Monto invalido.");
      const rows = await client.query(
        `SELECT attempt_id,attempt_no,token_ws,state,is_current,finalized_at,
                buy_order,session_id,amount_clp,created_at,return_reason,
                last_bank_status,last_status_check_at,close_reason
         FROM webpay_test_attempts WHERE order_id=$1 ORDER BY attempt_no FOR UPDATE`, [id]
      );
      const history = rows.rows;
      if (history.length >= 5) throw new Error("Maximo de 5 intentos en pruebas por pedido.");
      if (history.some(a => a.state === "authorized_test" || a.finalized_at)) {
        throw new Error("Existe un intento autorizado/finalizado; conciliar antes de reintentar.");
      }
      // Una unica excepcion manual INITIALIZED por pedido de integracion.
      if (history.some(a => a.close_reason === "sandbox_manual_expired_retry")) {
        throw new Error("Este pedido ya uso un reintento manual de INITIALIZED. Revision manual.");
      }
      const currentList = history.filter(a => a.is_current);
      if (currentList.length > 1) throw new Error("Mas de un intento actual: revision manual.");
      const old = currentList[0];
      if (history.length && !old) throw new Error("No hay intento actual: revision manual.");
      if (old) {
        // No iniciar otro cobro si un intento historico ha pasado a estar autorizado.
        // Por precaucion exigimos FAILED en todos los historicos previos.
        for (const past of history.filter(a => !a.is_current)) {
          if (!past.token_ws) throw new Error("Intento historico sin token: revision manual.");
          const pastBank = await tx.status(past.token_ws);
          if (!matchBank(pastBank, past) || pastBank.status !== "FAILED") {
            throw new Error(`Intento historico ${past.attempt_no}: Transbank=${pastBank?.status || "desconocido"}. No reintentar.`);
          }
        }
        if (!old.token_ws || ["processing", "authorized_test", "starting"].includes(old.state)) {
          throw new Error("El intento anterior no puede reintentarse todavia.");
        }
        // Verificacion final, con pedido e intento bloqueados: no fiarse del frontend.
        const bank = await tx.status(old.token_ws);
        if (!matchBank(bank, old)) throw new Error("Transbank devolvio datos incompatibles.");
        const abandonedTest = bank.status === "INITIALIZED" &&
          process.env.WEBPAY_ALLOW_INITIALIZED_RETRY_TEST === "true" &&
          ["aborted", "timeout"].includes(old.return_reason) &&
          new Date(old.created_at).getTime() <= Date.now() - 30 * 60_000 &&
          old.last_bank_status === "INITIALIZED" && old.last_status_check_at &&
          new Date(old.last_status_check_at).getTime() <= Date.now() - 5 * 60_000;
        // Excepcion explicita, restringida a integracion, para un intento sin
        // retorno que lleva mas de una hora en INITIALIZED. Se exige una primera
        // consulta registrada >=5 minutos antes, y se consulta de nuevo ahora.
        // No constituye prueba de rechazo bancario.
        const manualExpiredTest = bank.status === "INITIALIZED" &&
          process.env.WEBPAY_MANUAL_EXPIRED_RETRY_TEST === "true" &&
          new Date(old.created_at).getTime() <= Date.now() - 60 * 60_000 &&
          old.last_bank_status === "INITIALIZED" && old.last_status_check_at &&
          new Date(old.last_status_check_at).getTime() <= Date.now() - 5 * 60_000;
        if (bank.status !== "FAILED" && !abandonedTest && !manualExpiredTest) {
          throw new Error(`El intento anterior sigue en ${bank.status}; no es seguro reintentar.`);
        }
        await client.query(
          `UPDATE webpay_test_attempts
           SET is_current=FALSE,
               state=CASE WHEN $4::boolean THEN 'rejected_test' ELSE 'review' END,
               close_reason=$2,last_bank_status=$3,last_status_check_at=NOW(),updated_at=NOW()
           WHERE attempt_id=$1 AND is_current=TRUE`,
          [old.attempt_id,
           bank.status === "FAILED" ? "retry_after_failed" :
             manualExpiredTest ? "sandbox_manual_expired_retry" : "sandbox_abandoned_retry",
           bank.status, bank.status === "FAILED"]
        );
      }
      const attemptNo = history.length ? Number(history[history.length - 1].attempt_no) + 1 : 1;
      const buyOrder =
        `M${BigInt(id).toString(36)}${randomBytes(6).toString("hex")}`;
      const sessionId = `MALFI-${randomUUID()}`;
      const returnUrl = new URL(
        "/api/webpay/test/return",
        process.env.WEBPAY_RETURN_BASE_URL || "http://localhost:3000"
      ).toString();
      const inserted = await client.query(
        `INSERT INTO webpay_test_attempts
           (order_id,attempt_no,is_current,buy_order,session_id,amount_clp,state)
         VALUES ($1,$2,TRUE,$3,$4,$5,'starting') RETURNING attempt_id`,
        [id,attemptNo,buyOrder,sessionId,amount]
      );
      const attemptId = inserted.rows[0].attempt_id;
      console.log("MALFI creando pago Webpay:", {
        pedido: id,
        intento: attemptNo,
        buyOrder,
        amount,
        returnUrl,
        createdAt: new Date().toISOString()
      });
      const created = await tx.create(buyOrder, sessionId, amount, returnUrl);
      const u = new URL(created?.url || "https://invalid.example");
      if (!created?.token || u.protocol !== "https:" ||
          u.hostname !== "webpay3gint.transbank.cl") {
        throw new Error("Transbank no devolvio formulario de integracion valido.");
      }
      await client.query(
        `UPDATE webpay_test_attempts
         SET token_ws=$2,webpay_url=$3,state='created',updated_at=NOW()
         WHERE attempt_id=$1`, [attemptId,created.token,created.url]
      );
      await client.query("COMMIT");
      return res.json({ url: created.url, token: created.token,
                        attemptNo, orderId: String(id) });
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      console.error("No se pudo iniciar/reintentar Webpay:", error.message);
      return res.status(409).json({ error: error.message });
    } finally { client.release(); }
  });

  // Conciliacion del intento mas reciente. Nunca escoger uno al azar por order_id.
  app.post("/api/admin/webpay/test/reconcile/:id", requireAdmin, async (req, res) => {
    if (!validate(req, res)) return;
    const id = req.params.id;
    try {
      const found = await pool.query(
        `SELECT attempt_id,token_ws,buy_order,session_id,amount_clp,state
         FROM webpay_test_attempts WHERE order_id=$1 AND is_current=TRUE`, [id]
      );
      if (found.rowCount !== 1 || !found.rows[0].token_ws) {
        return res.status(409).json({ error: "No hay un intento actual para conciliar." });
      }
      const a = found.rows[0];
      if (a.state !== "authorized_test") {
        if (!["created", "review", "processing"].includes(a.state)) {
          return res.status(409).json({ error: "Este intento no esta en estado conciliable." });
        }
        const bank = await tx.status(a.token_ws);
        if (!matchBank(bank, a) || bank.status !== "AUTHORIZED" ||
            Number(bank.response_code) !== 0) {
          return res.status(409).json({ error: `Transbank no confirma el pago: ${bank?.status || "desconocido"}.` });
        }
        const promote = await pool.query(
          `UPDATE webpay_test_attempts
           SET state='authorized_test',response_code=0,updated_at=NOW()
           WHERE attempt_id=$1 AND is_current=TRUE AND state=$2 RETURNING attempt_id`,
          [a.attempt_id,a.state]
        );
        if (!promote.rowCount) throw new Error("El intento cambio mientras se conciliaba.");
      }
      const outcome = await finalizeWebpayTest(pool, tx, id, a.attempt_id);
      return res.json({ message: "Conciliacion completada.", ...outcome });
    } catch (error) {
      console.error("Error conciliando Webpay:", error.message);
      return res.status(409).json({ error: error.message });
    }
  });

  // Mostrar historial sin publicar tokens a React.
  app.get("/api/admin/webpay/test/history/:id", requireAdmin, async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const result = await pool.query(
        `SELECT attempt_no,state,is_current,created_at,return_reason,
                last_bank_status,close_reason,finalized_at
         FROM webpay_test_attempts WHERE order_id=$1 ORDER BY attempt_no`,
        [req.params.id]
      );
      return res.json({ attempts: result.rows });
    } catch (error) {
      console.error("Error consultando historial:", error.message);
      return res.status(500).json({ error: "Error consultando historial de Webpay." });
    }
  });

  const callback = async (req, res) => {
    if (!enabled()) return res.sendStatus(403);
    const params = req.method === "POST" ? (req.body ?? {}) : (req.query ?? {});
    const aborted = typeof params.TBK_TOKEN === "string";
    const timedOut = typeof params.TBK_ID_SESION === "string" &&
      typeof params.TBK_ORDEN_COMPRA === "string" &&
      typeof params.token_ws !== "string";
    if (aborted || timedOut) {
      const buyOrder = params.TBK_ORDEN_COMPRA;
      const sessionId = params.TBK_ID_SESION;
      const tbkToken = aborted ? params.TBK_TOKEN : null;
      if (typeof buyOrder !== "string" || typeof sessionId !== "string" ||
          buyOrder.length > 26 || sessionId.length > 61 ||
          (tbkToken && tbkToken.length > 150)) return redirect(res, "review");
      try {
        const found = await pool.query(
          `SELECT a.attempt_id,a.order_id,a.is_current,o.payment_status
           FROM webpay_test_attempts a JOIN orders o ON o.id=a.order_id
           WHERE a.buy_order=$1 AND a.session_id=$2
             AND ($3::text IS NULL OR a.token_ws=$3::text)`,
          [buyOrder,sessionId,tbkToken]
        );
        if (found.rowCount !== 1) return redirect(res, "review");
        const a = found.rows[0];
        await pool.query(
          `UPDATE webpay_test_attempts
           SET return_reason=$2,returned_at=COALESCE(returned_at,NOW()),updated_at=NOW()
           WHERE attempt_id=$1 AND state IN ('created','review')`,
          [a.attempt_id,aborted ? "aborted" : "timeout"]
        );
        return redirect(res, a.payment_status === "paid" ? "paid" : "interrupted", a.order_id);
      } catch (error) {
        console.error("Error retorno interrumpido Webpay:", error.message);
        return redirect(res, "review");
      }
    }
    const token = params.token_ws;
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{20,150}$/.test(token)) {
      return redirect(res, "review");
    }
    try {
      const previous = await pool.query(
        `SELECT attempt_id,order_id,is_current,state FROM webpay_test_attempts
         WHERE token_ws=$1`, [token]
      );
      if (previous.rowCount !== 1) return redirect(res, "review");
      const a = previous.rows[0];
      if (!a.is_current) {
        console.error("ATENCION: retorno de intento historico Webpay", String(a.attempt_id));
        return redirect(res, "review", a.order_id);
      }
      const claimed = await pool.query(
        `UPDATE webpay_test_attempts SET state='processing',updated_at=NOW()
         WHERE attempt_id=$1 AND is_current=TRUE AND state='created'
         RETURNING order_id,attempt_id,buy_order,session_id,amount_clp`,
        [a.attempt_id]
      );
      if (claimed.rowCount !== 1) {
        const order = await pool.query("SELECT payment_status,status FROM orders WHERE id=$1", [a.order_id]);
        const paid = order.rows[0]?.payment_status === "paid" &&
          order.rows[0]?.status !== "payment_review";
        return redirect(res, paid ? "paid" : "review", a.order_id);
      }
      const attempt = claimed.rows[0];
      let result;
      try {
        result = await tx.commit(token);
      } catch (error) {
        console.error("Error commit Webpay:", error.message);
        await pool.query(
          `UPDATE webpay_test_attempts SET state='review',updated_at=NOW()
           WHERE attempt_id=$1 AND state='processing'`, [a.attempt_id]
        );
        return redirect(res, "review", a.order_id);
      }
      const approved = result.status === "AUTHORIZED" && Number(result.response_code) === 0 &&
        matchBank(result, attempt);
      await pool.query(
        `UPDATE webpay_test_attempts
         SET state=$2,response_code=$3,updated_at=NOW()
         WHERE attempt_id=$1 AND state='processing'`,
        [a.attempt_id,approved ? "authorized_test" : "review",
         Number.isInteger(Number(result.response_code)) ? Number(result.response_code) : null]
      );
      if (!approved) return redirect(res, "not_authorized", a.order_id);
      try {
        const settled = await finalizeWebpayTest(pool, tx, a.order_id, a.attempt_id);
        return redirect(res, settled.outcome === "payment_review" ? "review" : "paid", a.order_id);
      } catch (error) {
        console.error("Webpay autorizado, pendiente de finalizar:", error.message);
        return redirect(res, "review", a.order_id);
      }
    } catch (error) {
      console.error("Error procesando retorno Webpay:", error.message);
      return redirect(res, "review");
    }
  };
  app.get("/api/webpay/test/return", callback);
  app.post("/api/webpay/test/return", callback);
}
