/*
# Seed Operator Console Data (fix: countries as array)
*/

-- 1. operator_profile
INSERT INTO operator_profile (id, operator_name, gmv, commission, commission_rate, active_partners, pending_applications, open_tickets, sla_breaches, settlement_due, total_orders, refund_requests, dunning_cases, churn_risk, avg_order_value, take_rate, forecast_gmv, forecast_commission, forecast_accuracy)
VALUES ('default', 'Aventa Communications', 711108.93, 66304.03, 9.3, 15, 3, 8, 2, 12, 2600, 5, 4, 23, 273.50, 9.3, 742000, 69000, 4.2)
ON CONFLICT (id) DO UPDATE SET
  operator_name = EXCLUDED.operator_name, gmv = EXCLUDED.gmv, commission = EXCLUDED.commission, commission_rate = EXCLUDED.commission_rate, active_partners = EXCLUDED.active_partners, pending_applications = EXCLUDED.pending_applications, open_tickets = EXCLUDED.open_tickets, sla_breaches = EXCLUDED.sla_breaches, settlement_due = EXCLUDED.settlement_due, total_orders = EXCLUDED.total_orders, refund_requests = EXCLUDED.refund_requests, dunning_cases = EXCLUDED.dunning_cases, churn_risk = EXCLUDED.churn_risk, avg_order_value = EXCLUDED.avg_order_value, take_rate = EXCLUDED.take_rate, forecast_gmv = EXCLUDED.forecast_gmv, forecast_commission = EXCLUDED.forecast_commission, forecast_accuracy = EXCLUDED.forecast_accuracy;

-- 2. onboarding_gates
INSERT INTO onboarding_gates (id, partner_id, partner_name, gate_name, gate_order, status, owner, target_days, dual_control, waivable, submitted_by, submitted_at, reviewed_by, reviewed_at, evidence, notes, sort_order) VALUES
('og-001','P-013','Nimbus IoT Solutions','Application',1,'cleared','Onboarding Desk',1,false,true,'partner','2026-07-20','Onboarding Desk','2026-07-20',ARRAY['Business registration','Tax certificate'],'Self-submitted application',1),
('og-002','P-013','Nimbus IoT Solutions','KYC & due diligence',2,'cleared','Compliance',3,true,false,'system','2026-07-20','Compliance Team','2026-07-23',ARRAY['Sanctions screen','UBO declaration'],'No adverse findings',2),
('og-003','P-013','Nimbus IoT Solutions','Agreements',3,'cleared','Legal',2,true,false,'Legal Team','2026-07-23','Legal Team','2026-07-24',ARRAY['Signed MSA','Commission schedule'],'MSA signed 24 Jul',3),
('og-004','P-013','Nimbus IoT Solutions','Bank & tax',4,'current','Finance',2,true,false,null,null,null,null,ARRAY[]::text[],'Awaiting bank verification',4),
('og-005','P-013','Nimbus IoT Solutions','Technical readiness',5,'pending','Integrations',1,true,false,null,null,null,null,ARRAY[]::text[],'Not started',5),
('og-006','P-013','Nimbus IoT Solutions','Compliance review',6,'pending','Compliance',1,true,false,null,null,null,null,ARRAY[]::text[],'Not started',6),
('og-007','P-013','Nimbus IoT Solutions','Go-live',7,'pending','Onboarding Desk',1,true,false,null,null,null,null,ARRAY[]::text[],'Not started',7),
('og-008','P-014','Sentinel Cyber Systems','Application',1,'cleared','Onboarding Desk',1,false,true,'partner','2026-07-15','Onboarding Desk','2026-07-15',ARRAY['Business registration'],'Desk-created: strategic security partner',8),
('og-009','P-014','Sentinel Cyber Systems','KYC & due diligence',2,'cleared','Compliance',3,true,false,'system','2026-07-15','Compliance Team','2026-07-18',ARRAY['Sanctions screen'],'Clean',9),
('og-010','P-014','Sentinel Cyber Systems','Agreements',3,'cleared','Legal',2,true,false,'Legal','2026-07-18','Legal Team','2026-07-19',ARRAY['Signed MSA'],'MSA signed',10),
('og-011','P-014','Sentinel Cyber Systems','Bank & tax',4,'cleared','Finance',2,true,false,'Finance','2026-07-19','Finance Team','2026-07-21',ARRAY['Bank verification','Tax residency'],'Verified',11),
('og-012','P-014','Sentinel Cyber Systems','Technical readiness',5,'current','Integrations',1,true,false,null,null,null,null,ARRAY['Endpoint registered'],'Sandbox order in progress',12),
('og-013','P-014','Sentinel Cyber Systems','Compliance review',6,'pending','Compliance',1,true,false,null,null,null,null,ARRAY[]::text[],'Not started',13),
('og-014','P-014','Sentinel Cyber Systems','Go-live',7,'pending','Onboarding Desk',1,true,false,null,null,null,null,ARRAY[]::text[],'Not started',14),
('og-015','P-015','StreamNova Media','Application',1,'cleared','Onboarding Desk',1,false,true,'partner','2026-07-25','Onboarding Desk','2026-07-25',ARRAY['Business registration'],'Self-submitted',15),
('og-016','P-015','StreamNova Media','KYC & due diligence',2,'current','Compliance',3,true,false,null,null,null,null,ARRAY[]::text[],'In progress — sanctions screen running',16),
('og-017','P-015','StreamNova Media','Agreements',3,'pending','Legal',2,true,false,null,null,null,null,ARRAY[]::text[],'Not started',17),
('og-018','P-015','StreamNova Media','Bank & tax',4,'pending','Finance',2,true,false,null,null,null,null,ARRAY[]::text[],'Not started',18),
('og-019','P-015','StreamNova Media','Technical readiness',5,'pending','Integrations',1,true,false,null,null,null,null,ARRAY[]::text[],'Not started',19),
('og-020','P-015','StreamNova Media','Compliance review',6,'pending','Compliance',1,true,false,null,null,null,null,ARRAY[]::text[],'Not started',20),
('og-021','P-015','StreamNova Media','Go-live',7,'pending','Onboarding Desk',1,true,false,null,null,null,null,ARRAY[]::text[],'Not started',21)
ON CONFLICT (id) DO NOTHING;

