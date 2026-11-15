// MALFI - Webpay integracion: conciliacion y liberacion controlada.
// NUNCA ejecutar contra credenciales o base de datos de produccion.
import transbank from "transbank-sdk";
import { finalizeWebpayTest } from "../routes/webpayFinalize.js";

const {
  Environment, IntegrationApiKeys, IntegrationCommerceCodes, Options, WebpayPlus
} = transbank;

const checkEnabled = () =>
  process.env.NODE_ENV !== "production" &&
  process.env.WEBPAY_TEST_MODE === "true";

const validBankResponse = (bank, attempt) =>
  bank &&
  String(bank.buy_order) === String(attempt.buy_order) &&
  String(bank.session_id) === String(attempt.session_id) &&
  Number.isSafeInteger(Number(bank.amount)) &&
  Number(bank.amount) === Number(attempt.amount_clp);

const isAuthorized = bank =>
  bank?.status === "AUTHORIZED" && Number(bank.response_code) === 0;

function makeTransbankClient() {
  return new WebpayPlus.Transaction(new Options(
    IntegrationCommerceCodes.WEBPAY_PLUS,
    IntegrationApiKeys.WEBPAY,
    Environment.Integration
  ));
}

// Acepta FAILED como terminal. INITIALIZED solo con consentimiento
// EXPLICITO en sandbox, retorno del formulario y dos consultas separadas.
function closeReason(bank, attempt, allowInitializedTestRelease, now) {
  if (bank.status === "FAILED") return "transbank_failed";
  if (!allowInitializedTestRelease || bank.status !== "INITIALIZED") return null;

  const ageMs = now - new Date(attempt.created_at).getTime();
  const prevCheckMs = attempt.last_status_check_at
    ? now - new Date(attempt.last_status_check_at).getTime() : 0;
  if (
    ageMs >= 30 * 60_000 &&
    prevCheckMs >= 5 * 60_000 &&
    attempt.last_bank_status === "INITIALIZED" &&
    ["aborted", "timeout"].includes(attempt.return_reason) &&
    attempt.returned_at
  ) {
    return "sandbox_abandoned_initialized";
  }
  return null;
}

async function closeVerifiedAttempt(pool, tx, observed, reason, log) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Todas las rutas de cierre toman el bloqueo del pedido primero.
    const orders = await client.query(
      `SELECT id,status,payment_status,inventory_reserved,stock_deducted_at
       FROM orders WHERE id=$1 FOR UPDATE`, [observed.order_id]
    );
    const order = orders.rows[0];
    if (!order || order.status !== "pending_payment" ||
        order.payment_status !== "pending" ||
        order.inventory_reserved !== true || order.stock_deducted_at !== null) {
      await client.query("ROLLBACK");
      return false;
    }

    const attempts = await client.query(
      `SELECT token_ws,buy_order,session_id,amount_clp,state,finalized_at,
              created_at,last_bank_status,last_status_check_at,return_reason,returned_at
       FROM webpay_test_attempts WHERE order_id=$1 FOR UPDATE`, [observed.order_id]
    );
    const a = attempts.rows[0];
    if (!a || a.token_ws !== observed.token_ws || a.finalized_at !== null ||
        !["created", "review", "processing"].includes(a.state) ||
        a.buy_order !== observed.buy_order || a.session_id !== observed.session_id ||
        String(a.amount_clp) !== String(observed.amount_clp)) {
      await client.query("ROLLBACK");
      return false;
    }
    // Evitar cerrar mientras una confirmacion normal esta en curso.
    if (a.state === "processing") {
      await client.query("ROLLBACK");
      return false;
    }

    const other = await client.query(
      "SELECT 1 FROM mercado_pago_attempts WHERE order_id=$1", [observed.order_id]
    );
    if (other.rowCount !== 0) {
      await client.query("ROLLBACK");
      return false;
    }

    // Segundas comprobaciones, ya con el pedido bloqueado.
    const bank = await tx.status(a.token_ws);
    if (!validBankResponse(bank, a)) {
      throw new Error("Transbank devolvio datos incompatibles durante el cierre.");
    }
    if (reason === "transbank_failed" && bank.status !== "FAILED") {
      await client.query("ROLLBACK");
      return false;
    }
    if (reason === "sandbox_abandoned_initialized" &&
        (bank.status !== "INITIALIZED" ||
         a.return_reason !== observed.return_reason ||
         !["aborted", "timeout"].includes(a.return_reason) ||
         !a.returned_at ||
         new Date() - new Date(a.created_at) < 30 * 60_000)) {
      await client.query("ROLLBACK");
      return false;
    }

    const items = await client.query(
      `SELECT product_id,SUM(quantity)::integer AS quantity
       FROM order_items WHERE order_id=$1
       GROUP BY product_id ORDER BY product_id`, [observed.order_id]
    );
    if (!items.rowCount) throw new Error("Pedido sin productos.");

    const products = await client.query(
      `SELECT id FROM products WHERE id=ANY($1::integer[])
       ORDER BY id FOR UPDATE`, [items.rows.map(item => item.product_id)]
    );
    if (products.rowCount !== items.rowCount) {
      throw new Error("Faltan productos para liberar la reserva.");
    }

    for (const item of items.rows) {
      const released = await client.query(
        `UPDATE products SET reserved_stock=reserved_stock-$1
         WHERE id=$2 AND reserved_stock >= $1 RETURNING id`,
        [item.quantity, item.product_id]
      );
      if (released.rowCount !== 1) throw new Error("Reserva de stock inconsistente.");
    }

    await client.query(
      `UPDATE orders SET status='cancelled',inventory_reserved=FALSE
       WHERE id=$1`, [observed.order_id]
    );
    await client.query(
      `UPDATE webpay_test_attempts
       SET state='rejected_test',close_reason=$2,updated_at=NOW()
       WHERE order_id=$1`, [observed.order_id, reason]
    );
    await client.query("COMMIT");
    log(`Pedido #${observed.order_id}: cancelado y reserva liberada (${reason}).`);
    return true;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

