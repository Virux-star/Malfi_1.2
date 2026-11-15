// MALFI 18.9 - Conciliacion conservadora de multiples intentos Webpay.
// SOLO PARA INTEGRACION. No crea cobros ni libera reservas.
import transbank from "transbank-sdk";
import { finalizeWebpayTest } from "../routes/webpayFinalize.js";

const { WebpayPlus, Options, Environment, IntegrationCommerceCodes, IntegrationApiKeys } = transbank;
const LOCK_A = 20261115;
const LOCK_B = 189;

function permitted() {
  return process.env.NODE_ENV !== "production" &&
    process.env.WEBPAY_TEST_MODE === "true" &&
    process.env.WEBPAY_RETRIES_ENABLED === "true";
}

function makeTransaction() {
  return new WebpayPlus.Transaction(new Options(
    IntegrationCommerceCodes.WEBPAY_PLUS,
    IntegrationApiKeys.WEBPAY,
    Environment.Integration
  ));
}

function bankMatches(bank, attempt) {
  return Boolean(bank) &&
    String(bank.buy_order) === String(attempt.buy_order) &&
    String(bank.session_id) === String(attempt.session_id) &&
    Number.isSafeInteger(Number(bank.amount)) &&
    Number(bank.amount) === Number(attempt.amount_clp);
}