-- 3. operator_listings
INSERT INTO operator_listings (id, product_name, partner_name, category, price, cost, status, submitted_at, reviewed_by, reviewed_at, rating, reviews, stock_status, version, sort_order) VALUES
('ol-001','Aventa Freedom 50GB Plan','Aventa (First-party)','Consumer',29.99,12.00,'approved','2026-06-01','Catalogue Team','2026-06-02',4.2,312,'in',3,1),
('ol-002','Aventa Unlimited Plan','Aventa (First-party)','Consumer',45.00,18.00,'approved','2026-06-01','Catalogue Team','2026-06-02',4.5,528,'in',2,2),
('ol-003','K9 Pro 5G Smartphone','TechDyne Devices','Device',699.00,520.00,'approved','2026-06-03','Catalogue Team','2026-06-04',4.7,89,'in',1,3),
('ol-004','Nimbus NB-IoT Sensor Pack (25)','Nimbus IoT Solutions','IoT',1250.00,890.00,'approved','2026-07-05','Catalogue Team','2026-07-06',4.1,12,'low',2,4),
('ol-005','Sentinel Managed Firewall','Sentinel Cyber Systems','Security',899.00,600.00,'approved','2026-07-08','Catalogue Team','2026-07-09',4.3,34,'in',1,5),
('ol-006','StreamNova Sports Add-on','StreamNova Media','Digital Content',9.99,3.50,'pending','2026-07-26',null,null,null,0,'in',1,6),
('ol-007','StreamNova Base Streaming','StreamNova Media','Digital Content',14.99,5.00,'pending','2026-07-26',null,null,null,0,'in',1,7),
('ol-008','Nimbus Mesh Gateway Pack','Nimbus IoT Solutions','IoT',890.00,620.00,'pending','2026-07-24',null,null,null,0,'in',1,8),
('ol-009','Sentinel MDR Pro','Sentinel Cyber Systems','Security',1499.00,950.00,'pending','2026-07-25',null,null,null,0,'in',1,9),
('ol-010','TechDyne CPE Router X1','TechDyne Devices','Device',249.00,180.00,'approved','2026-06-10','Catalogue Team','2026-06-11',4.0,45,'in',2,10),
('ol-011','Aventa Halo Family Plan','Aventa (First-party)','Consumer',79.99,32.00,'approved','2026-06-01','Catalogue Team','2026-06-02',4.6,210,'in',2,11),
('ol-012','CloudSync Pro Seats','CloudSync Labs','Partner',12.00,4.00,'rejected','2026-07-20','Catalogue Team','2026-07-21',null,0,'in',1,12)
ON CONFLICT (id) DO NOTHING;