// Default: dry-run, sin modificaciones a PostgreSQL.
export async function reconcileWebpayOnce(pool, {
  apply = false,
  limit = 20,
  log = console.log
} = {}) {
  if (process.env.WEBPAY_RETRIES_ENABLED === "true") {
    throw new Error("Worker 18.7 incompatible con multiples intentos Webpay; usar conciliacion manual 18.8.");
  }
  if (!checkEnabled()) throw new Error("Webpay de integracion no esta habilitado.");
  const tx = makeTransbankClient();
  const lockClient = await pool.connect();
  const summary = { scanned: 0, authorized: 0, released: 0, review: 0, errors: 0 };
  let locked = false;
  try {
    const lock = await lockClient.query(
      "SELECT pg_try_advisory_lock(20261115, 187) AS acquired"
    );
    locked = lock.rows[0]?.acquired === true;
    if (!locked) {
      log("Otra revision Webpay esta activa; se omite este ciclo.");
      return summary;
    }

    const candidates = await lockClient.query(
      `SELECT w.order_id::text AS order_id, w.token_ws, w.buy_order,
              w.session_id,w.amount_clp,w.state,w.created_at,
              w.last_bank_status,w.last_status_check_at,
              w.return_reason,w.returned_at
       FROM webpay_test_attempts w
       JOIN orders o ON o.id=w.order_id
       WHERE o.status='pending_payment'
         AND o.payment_status='pending'
         AND o.inventory_reserved=TRUE
         AND w.finalized_at IS NULL AND w.token_ws IS NOT NULL
         AND w.state IN ('created','review','processing','authorized_test')
         AND w.created_at < NOW()-INTERVAL '3 minutes'
         AND w.created_at > NOW()-INTERVAL '6 days'
         AND (w.last_status_check_at IS NULL OR
              w.last_status_check_at < NOW()-INTERVAL '5 minutes')
       ORDER BY w.created_at ASC
       LIMIT $1`, [limit]
    );
    const allowInitializedTestRelease =
      process.env.WEBPAY_AUTO_RELEASE_INITIALIZED_TEST === "true";

    for (const a of candidates.rows) {
      summary.scanned += 1;
      try {
        const bank = await tx.status(a.token_ws);
        if (!validBankResponse(bank, a)) {
          log(`Pedido #${a.order_id}: datos Transbank no coinciden; revision manual.`);
          summary.review += 1;
          continue;
        }
        const reason = closeReason(bank, a, allowInitializedTestRelease, Date.now());
        log(`Pedido #${a.order_id}: Transbank=${bank.status}, local=${a.state}`);

        // Guardar comprobacion previa sin tocar el pago ni las reservas.
        if (apply) {
          await lockClient.query(
            `UPDATE webpay_test_attempts
             SET last_bank_status=$2,last_status_check_at=NOW()
             WHERE order_id=$1 AND token_ws=$3 AND finalized_at IS NULL`,
            [a.order_id, bank.status, a.token_ws]
          );
        }

        if (isAuthorized(bank)) {
          summary.authorized += 1;
          if (!apply) continue;
          // Promocion local solo tras cotejar autorizacion real.
          const client = await pool.connect();
          let promoted = false;
          try {
            await client.query("BEGIN");
            const o = await client.query(
              `SELECT id,status,payment_status,inventory_reserved
               FROM orders WHERE id=$1 FOR UPDATE`, [a.order_id]
            );
            const w = await client.query(
              `SELECT token_ws,buy_order,session_id,amount_clp,state,finalized_at
               FROM webpay_test_attempts WHERE order_id=$1 FOR UPDATE`, [a.order_id]
            );
            const ord = o.rows[0], attempt = w.rows[0];
            if (ord?.status === "pending_payment" &&
                ord.payment_status === "pending" && ord.inventory_reserved === true &&
                attempt && attempt.finalized_at === null &&
                attempt.token_ws === a.token_ws &&
                ["created", "review", "processing", "authorized_test"].includes(attempt.state) &&
                validBankResponse(bank, attempt)) {
              const other = await client.query(
                "SELECT 1 FROM mercado_pago_attempts WHERE order_id=$1",
                [a.order_id]
              );
              if (other.rowCount === 0) {
                if (attempt.state !== "authorized_test") {
                  await client.query(
                    `UPDATE webpay_test_attempts
                     SET state='authorized_test',response_code=0,updated_at=NOW()
                     WHERE order_id=$1`, [a.order_id]
                  );
                }
                promoted = true;
              }
            }
            await client.query("COMMIT");
          } catch (error) {
            try { await client.query("ROLLBACK"); } catch {}
            throw error;
          } finally {
            client.release();
          }
          if (promoted) {
            const settled = await finalizeWebpayTest(pool, tx, a.order_id);
            log(`Pedido #${a.order_id}: conciliacion ${settled.outcome}.`);
          } else {
            summary.review += 1;
          }
        } else if (reason && a.state !== "authorized_test") {
          if (apply) {
            const closed = await closeVerifiedAttempt(pool, tx, a, reason, log);
            if (closed) summary.released += 1;
          } else {
            log(`Pedido #${a.order_id}: cierre posible (${reason}); solo simulacion.`);
          }
        } else {
          summary.review += 1;
          if (bank.status === "INITIALIZED") {
            log(`Pedido #${a.order_id}: INITIALIZED, reserva conservada para evitar liberacion prematura.`);
          } else {
            log(`Pedido #${a.order_id}: ${bank.status}; requiere revision, no se modifica.`);
          }
        }
      } catch (error) {
        summary.errors += 1;
        log(`Pedido #${a.order_id}: ERROR ${error.message}`);
      }
    }
    return summary;
  } finally {
    if (locked) {
      try {
        await lockClient.query("SELECT pg_advisory_unlock(20261115, 187)");
      } catch (error) { console.error("No se pudo liberar lock Webpay:", error.message); }
    }
    lockClient.release();
  }
}

export function startWebpayReconciliationWorker(pool) {
  if (process.env.WEBPAY_RETRIES_ENABLED === "true") {
    console.warn("MALFI: trabajador 18.7 deshabilitado durante reintentos 18.8 para proteger el historial.");
    return;
  }
  if (!checkEnabled() || process.env.WEBPAY_RECONCILE_AUTO !== "true") {
    console.log("MALFI: conciliacion Webpay automatica desactivada.");
    return;
  }
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const summary = await reconcileWebpayOnce(pool, { apply: true,
        log: message => console.log(`[Webpay] ${message}`) });
      if (summary.scanned) console.log("[Webpay] Resumen:", summary);
    } catch (error) {
      console.error("[Webpay] Reconciliacion fallida:", error.message);
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(tick, 5 * 60_000);
  timer.unref();
  console.log("MALFI: conciliacion Webpay de integracion cada 5 minutos.");
}
