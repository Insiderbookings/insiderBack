Instrucciones de registro
- Cada insercion agrega una nueva entrada por subida/commit, con un ID numerico incremental (1, 2, 3...).
- Un solo ID por commit aunque incluya varios cambios.
- Ese ID debe incluirse en el comentario del commit a GitHub.
- Para saber que se incluyo en un commit, buscar el ID en este archivo.
- Formato sugerido: "ID N - Titulo breve" seguido de bullets con el detalle.

Resumen de cambios (Back)

Alcance
- Este documento resume las ediciones aplicadas en esta sesion.
- Enumera archivos y el objetivo de cada cambio (no es un diff completo).
- Cada entrada corresponde a un commit/subida.

Sin entradas aun.

ID 1 - Payouts host + influencer (stripe connect)
- Stripe Connect host: `insiderBack/src/controllers/payout.controller.js`, `insiderBack/src/services/payoutProviders.js`, `insiderBack/src/controllers/payment.controller.js` y `insiderBack/src/routes/host.routes.js` agregan onboarding, refresh de cuenta, transfers, webhooks y payout batch.
- Scheduler host: `insiderBack/src/services/payoutScheduler.js` y `insiderBack/src/app.js` programan el batch semanal con cortes configurables.
- Earnings host: `insiderBack/src/controllers/host.controller.js` ahora usa payout_item para neto, ordena por paidAt, y corrige match de host_id.
- Influencer payouts: `insiderBack/src/controllers/influencerPayout.controller.js`, `insiderBack/src/services/influencerPayoutScheduler.js`, `insiderBack/src/routes/user.routes.js` y `insiderBack/src/app.js` agregan batch automatico y endpoints de payouts.
- Influencer stats: `insiderBack/src/controllers/user.controller.js` suma commissions al total de earnings.