-- 4. settlement_statements
INSERT INTO settlement_statements (id, partner_name, period, gross, commission, commission_rate, fees, withholding, refunds, net, status, order_count, currency, submitted_at, approved_by, approved_at, disputed, sort_order) VALUES
('ss-001','TechDyne Devices','Jul 2026',142580.00,13259.94,9.3,2100.00,0,340.00,126880.06,'pending',520,'USD','2026-07-25',null,null,false,1),
('ss-002','Nimbus IoT Solutions','Jul 2026',98420.00,9153.06,9.3,1450.00,0,0,87816.94,'pending',185,'USD','2026-07-25',null,null,false,2),
('ss-003','Sentinel Cyber Systems','Jul 2026',87650.00,8151.45,9.3,980.00,0,120.00,75398.55,'pending',98,'USD','2026-07-25',null,null,false,3),
('ss-004','CloudSync Labs','Jul 2026',54300.00,5049.90,9.3,620.00,0,0,48630.10,'pending',410,'USD','2026-07-25',null,null,false,4),
('ss-005','StreamNova Media','Jul 2026',42180.00,3922.74,9.3,380.00,0,0,37877.26,'pending',680,'USD','2026-07-25',null,null,false,5),
('ss-006','Aventa (First-party)','Jul 2026',98000.00,0,0,0,0,0,98000.00,'approved',340,'USD','2026-07-20','Finance Team','2026-07-22',false,6),
('ss-007','TechDyne Devices','Jun 2026',138200.00,12852.60,9.3,2050.00,0,280.00,123017.40,'approved',505,'USD','2026-06-25','Finance Team','2026-06-27',false,7),
('ss-008','Nimbus IoT Solutions','Jun 2026',92100.00,8565.30,9.3,1380.00,0,0,82154.70,'approved',172,'USD','2026-06-25','Finance Team','2026-06-27',false,8),
('ss-009','Sentinel Cyber Systems','Jun 2026',84300.00,7839.90,9.3,950.00,0,0,75510.10,'approved',94,'USD','2026-06-25','Finance Team','2026-06-27',false,9),
('ss-010','CloudSync Labs','Jun 2026',51800.00,4817.40,9.3,600.00,0,0,46382.60,'approved',395,'USD','2026-06-25','Finance Team','2026-06-27',false,10),
('ss-011','StreamNova Media','Jun 2026',40120.00,3731.16,9.3,360.00,0,0,36028.84,'approved',650,'USD','2026-06-25','Finance Team','2026-06-27',false,11),
('ss-012','Aventa (First-party)','Jun 2026',95000.00,0,0,0,0,0,95000.00,'approved',330,'USD','2026-06-20','Finance Team','2026-06-22',false,12)
ON CONFLICT (id) DO NOTHING;

-- 5. operator_inventory
INSERT INTO operator_inventory (id, product_name, partner_name, warehouse, on_hand, reserved, available, reorder_point, inbound, inbound_due, unit_cost, last_count, category, sort_order) VALUES
('inv-001','K9 Pro 5G Smartphone','TechDyne Devices','Mumbai East',450,120,330,100,200,'2026-08-05',520.00,'2026-07-20','Device',1),
('inv-002','TechDyne CPE Router X1','TechDyne Devices','Mumbai East',890,210,680,200,0,null,180.00,'2026-07-20','Device',2),
('inv-003','Nimbus NB-IoT Sensor Pack (25)','Nimbus IoT Solutions','Dubai South',120,45,75,50,100,'2026-08-10',890.00,'2026-07-18','IoT',3),
('inv-004','Nimbus Mesh Gateway Pack','Nimbus IoT Solutions','Dubai South',60,15,45,30,0,null,620.00,'2026-07-18','IoT',4),
('inv-005','Sentinel Managed Firewall','Sentinel Cyber Systems','Nairobi Hub',0,0,0,10,50,'2026-08-01',600.00,'2026-07-15','Security',5),
('inv-006','Aventa Freedom SIM','Aventa (First-party)','Mumbai East',12000,3200,8800,2000,5000,'2026-08-01',2.00,'2026-07-22','Consumer',6),
('inv-007','Aventa Halo SIM','Aventa (First-party)','Mumbai East',8000,1800,6200,1500,0,null,2.50,'2026-07-22','Consumer',7),
('inv-008','StreamNova Access Codes','StreamNova Media','Digital (virtual)',99999,0,99999,0,0,null,0.50,'2026-07-25','Digital Content',8)
ON CONFLICT (id) DO NOTHING;

