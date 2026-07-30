-- Let a consumer raise a support ticket against an order.
--
-- `consumer_tickets` had no link to an order at all. The seeded example is literally
-- a delivery complaint — "Delivery attempt failed — parcel at depot" — with nothing
-- saying which parcel, so neither the customer nor an agent could get from the ticket
-- to the order or back again.
--
-- `order_ref` rather than the uuid primary key: it is what the consumer sees on the
-- order, what they quote on the phone, and what `consumer_refunds` and
-- `loyalty_ledger` already key on. Unique constraint added on `orders.order_ref`
-- first, since it had none and a foreign key needs one.

alter table orders add constraint orders_order_ref_key unique (order_ref);

alter table consumer_tickets
  add column if not exists order_ref text references orders(order_ref) on delete set null;

comment on column consumer_tickets.order_ref is
  'The order this ticket is about. Null for tickets raised outside an order — billing queries, account problems.';

create index if not exists consumer_tickets_order_ref_idx on consumer_tickets (order_ref);

-- Backfill the one seeded ticket that is plainly about an order. ORD-880788 is the
-- Kestrel handset that was delivered, and the ticket describes a failed delivery
-- attempt on a shipped parcel. The other three are billing, product and technical
-- questions with no order behind them, and stay null.
update consumer_tickets
   set order_ref = 'ORD-880788'
 where id = 'TCK-59120' and order_ref is null;
