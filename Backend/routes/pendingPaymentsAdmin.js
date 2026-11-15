
export function registerPendingPaymentsAdmin(
  app,
  pool,
  requireAdmin
) {
  app.get(
    "/api/admin/orders/pending-reservations",
    requireAdmin,
    async (req, res) => {
      res.set("Cache-Control", "no-store");

      try {
        const result = await pool.query(`
          SELECT
            o.id::text AS order_id,
            o.created_at,
            o.total_clp,
            o.status AS order_status,
            o.payment_status,
            o.inventory_reserved,

            FLOOR(
              EXTRACT(
                EPOCH FROM (NOW() - o.created_at)
              ) / 60
            )::integer AS minutes_old,

            w.attempt_no,
            w.state AS webpay_local_state,
            w.last_bank_status,
            w.last_status_check_at,
            w.return_reason,

            EXISTS (
              SELECT 1
              FROM webpay_test_attempts wx
              WHERE wx.order_id = o.id
            ) AS has_webpay,

            EXISTS (
              SELECT 1
              FROM mercado_pago_attempts mp
              WHERE mp.order_id = o.id
            ) AS has_mercado_pago

          FROM orders o

          LEFT JOIN LATERAL (
            SELECT
              attempt_no,
              state,
              last_bank_status,
              last_status_check_at,
              return_reason
            FROM webpay_test_attempts
            WHERE order_id = o.id
              AND is_current = TRUE
            ORDER BY attempt_no DESC
            LIMIT 1
          ) w ON TRUE

          WHERE o.status = 'pending_payment'
            AND o.payment_status = 'pending'
            AND o.inventory_reserved = TRUE
            AND o.created_at <=
                NOW() - INTERVAL '15 minutes'

          ORDER BY o.created_at ASC, o.id ASC
          LIMIT 100
        `);

        res.json({
          orders: result.rows,
          count: result.rowCount
        });

      } catch (error) {
        console.error(
          "Error consultando reservas:",
          error.message
        );

        res.status(500).json({
          error: "No se pudieron consultar los pedidos."
        });
      }
    }
  );
}