-- 6. operator_warehouses (countries as text[] array)
INSERT INTO operator_warehouses (id, name, type, address, timezone, despatch_cutoff, capacity, utilisation, categories, countries, system_name, sync_mode, sync_state, last_sync, tax_reg, sort_order) VALUES
('wh-001','Mumbai East','fulfilment','Plot 14, MIDC Andheri East, Mumbai','Asia/Kolkata','16:00',10000,7400,ARRAY['Device','Consumer'],ARRAY['India'],'SAP EWM','real-time','healthy','2026-07-28 06:30:00+00','GSTIN-27AAACR5055K1Z5',1),
('wh-002','Dubai South','fulfilment','Logistics District, Dubai South','Asia/Dubai','15:00',5000,3200,ARRAY['IoT'],ARRAY['UAE'],'Oracle WMS','batch','healthy','2026-07-28 04:00:00+00','TRN-10012345678',2),
('wh-003','Nairobi Hub','fulfilment','JKIA Cargo Village, Nairobi','Africa/Nairobi','14:00',3000,1800,ARRAY['Security','Device'],ARRAY['Kenya'],'Manhattan WMS','real-time','degraded','2026-07-28 05:15:00+00','KRA-P051234567A',3),
('wh-004','Returns Centre','returns','Plot 22, Bhiwandi, Maharashtra','Asia/Kolkata','12:00',2000,450,ARRAY['Device','IoT'],ARRAY['India'],'SAP EWM','batch','healthy','2026-07-28 03:00:00+00','GSTIN-27AAACR5055K1Z5',4)
ON CONFLICT (id) DO NOTHING;

-- 7. operator_tickets
INSERT INTO operator_tickets (id, subject, category, priority, status, opened_by, org, owner, opened_at, sla_mins, response_mins, resolution_mins, breached, escalated, escalated_at, waiting_on_customer, messages, sort_order) VALUES
('tk-001','SIM activation failed for order #ORD-2841','Provisioning','P1','open','Priya Raman','Consumer',null,'2026-07-27 14:30:00+00',240,null,null,false,false,null,false,'[{"who":"Priya Raman","when":"2026-07-27 14:30","text":"SIM not activating after 24 hours. Order ORD-2841."},{"who":"System","when":"2026-07-27 14:31","text":"Auto-routed to Provisioning queue."}]'::jsonb,1),
('tk-002','Refund not received for returned K9 Pro','Billing','P2','open','Rajesh Kumar','Consumer','Finance Team','2026-07-26 09:15:00+00',480,120,null,false,false,null,false,'[{"who":"Rajesh Kumar","when":"2026-07-26 09:15","text":"Returned device on 20 Jul, refund still pending."},{"who":"Finance Team","when":"2026-07-26 11:00","text":"Checking with warehouse on receipt confirmation."}]'::jsonb,2),
('tk-003','IoT sensor pack delivery delayed','Logistics','P2','open','Acme Logistics','Enterprise',null,'2026-07-25 16:00:00+00',480,null,null,true,true,'2026-07-27 16:00:00+00',true,'[{"who":"Acme Logistics","when":"2026-07-25 16:00","text":"Order ORD-3201, 3 days past expected delivery."},{"who":"System","when":"2026-07-27 16:00","text":"Escalated: SLA breach on P2 logistics ticket."}]'::jsonb,3),
('tk-004','Settlement statement discrepancy','Finance','P3','open','TechDyne Admin','TechDyne Devices','Finance Team','2026-07-24 11:30:00+00',960,60,null,false,false,null,false,'[{"who":"TechDyne Admin","when":"2026-07-24 11:30","text":"Commission rate on Jul statement shows 9.3% but contract says 8.5%."},{"who":"Finance Team","when":"2026-07-24 12:30","text":"Reviewing contract schedule. May be a mid-period rate change."}]'::jsonb,4),
('tk-005','Cannot access partner portal after password change','Access','P3','open','CloudSync Admin','CloudSync Labs',null,'2026-07-23 10:00:00+00',480,null,null,false,false,null,true,'[{"who":"CloudSync Admin","when":"2026-07-23 10:00","text":"Changed password, now getting access denied."}]'::jsonb,5),
('tk-006','Listing rejected without clear reason','Catalogue','P4','resolved','StreamNova Media','StreamNova Media','Catalogue Team','2026-07-20 14:00:00+00',960,30,120,false,false,null,false,'[{"who":"StreamNova Media","when":"2026-07-20 14:00","text":"My listing was rejected but no reason given."},{"who":"Catalogue Team","when":"2026-07-20 14:30","text":"Checking rejection notes."},{"who":"Catalogue Team","when":"2026-07-20 16:00","text":"Rejected due to missing alt text on media. Please add and resubmit."}]'::jsonb,6),
('tk-007','eSIM profile stuck in released state','Provisioning','P2','open','IT Admin','Enterprise',null,'2026-07-26 08:00:00+00',240,null,null,false,false,null,false,'[{"who":"IT Admin","when":"2026-07-26 08:00","text":"eSIM profile not moving to installed state for 50 devices."}]'::jsonb,7),
('tk-008','Bulk upload failed for 200 SIMs','Provisioning','P3','resolved','Nimbus Admin','Nimbus IoT Solutions','Integrations Team','2026-07-22 13:00:00+00',480,45,200,false,false,null,false,'[{"who":"Nimbus Admin","when":"2026-07-22 13:00","text":"Bulk ICCID upload processing but 200 sims showing error."},{"who":"Integrations Team","when":"2026-07-22 13:45","text":"Fixed: template column mismatch. Re-uploaded successfully."}]'::jsonb,8)
ON CONFLICT (id) DO NOTHING;

