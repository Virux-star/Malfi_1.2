// MALFI 18.10 - Caducidad de pedidos sin NINGUN intento de pago.
// No modifica pedidos que tengan intentos Webpay o Mercado Pago, incluso historicos.
const LOCK_A = 20261115;
const LOCK_B = 1810;

function validMinutes(value) {
  return Number.isInteger(value) && value >= 15 && value <= 1440;
}

function testWritesAllowed() {
  return process.env.NODE_ENV !== "production" &&
    process.env.RESERVATION_EXPIRY_MODE === "test";
}

async function expireOne(pool, orderId, minutes) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");

    // Todas las pasarelas deben bloquear la fila de orders antes de iniciar un intento.
    // Esa misma fila se bloquea aqui: impide cancelar mientras se crea el pago.
    const result = await client.query(
      `SELECT id FROM orders
       WHERE id=$1 AND status='pending_payment'
         AND payment_status='pending' AND inventory_reserved=TRUE
         AND created_at < NOW() - ($2::integer * INTERVAL '1 minute')
       FOR UPDATE`,
      [orderId, minutes]
    );
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return false;
    }

    // Comprobar AMBAS pasarelas bajo el bloqueo del pedido.
    const attempts = await client.query(
      `SELECT
         EXISTS(SELECT 1 FROM mercado_pago_attempts WHERE order_id=$1) AS mercado_pago,
         EXISTS(SELECT 1 FROM webpay_test_attempts WHERE order_id=$1) AS webpay`,
      [orderId]
    );
    if (attempts.rows[0].mercado_pago || attempts.rows[0].webpay) {
      await client.query("ROLLBACK");
      return false;
    }

    const items = await client.query(
      `SELECT product_id, SUM(quantity)::integer AS qty
       FROM order_items WHERE order_id=$1
       GROUP BY product_id ORDER BY product_id`,
      [orderId]
    );
    if (!items.rowCount || items.rows.some(i => !Number.isInteger(i.qty) || i.qty <= 0)) {
      throw new Error("Pedido sin productos o cantidades invalidas");
    }

    // Bloquear todos los productos en orden estable antes de actualizar.
    const productIds = items.rows.map(i => i.product_id);
    const locked = await client.query(
      `SELECT id FROM products
       WHERE id=ANY($1::integer[])
       ORDER BY id FOR UPDATE`,
      [productIds]
    );
    if (locked.rowCount !== productIds.length) {
      throw new Error("No se encontraron todos los productos");
    }

    for (const item of items.rows) {
      const updated = await client.query(
        `UPDATE products
         SET reserved_stock=reserved_stock-$1
         WHERE id=$2 AND reserved_stock >= $1
         RETURNING id`,
        [item.qty, item.product_id]
      );
      if (updated.rowCount !== 1) {
        throw new Error(`Reserva insuficiente en producto ${item.product_id}`);
      }
    }

    const cancelled = await client.query(
      `UPDATE orders
       SET status='cancelled', inventory_reserved=FALSE
       WHERE id=$1 AND status='pending_payment'
         AND payment_status='pending' AND inventory_reserved=TRUE
       RETURNING id`,
      [orderId]
    );
    if (cancelled.rowCount !== 1) {
      throw new Error("El pedido cambio durante la cancelacion");
    }

    await client.query("COMMIT");
    return true;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function expireUnstartedOrdersOnce(pool, {
  apply = false,
  minutes = 60,
  limit = 50,
  log = console.log
} = {}) {
  if (!validMinutes(minutes)) throw new Error("minutes debe estar entre 15 y 1440");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("limit debe estar entre 1 y 100");
  }
  if (apply && !testWritesAllowed()) {
    throw new Error("Los cambios solo estan habilitados con RESERVATION_EXPIRY_MODE=test fuera de produccion");
  }

  const summary = { candidates: 0, cancelled: 0, skipped: 0, errors: 0 };
  const lockClient = await pool.connect();
  let lockAcquired = false;
  try {
    const lock = await lockClient.query(
      "SELECT pg_try_advisory_lock($1,$2) AS acquired",
      [LOCK_A, LOCK_B]
    );
    lockAcquired = lock.rows[0]?.acquired === true;
    if (!lockAcquired) {
      log("Otra revision de reservas esta ejecutandose. Sin cambios.");
      return summary;
    }

    const result = await lockClient.query(
      `SELECT o.id::text AS id
       FROM orders o
       WHERE o.status='pending_payment'
         AND o.payment_status='pending'
         AND o.inventory_reserved=TRUE
         AND o.created_at < NOW() - ($1::integer * INTERVAL '1 minute')
         AND NOT EXISTS (
           SELECT 1 FROM mercado_pago_attempts mp WHERE mp.order_id=o.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM webpay_test_attempts w WHERE w.order_id=o.id
         )
       ORDER BY o.created_at, o.id
       LIMIT $2`,
      [minutes, limit]
    );

    summary.candidates = result.rowCount;
    log(`MALFI reservas: ${apply ? "APLICAR" : "SOLO REVISAR"}, ${result.rowCount} candidato(s) sin intento de pago, mas de ${minutes} min.`);

    for (const { id } of result.rows) {
      if (!apply) {
        log(`  Pedido #${id}: candidato (sin cambios)`);
        continue;
      }
      try {
        const changed = await expireOne(pool, id, minutes);
        if (changed) {
          summary.cancelled += 1;
          log(`  Pedido #${id}: cancelado; reserva liberada`);
        } else {
          summary.skipped += 1;
          log(`  Pedido #${id}: omitido, cambio de estado o intento de pago detectado`);
        }
      } catch (error) {
        summary.errors += 1;
        log(`  Pedido #${id}: ERROR ${error.message}`);
      }
    }
    return summary;
  } finally {
    if (lockAcquired) {
      try {
        await lockClient.query("SELECT pg_advisory_unlock($1,$2)", [LOCK_A, LOCK_B]);
      } catch (error) {
        console.error("No se pudo liberar el bloqueo de caducidad:", error.message);
      }
    }
    lockClient.release();
  }
}

export function startReservationExpiryWorker(pool) {
  if (process.env.NODE_ENV === "production" ||
      process.env.RESERVATION_EXPIRY_MODE !== "test" ||
      process.env.RESERVATION_EXPIRY_AUTO !== "true") {
    console.log("MALFI: caducidad automatica de reservas desactivada.");
    return;
  }

  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const result = await expireUnstartedOrdersOnce(pool, { apply: true });
      if (result.candidates || result.errors) console.log("Resumen de reservas:", result);
    } catch (error) {
      console.error("Error en caducidad automatica:", error.message);
    } finally {
      running = false;
    }
  };

  void run();
  const timer = setInterval(() => void run(), 5 * 60_000);
  timer.unref();
  console.log("MALFI: caducidad de pedidos sin intento de pago, cada 5 minutos (solo pruebas).");
}
