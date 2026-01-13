# Influencers: flujo actual, issues y plan de cambios

## Contexto
Este documento resume el flujo actual de influencers/referidos/comisiones, los problemas detectados y el plan de cambios acordado.

Confirmaciones del negocio:
- Las comisiones anteriores quedan obsoletas.
- La nueva comision de booking es **USD 2 por noche** para reservas de referidos.
- El bonus de signup es **USD 0.5**, y si ese referido hace una reserva, el signup pasa a **USD 1**.

## Flujo actual (resumen)
- El referido se enlaza por codigo de influencer: `referred_by_influencer_id` y `referred_by_code` en `user`.
- Se registra evento de signup y se crean bonos en `influencer_event_commission`.
- En confirmacion de booking se crean:
  - Comision porcentual en `influencer_commission` (por markup o gross).
  - Bonus plano en `influencer_event_commission` para evento `booking`.
- Stats suman ambos tipos de comisiones.
- Payouts agrupan `influencer_commission` + `influencer_event_commission`.

## Problemas detectados
1) Doble pago por booking
   - Se pagan dos cosas por el mismo stay: `influencer_commission` + `influencer_event_commission`.
   - Esto contradice el esquema nuevo y genera sobrepago.

2) Reversa incompleta en cancelaciones
   - Se busca por `booking_id` en `InfluencerCommission`, pero la columna real es `stay_id`.
   - No se revierte el bonus de `InfluencerEventCommission` asociado al stay.

3) Dedupe incorrecto de bonos de evento
   - `findOrCreate` en eventos no incluye `influencer_user_id` en el `where`.
   - En casos raros puede mezclar eventos entre influencers.

4) Moneda inconsistente en bonos
   - Los bonos son en USD, pero se guardan con la moneda de la reserva sin conversion.

5) Inconsistencia de flujo (eventos vs comisiones)
   - Algunos flujos crean comision de evento sin registrar el evento para metas.
   - Esto puede dejar metas incompletas.

## Objetivo funcional (nuevo esquema)
- Booking: **USD 2 por noche reservada** (de un referido).
- Signup: **USD 0.5**, y si el referido hace su primera reserva, el signup sube a **USD 1**.
- El esquema anterior no aplica.

## Decisiones tecnicas propuestas
- **Eliminar InfluencerCommission** del flujo de payouts (o dejarla para legacy, pero no crear nuevas).
- Centralizar la logica de eventos y montos en `referralRewards.service.js`.
- Registrar siempre eventos y bonuses desde un solo lugar.
- Guardar montos en moneda de la reserva, pero convirtiendo desde USD con `FX_USD_RATES`.
- Para el upgrade de signup: actualizar el mismo evento a 1 USD (idempotente) cuando el referido hace la primera reserva.

## Plan de implementacion (propuesto)
1) Ajustar montos por defecto
   - `INFLUENCER_SIGNUP_BONUS_USD = 0.5`
   - `INFLUENCER_BOOKING_BONUS_USD` ya no aplica como fijo por booking, se reemplaza por `USD 2 * nights`.

2) Cambiar el bonus de booking a "por noche"
   - En el registro de evento `booking`, calcular `nights` desde `booking.nights` o `check_in/check_out`.
   - Monto = `2 * nights` (USD), convertir a moneda de la reserva si corresponde.

3) Implementar upgrade de signup
   - Al confirmarse la primera reserva del referido:
     - Buscar evento `signup` del influencer para ese usuario.
     - Si el monto es 0.5, actualizar a 1.0 (idempotente).

4) Desactivar la comision porcentual
   - Dejar de crear `InfluencerCommission` en payment y travelgate.
   - Actualizar stats/payouts para ignorar `InfluencerCommission` o considerar solo legacy.

5) Reversas correctas
   - Revertir `InfluencerEventCommission` asociada al stay cuando se cancela.
   - Corregir lookup por `stay_id` en reversas.

6) Unificacion del flujo
   - Usar solo `recordInfluencerEvent` para signup y booking en todos los controladores.

## Implementado
- Centralizacion del calculo de bonos y eventos en `referralRewards.service.js`:
  - Signup base: USD 0.5
  - Signup upgrade al primer booking: USD 1 (idempotente)
  - Booking: USD 2 por noche, con conversion por `FX_USD_RATES`
  - Dedupe de eventos incluye `influencer_user_id`
- Eliminada la creacion de `InfluencerCommission` en confirmaciones de pago (Stripe y TGX).
- Reversas de comisiones cambiadas a `InfluencerEventCommission` en cancelaciones.
- Stats/payouts ahora usan solo `InfluencerEventCommission`.
- Refuerzo de `nights`: al registrar eventos de booking se recalcula/actualiza `booking.nights` si falta o es invalido.

## Archivos tocados
- `insiderBack/src/services/referralRewards.service.js`
- `insiderBack/src/controllers/payment.controller.js`
- `insiderBack/src/controllers/travelgate-payment.controller.js`
- `insiderBack/src/services/booking.service.js`
- `insiderBack/src/controllers/user.controller.js` (stats)
- `insiderBack/src/controllers/influencerPayout.controller.js` (payouts)

## Notas pendientes
- Definir si se migran o se ignoran comisiones legacy ya existentes.
- Verificar que `booking.nights` se persiste en todos los flujos.