-- 8. operator_audit_log
INSERT INTO operator_audit_log (id, when_ts, actor, role, action, object, category, severity, before_val, after_val, outcome, session_id, hash, prev_hash) VALUES
('al-001','2026-07-28 08:15:00+00','Anika Sharma','Operator Admin','settlement.approve','ss-001','Settlement','high',null,null,'success','sess-001','h001',null),
('al-002','2026-07-28 08:10:00+00','Anika Sharma','Operator Admin','listing.approve','ol-005','Catalogue','info','pending','approved','success','sess-001','h002','h001'),
('al-003','2026-07-28 07:45:00+00','Vikram Patel','Finance Auditor','settlement.view','ss-001','Settlement','info',null,null,'success','sess-002','h003','h002'),
('al-004','2026-07-27 16:00:00+00','System','System','ticket.escalate','tk-003','Support','warning','open','escalated','success','system','h004','h003'),
('al-005','2026-07-27 14:30:00+00','Priya Raman','Consumer','ticket.create','tk-001','Support','info',null,null,'success','sess-003','h005','h004'),
('al-006','2026-07-26 11:00:00+00','Finance Team','Finance','ticket.reply','tk-002','Support','info',null,null,'success','sess-004','h006','h005'),
('al-007','2026-07-25 09:00:00+00','Rohit Singh','Integrations','api.publish','AP-CAT','Developer Portal','info','draft','current','success','sess-005','h007','h006'),
('al-008','2026-07-24 12:30:00+00','Finance Team','Finance','ticket.reply','tk-004','Support','info',null,null,'success','sess-004','h008','h007'),
('al-009','2026-07-23 10:00:00+00','CloudSync Admin','Partner','ticket.create','tk-005','Access','info',null,null,'success','sess-006','h009','h008'),
('al-010','2026-07-22 13:45:00+00','Integrations Team','Integrations','ticket.resolve','tk-008','Support','info','open','resolved','success','sess-007','h010','h009'),
('al-011','2026-07-21 10:00:00+00','Catalogue Team','Catalogue','listing.reject','ol-012','Catalogue','info','pending','rejected','success','sess-008','h011','h010'),
('al-012','2026-07-20 14:30:00+00','Catalogue Team','Catalogue','ticket.reply','tk-006','Support','info',null,null,'success','sess-008','h012','h011')
ON CONFLICT (id) DO NOTHING;

-- 9. operator_apis
INSERT INTO operator_apis (id, name, standard, audience, description, why, scopes, methods, environments, lifecycle, version, subscriber_count, sort_order) VALUES
('AP-CAT','Catalogue','TMF620','Sellers','Product catalogue management — list, create, update listings','Sellers need API access to manage their catalogue without logging in',ARRAY['catalogue:read','catalogue:write'],ARRAY['GET','POST','PATCH'],ARRAY['sandbox','production'],'current','2.1',5,1),
('AP-ORD','Orders','TMF622','Sellers','Product order management — receive and track orders','Sellers need to pull and update orders programmatically',ARRAY['orders:read','orders:write'],ARRAY['GET','POST','PATCH'],ARRAY['sandbox','production'],'current','1.3',5,2),
('AP-SUB','Subscriptions','TMF637','Sellers','Subscription lifecycle management','Sellers managing recurring services need subscription API access',ARRAY['subscriptions:read','subscriptions:write'],ARRAY['GET','POST','PATCH','DELETE'],ARRAY['sandbox','production'],'current','1.1',3,3),
('AP-INV','Inventory','TMF685','Sellers','Inventory and stock level management','Sellers need to sync stock levels without manual updates',ARRAY['inventory:read','inventory:write'],ARRAY['GET','PATCH'],ARRAY['sandbox','production'],'current','1.0',4,4),
('AP-SET','Settlement','TMF678','Sellers','Settlement statements and payout records','Sellers reconcile payouts through API rather than portal',ARRAY['settlement:read'],ARRAY['GET'],ARRAY['sandbox','production'],'current','1.2',5,5),
('AP-PTY','Party','TMF632','Sellers, Buyers','Party management — organisation and contact details','Parties need to manage their own records',ARRAY['party:read','party:write'],ARRAY['GET','PATCH'],ARRAY['sandbox','production'],'current','1.0',4,6),
('AP-EVT','Event Subscriptions','TMF688 / AsyncAPI','Sellers','Webhook event subscriptions and delivery','Sellers register endpoints to receive marketplace events',ARRAY['events:read','events:write'],ARRAY['GET','POST','DELETE'],ARRAY['sandbox','production'],'current','1.1',5,7)
ON CONFLICT (id) DO NOTHING;