// Locks: always order first, then attempt, matching Webpay initiation/finalization.
async function promoteAuthorized(pool, a, bank) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const orderResult = await client.query(
      `SELECT status, payment_status, inventory_reserved, stock_deducted_at
       FROM orders WHERE id=$1 FOR UPDATE`, [a.order_id]
    );
    const order = orderResult.rows[0];
    if (!order || order.status !== "pending_payment" ||
        order.payment_status !== "pending" ||
        order.inventory_reserved !== true || order.stock_deducted_at !== null) {
      await client.query("ROLLBACK");
      return false;
    }
    const attemptResult = await client.query(
      `SELECT attempt_id, order_id, token_ws, buy_order, session_id,
              amount_clp, state, finalized_at, is_current
       FROM webpay_test_attempts
       WHERE attempt_id=$1 AND order_id=$2 FOR UPDATE`,
      [a.attempt_id, a.order_id]
    );
    const attempt = attemptResult.rows[0];
    if (!attempt || !attempt.is_current || attempt.finalized_at !== null ||
        attempt.token_ws !== a.token_ws || !bankMatches(bank, attempt) ||
        !["created", "review", "authorized_test"].includes(attempt.state)) {
      await client.query("ROLLBACK");
      return false;
    }
    const mp = await client.query(
      `SELECT 1 FROM mercado_pago_attempts WHERE order_id=$1`, [a.order_id]
    );
    if (mp.rowCount) {
      await client.query("ROLLBACK");
      return false;
    }
    // The bank authorization has been verified against buy_order, session_id and amount.
    await client.query(
      `UPDATE webpay_test_attempts
       SET state='authorized_test', response_code=0,
           last_bank_status='AUTHORIZED', last_status_check_at=NOW(), updated_at=NOW()
       WHERE attempt_id=$1`, [a.attempt_id]
    );
    await client.query("COMMIT");
    return true;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function reconcileMultiAttemptWebpayOnce(pool, {
  apply = false, limit = 20, log = console.log
} = {}) {
  if (!permitted()) throw new Error("Solo disponible con Webpay de integracion y reintentos habilitados.");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("limit debe ser un entero entre 1 y 100.");
  }
  const tx = makeTransaction();
  const summary = {
    scanned: 0, bankAuthorized: 0, finalized: 0,
    historicalAuthorized: 0, review: 0, errors: 0
  };
  const lockClient = await pool.connect();
  let locked = false;
  try {
    const lock = await lockClient.query(
      "SELECT pg_try_advisory_lock($1,$2) AS acquired", [LOCK_A, LOCK_B]
    );
    locked = lock.rows[0]?.acquired === true;
    if (!locked) {
      log("MALFI: otra conciliacion multiintento esta ejecutandose.");
      return summary;
    }
    const current = await lockClient.query(
      `SELECT w.attempt_id::text AS attempt_id, w.order_id::text AS order_id,
              w.attempt_no, w.token_ws, w.buy_order, w.session_id,
              w.amount_clp, w.state
       FROM webpay_test_attempts w
       JOIN orders o ON o.id=w.order_id
       WHERE w.is_current=TRUE AND w.finalized_at IS NULL
         AND w.token_ws IS NOT NULL
         AND w.state IN ('created', 'review', 'authorized_test')
         AND o.status='pending_payment' AND o.payment_status='pending'
         AND o.inventory_reserved=TRUE
         AND w.created_at < NOW() - INTERVAL '2 minutes'
         AND w.created_at > NOW() - INTERVAL '6 days'
         AND (w.last_status_check_at IS NULL OR
              w.last_status_check_at < NOW() - INTERVAL '5 minutes')
       ORDER BY w.created_at ASC LIMIT $1`, [limit]
    );

    for (const a of current.rows) {
      summary.scanned += 1;
      try {
        const bank = await tx.status(a.token_ws);
        if (!bankMatches(bank, a)) {
          summary.review += 1;
          log(`Pedido #${a.order_id} intento ${a.attempt_no}: datos bancarios incompatibles, revision manual.`);
          continue;
        }
        const authorized = bank.status === "AUTHORIZED" && Number(bank.response_code) === 0;
        log(`Pedido #${a.order_id} intento ${a.attempt_no}: Transbank=${bank.status}, local=${a.state}`);
        if (!apply) {
          if (authorized) summary.bankAuthorized += 1;
          else summary.review += 1;
          continue;
        }
        if (!authorized) {
          // Observation only. FAILED remains available for a user-initiated retry.
          // INITIALIZED is NOT treated as a terminal failure.
          await pool.query(
            `UPDATE webpay_test_attempts
             SET last_bank_status=$2, last_status_check_at=NOW(), updated_at=NOW()
             WHERE attempt_id=$1 AND token_ws=$3 AND is_current=TRUE AND finalized_at IS NULL`,
            [a.attempt_id, bank.status, a.token_ws]
          );
          summary.review += 1;
          continue;
        }
        summary.bankAuthorized += 1;
        const promoted = await promoteAuthorized(pool, a, bank);
        if (!promoted) {
          summary.review += 1;
          log(`Pedido #${a.order_id}: cambio de estado concurrente; no se finalizo.`);
          continue;
        }
        const result = await finalizeWebpayTest(pool, tx, a.order_id, a.attempt_id);
        summary.finalized += 1;
        log(`Pedido #${a.order_id}: resultado de finalizacion ${result.outcome}.`);
      } catch (error) {
        summary.errors += 1;
        log(`Pedido #${a.order_id} intento ${a.attempt_no}: ERROR ${error.message}`);
      }
    }

    // Check older attempts as well: never finalize them automatically.
    // An old attempt later AUTHORIZED may indicate a duplicate-charge risk.
    const historical = await lockClient.query(
      `SELECT w.attempt_id::text AS attempt_id, w.order_id::text AS order_id,
              w.attempt_no, w.token_ws, w.buy_order, w.session_id,
              w.amount_clp
       FROM webpay_test_attempts w
       WHERE w.is_current=FALSE AND w.token_ws IS NOT NULL
         AND w.created_at > NOW() - INTERVAL '6 days'
         AND (w.last_status_check_at IS NULL OR
              w.last_status_check_at < NOW() - INTERVAL '30 minutes')
       ORDER BY w.created_at ASC LIMIT $1`, [limit]
    );
    for (const a of historical.rows) {
      try {
        const bank = await tx.status(a.token_ws);
        if (!bankMatches(bank, a)) {
          summary.review += 1;
          log(`Intento historico ${a.attempt_no} pedido #${a.order_id}: respuesta incompatible.`);
          continue;
        }
        if (apply) {
          await pool.query(
            `UPDATE webpay_test_attempts
             SET last_bank_status=$2,last_status_check_at=NOW(),updated_at=NOW()
             WHERE attempt_id=$1 AND is_current=FALSE`,
            [a.attempt_id, bank.status]
          );
        }
        if (bank.status === "AUTHORIZED" && Number(bank.response_code) === 0) {
          summary.historicalAuthorized += 1;
          log(`ALERTA: pedido #${a.order_id} intento HISTORICO ${a.attempt_no} autorizado. NO se modifico el pedido: requiere revision manual de cobro/reembolso.`);
        }
      } catch (error) {
        summary.errors += 1;
        log(`Pedido #${a.order_id} historico ${a.attempt_no}: ERROR ${error.message}`);
      }
    }
    return summary;
  } finally {
    if (locked) {
      try { await lockClient.query("SELECT pg_advisory_unlock($1,$2)", [LOCK_A, LOCK_B]); }
      catch (error) { console.error("No se pudo liberar lock Webpay:", error.message); }
    }
    lockClient.release();
  }
}

export function startWebpayMultiAttemptWorker(pool) {
  if (!permitted() || process.env.WEBPAY_MULTI_RECONCILE_AUTO !== "true") {
    console.log("MALFI: conciliacion Webpay multiintento desactivada.");
    return;
  }
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const summary = await reconcileMultiAttemptWebpayOnce(pool, { apply: true });
      if (summary.scanned || summary.historicalAuthorized || summary.errors) {
        console.log("MALFI Webpay multiintento:", summary);
      }
    } catch (error) {
      console.error("MALFI: error conciliando Webpay multiintento:", error.message);
    } finally { running = false; }
  };
  void tick();
  const timer = setInterval(tick, 5 * 60_000);
  timer.unref();
  console.log("MALFI: conciliacion Webpay multiintento habilitada cada 5 minutos.");
}