-- 10. operator_api_subscriptions
INSERT INTO operator_api_subscriptions (id, api_id, consumer_name, version, environment, scopes, volume, started_at, status, sort_order) VALUES
('sub-001','AP-CAT','TechDyne Devices','2.1','production',ARRAY['catalogue:read','catalogue:write'],12500,'2026-06-15','active',1),
('sub-002','AP-ORD','TechDyne Devices','1.3','production',ARRAY['orders:read','orders:write'],8200,'2026-06-15','active',2),
('sub-003','AP-CAT','Nimbus IoT Solutions','2.1','production',ARRAY['catalogue:read','catalogue:write'],3400,'2026-07-10','active',3),
('sub-004','AP-ORD','Nimbus IoT Solutions','1.3','sandbox',ARRAY['orders:read'],450,'2026-07-20','active',4),
('sub-005','AP-SET','Sentinel Cyber Systems','1.2','production',ARRAY['settlement:read'],1200,'2026-07-12','active',5),
('sub-006','AP-CAT','CloudSync Labs','2.1','production',ARRAY['catalogue:read'],8900,'2026-06-20','active',6),
('sub-007','AP-INV','TechDyne Devices','1.0','production',ARRAY['inventory:read','inventory:write'],5600,'2026-06-15','active',7),
('sub-008','AP-EVT','Sentinel Cyber Systems','1.1','sandbox',ARRAY['events:read','events:write'],230,'2026-07-22','active',8),
('sub-009','AP-SUB','CloudSync Labs','1.1','sandbox',ARRAY['subscriptions:read'],120,'2026-07-15','active',9),
('sub-010','AP-PTY','TechDyne Devices','1.0','production',ARRAY['party:read'],3200,'2026-06-15','active',10)
ON CONFLICT (id) DO NOTHING;

-- 11. operator_roles
INSERT INTO operator_roles (id, name, description, is_builtin, assigned_count, audit_categories, capabilities, sort_order) VALUES
('role-001','Operator Admin','Full platform access — all modules and configuration',true,2,ARRAY['Settlement','Catalogue','Onboarding','Security','Access','Configuration','Support','Inventory','Billing','Developer Portal','Promotions','Audit'],'{"settlement":"full","catalogue":"full","onboarding":"full","inventory":"full","tickets":"full","audit":"full","roles":"full","promotions":"full","developer_portal":"full","billing":"full","channels":"full","banners":"full","dunning":"full","warehouses":"full"}'::jsonb,1),
('role-002','Finance Auditor','Settlement approval, billing, tax, GL',true,2,ARRAY['Settlement','Billing','Audit'],'{"settlement":"full","billing":"full","audit":"read","tax":"full","ledger":"full","dunning":"read"}'::jsonb,2),
('role-003','Catalogue Reviewer','Listing review and approval',true,1,ARRAY['Catalogue'],'{"catalogue":"full","listings":"full"}'::jsonb,3),
('role-004','Onboarding Desk','Partner onboarding gate management',true,2,ARRAY['Onboarding'],'{"onboarding":"full"}'::jsonb,4),
('role-005','Compliance Officer','KYC, sanctions, compliance review',true,1,ARRAY['Onboarding','Compliance'],'{"onboarding":"scoped","compliance":"full"}'::jsonb,5),
('role-006','Integrations Engineer','Developer portal, API management, partner endpoints',true,1,ARRAY['Developer Portal'],'{"developer_portal":"full","integrations":"full"}'::jsonb,6),
('role-007','Support Agent','Ticket queue and customer support',true,3,ARRAY['Support'],'{"tickets":"full","support":"full"}'::jsonb,7),
('role-008','Warehouse Manager','Inventory, routing, WMS',true,1,ARRAY['Inventory'],'{"inventory":"full","warehouses":"full","routing":"full"}'::jsonb,8),
('role-009','Collections Officer','Dunning and receivables',true,1,ARRAY['Billing'],'{"dunning":"full","collections":"full"}'::jsonb,9),
('role-010','Tax & Compliance','Tax configuration, jurisdictions, MoR',true,1,ARRAY['Billing','Configuration'],'{"tax":"full","mor":"full"}'::jsonb,10),
('role-011','Growth & Promotions','Promotions, banners, advertising',true,1,ARRAY['Promotions'],'{"promotions":"full","banners":"full"}'::jsonb,11),
('role-012','Security Admin','Access control, credential security, sessions',true,2,ARRAY['Security','Access'],'{"security":"full","access":"full","sessions":"full"}'::jsonb,12),
('role-013','Read-Only Analyst','Dashboard and reports, no write',true,1,ARRAY['Audit'],'{"dashboard":"read","reports":"read","audit":"read"}'::jsonb,13)
ON CONFLICT (id) DO NOTHING;

-- 12. operator_users
INSERT INTO operator_users (id, name, email, role_id, role_name, status, last_active, mfa_enabled, joined_at, sort_order) VALUES
('ou-001','Anika Sharma','anika.sharma@aventa.com','role-001','Operator Admin','active','2026-07-28 08:15:00+00',true,'2026-01-15 09:00:00+00',1),
('ou-002','Vikram Patel','vikram.patel@aventa.com','role-002','Finance Auditor','active','2026-07-28 07:45:00+00',true,'2026-01-20 09:00:00+00',2),
('ou-003','Meera Nair','meera.nair@aventa.com','role-003','Catalogue Reviewer','active','2026-07-28 06:30:00+00',false,'2026-02-01 09:00:00+00',3),
('ou-004','Arjun Reddy','arjun.reddy@aventa.com','role-004','Onboarding Desk','active','2026-07-27 16:00:00+00',false,'2026-02-15 09:00:00+00',4),
('ou-005','Sneha Iyer','sneha.iyer@aventa.com','role-004','Onboarding Desk','active','2026-07-27 14:00:00+00',true,'2026-03-01 09:00:00+00',5),
('ou-006','Karthik Menon','karthik.menon@aventa.com','role-005','Compliance Officer','active','2026-07-26 11:00:00+00',true,'2026-02-10 09:00:00+00',6),
('ou-007','Rohit Singh','rohit.singh@aventa.com','role-006','Integrations Engineer','active','2026-07-25 09:00:00+00',true,'2026-03-15 09:00:00+00',7),
('ou-008','Divya Joshi','divya.joshi@aventa.com','role-007','Support Agent','active','2026-07-28 05:00:00+00',false,'2026-04-01 09:00:00+00',8),
('ou-009','Sanjay Gupta','sanjay.gupta@aventa.com','role-007','Support Agent','active','2026-07-27 18:00:00+00',false,'2026-04-10 09:00:00+00',9),
('ou-010','Pooja Bhat','pooja.bhat@aventa.com','role-007','Support Agent','active','2026-07-27 12:00:00+00',false,'2026-04-15 09:00:00+00',10),
('ou-011','Farhan Ahmed','farhan.ahmed@aventa.com','role-008','Warehouse Manager','active','2026-07-28 04:00:00+00',false,'2026-03-20 09:00:00+00',11),
('ou-012','Lakshmi Rao','lakshmi.rao@aventa.com','role-009','Collections Officer','active','2026-07-27 15:00:00+00',true,'2026-05-01 09:00:00+00',12),
('ou-013','Deepak Verma','deepak.verma@aventa.com','role-010','Tax & Compliance','active','2026-07-26 10:00:00+00',true,'2026-03-10 09:00:00+00',13),
('ou-014','Nisha Agarwal','nisha.agarwal@aventa.com','role-011','Growth & Promotions','active','2026-07-25 14:00:00+00',false,'2026-04-20 09:00:00+00',14),
('ou-015','Aditya Kapoor','aditya.kapoor@aventa.com','role-012','Security Admin','active','2026-07-28 03:00:00+00',true,'2026-01-25 09:00:00+00',15),
('ou-016','Kavya Krishnan','kavya.krishnan@aventa.com','role-012','Security Admin','active','2026-07-27 20:00:00+00',true,'2026-02-05 09:00:00+00',16),
('ou-017','Manish Tiwari','manish.tiwari@aventa.com','role-013','Read-Only Analyst','active','2026-07-27 10:00:00+00',false,'2026-05-15 09:00:00+00',17)
ON CONFLICT (id) DO NOTHING;

-- 13. operator_promotions
INSERT INTO operator_promotions (id, name, description, effect_type, effect_value, conditions, stacking, priority, budget, spent, status, starts_at, ends_at, sort_order) VALUES
('promo-001','Summer Mega Sale','15% off all devices','percentage',15,'{"categories":["Device"],"min_cart":100}'::jsonb,false,10,5000,3200,'active','2026-07-01','2026-08-31',1),
('promo-002','IoT Bundle Saver','$200 off IoT orders over $1000','fixed',200,'{"categories":["IoT"],"min_cart":1000}'::jsonb,false,20,3000,1450,'active','2026-07-15','2026-09-15',2),
('promo-003','Security First Month Free','1 month free on security subscriptions','free_months',1,'{"categories":["Security"],"buyer_type":"enterprise"}'::jsonb,true,30,2000,800,'active','2026-07-01','2026-12-31',3),
('promo-004','Free Delivery Weekend','Free delivery on all orders','free_delivery',0,'{"days":["sat","sun"]}'::jsonb,true,40,1500,600,'active','2026-07-01','2026-12-31',4),
('promo-005','New Customer 10% Off','10% off first order','percentage',10,'{"first_order":true}'::jsonb,false,50,8000,5400,'active','2026-01-01','2026-12-31',5),
('promo-006','Content Bundle Discount','12 months free on annual content subs','free_months',12,'{"categories":["Digital Content"],"min_cart":50}'::jsonb,false,60,5000,2100,'paused','2026-06-01','2026-09-30',6)
ON CONFLICT (id) DO NOTHING;

-- 14. operator_dunning_cases
INSERT INTO operator_dunning_cases (id, account_name, account_type, amount, age_days, step, step_name, ladder, attempts, reason, collector, promise_to_pay, status, sort_order) VALUES
('dc-001','Priya Raman','consumer',42.00,18,5,'Final notice','consumer',3,'Card expired',null,null,'active',1),
('dc-002','Acme Logistics Ltd','enterprise',14520.00,35,3,'Second reminder','enterprise',2,'PO delay — payment in process','Lakshmi Rao','2026-08-05','active',2),
('dc-003','Rajesh Kumar','consumer',89.99,8,2,'Soft reminder','consumer',1,'Insufficient funds',null,null,'active',3),
('dc-004','TechDyne Devices','seller',3200.00,12,2,'Commission recovery','seller',1,'Commission debt — settlement withheld',null,null,'active',4)
ON CONFLICT (id) DO NOTHING;

-- 15. operator_channels
INSERT INTO operator_channels (id, name, type, transport, protocol, sender, throughput, unit_cost, success_rate, region, has_receipt, is_primary, enabled, note, sort_order) VALUES
('ch-001','SMS Primary','telecom','Route Mobile','SMPP 3.4','AVENTA',1000,0.0045,97.2,'India',true,true,true,'Primary SMS via Route Mobile SMPP gateway',1),
('ch-002','SMS Failover','telecom','Twilio','REST','AVENTA',500,0.0060,95.8,'India',true,false,true,'Failover when primary throughput drops',2),
('ch-003','Email Primary','digital','AWS SES','SMTP','noreply@aventa.com',5000,0.0001,99.1,'global',true,true,true,'Transactional email via SES',3),
('ch-004','Email Failover','digital','SendGrid','API','noreply@aventa.com',3000,0.0002,98.5,'global',true,false,true,'Failover for email delivery',4),
('ch-005','Push Notifications','digital','FCM HTTP v1','REST','aventa-app',10000,0,0,'global',false,true,true,'No true delivery receipt — acceptance only',5),
('ch-006','WhatsApp Business','digital','Meta Graph API','REST','Aventa',800,0.0050,96.0,'India,UAE',true,false,true,'WhatsApp Business Platform',6)
ON CONFLICT (id) DO NOTHING;

-- 16. operator_banners
INSERT INTO operator_banners (id, slot, title, subtitle, cta, audience, region, device, weight, impressions, clicks, revenue, status, starts_at, ends_at, sort_order) VALUES
('bn-001','login','Get 10% off Managed Firewall with Business 5G','Limited time offer for enterprise customers','Learn more','enterprise','India','desktop',70,45200,1850,12400,'active','2026-07-01','2026-08-31',1),
('bn-002','login','StreamNova Sports — 3 months free','New subscriber exclusive','Start watching','consumer','India','all',60,89400,3200,8900,'active','2026-07-15','2026-09-15',2),
('bn-003','storefront_hero','K9 Pro 5G now in stock','The fastest 5G device on the marketplace','Buy now','consumer','India','all',80,62100,4100,28000,'active','2026-07-01','2026-08-15',3),
('bn-004','storefront_strip','IoT Sensor Packs — bulk pricing available','Perfect for fleet deployments','View packs','enterprise','India,UAE','all',50,23400,890,4200,'active','2026-07-01','2026-09-30',4),
('bn-005','category_header','Secure your business with Sentinel MDR','Managed detection and response from $1499/mo','Explore','enterprise','India','desktop',40,15600,620,3400,'active','2026-07-10','2026-10-10',5)
ON CONFLICT (id) DO NOTHING;
