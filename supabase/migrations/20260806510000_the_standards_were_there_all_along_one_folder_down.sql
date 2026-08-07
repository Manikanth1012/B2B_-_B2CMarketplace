/* The standards were there all along, one folder down.
 *
 * Settlement and Party loaded 6D's own implementations at v1.0.0 because the
 * files sitting at the top of the reference library under those TMF numbers
 * are 6D services — one of them titled "Create Customer API". The library also
 * carries the real TM Forum documents, filed properly, in
 * `Customer APIs/TMF678-Customer Bill Management API/version5.0` and
 * `Business Partner APIs/TMF632_Party Management API/Version_5.0`.
 *
 * Those are what a developer looking up the standard would find, so those are
 * what the portal publishes. Both are OpenAPI 3.0.1 at 5.0.0 — Party Management
 * with twenty operations, CustomerBill with sixteen — and both now serve from
 * `serverRoot/partyManagement/v5` and `serverRoot` rather than from somebody's
 * laptop.
 *
 * With these two swapped, every published API carries the standard it names and
 * every version is 4.0 or above. The `is_tmf_standard = false` flag and the
 * warnings that hung off it have nothing left to point at — which is the right
 * way for that flag to go quiet: because it was acted on, not because it was
 * removed.
 */

begin;
update api_specs set
  version_id = 'AP-SET@5.0.0', title = 'CustomerBill',
  declared_version = '5.0.0', spec_format = 'OpenAPI 3.0.1',
  servers = array['https://serverRoot']::text[], file_path = '/specs/tmf678-customer-bill-management.yaml', file_bytes = 146403,
  sha256 = '661587c5d236e364', source_file = 'TMF678-CustomerBill-v5.0.0.oas_Open API specification.yaml',
  drive_file_id = '1f0aLedERqfXI4OC4dnkbevosxHFNbyQG', retrieved_on = current_date,
  operation_count = 16, is_tmf_standard = true, note = null,
  operations = '[{"method": "GET", "path": "/appliedCustomerBillingRate", "summary": "List or find AppliedCustomerBillingRate objects", "description": "List or find AppliedCustomerBillingRate objects", "operationId": "listAppliedCustomerBillingRate", "tag": "appliedCustomerBillingRate"}, {"method": "GET", "path": "/appliedCustomerBillingRate/{id}", "summary": "Retrieves a AppliedCustomerBillingRate by ID", "description": "This operation retrieves a AppliedCustomerBillingRate entity. Attribute selection enabled for all first level attributes.", "operationId": "retrieveAppliedCustomerBillingRate", "tag": "appliedCustomerBillingRate"}, {"method": "GET", "path": "/billCycle", "summary": "List or find BillCycle objects", "description": "List or find BillCycle objects", "operationId": "listBillCycle", "tag": "billCycle"}, {"method": "GET", "path": "/billCycle/{id}", "summary": "Retrieves a BillCycle by ID", "description": "This operation retrieves a BillCycle entity. Attribute selection enabled for all first level attributes.", "operationId": "retrieveBillCycle", "tag": "billCycle"}, {"method": "GET", "path": "/customerBill", "summary": "List or find CustomerBill objects", "description": "List or find CustomerBill objects", "operationId": "listCustomerBill", "tag": "customerBill"}, {"method": "GET", "path": "/customerBill/{id}", "summary": "Retrieves a CustomerBill by ID", "description": "This operation retrieves a CustomerBill entity. Attribute selection enabled for all first level attributes.", "operationId": "retrieveCustomerBill", "tag": "customerBill"}, {"method": "PATCH", "path": "/customerBill/{id}", "summary": "Updates partially a CustomerBill", "description": "This operation updates partially a CustomerBill entity.", "operationId": "patchCustomerBill", "tag": "customerBill"}, {"method": "GET", "path": "/customerBillOnDemand", "summary": "List or find CustomerBillOnDemand objects", "description": "List or find CustomerBillOnDemand objects", "operationId": "listCustomerBillOnDemand", "tag": "customerBillOnDemand"}, {"method": "POST", "path": "/customerBillOnDemand", "summary": "Creates a CustomerBillOnDemand", "description": "This operation creates a CustomerBillOnDemand entity.", "operationId": "createCustomerBillOnDemand", "tag": "customerBillOnDemand"}, {"method": "GET", "path": "/customerBillOnDemand/{id}", "summary": "Retrieves a CustomerBillOnDemand by ID", "description": "This operation retrieves a CustomerBillOnDemand entity. Attribute selection enabled for all first level attributes.", "operationId": "retrieveCustomerBillOnDemand", "tag": "customerBillOnDemand"}, {"method": "POST", "path": "/hub", "summary": "Create a subscription (hub) to receive Events", "description": "Sets the communication endpoint to receive Events.", "operationId": "createHub", "tag": "events subscription"}, {"method": "DELETE", "path": "/hub/{id}", "summary": "Remove a subscription (hub) to receive Events", "description": "", "operationId": "hubDelete", "tag": "events subscription"}, {"method": "POST", "path": "/listener/customerBillCreateEvent", "summary": "Client listener for entity CustomerBillCreateEvent", "description": "Example of a client listener for receiving the notification CustomerBillCreateEvent", "operationId": "customerBillCreateEvent", "tag": "notification listener"}, {"method": "POST", "path": "/listener/customerBillOnDemandCreateEvent", "summary": "Client listener for entity CustomerBillOnDemandCreateEvent", "description": "Example of a client listener for receiving the notification CustomerBillOnDemandCreateEvent", "operationId": "customerBillOnDemandCreateEvent", "tag": "notification listener"}, {"method": "POST", "path": "/listener/customerBillOnDemandStateChangeEvent", "summary": "Client listener for entity CustomerBillOnDemandStateChangeEvent", "description": "Example of a client listener for receiving the notification CustomerBillOnDemandStateChangeEvent", "operationId": "customerBillOnDemandStateChangeEvent", "tag": "notification listener"}, {"method": "POST", "path": "/listener/customerBillStateChangeEvent", "summary": "Client listener for entity CustomerBillStateChangeEvent", "description": "Example of a client listener for receiving the notification CustomerBillStateChangeEvent", "operationId": "customerBillStateChangeEvent", "tag": "notification listener"}]'::jsonb
 where api_id = 'AP-SET';

update api_specs set
  version_id = 'AP-PTY@5.0.0', title = 'Party Management',
  declared_version = '5.0.0', spec_format = 'OpenAPI 3.0.1',
  servers = array['https://serverRoot/partyManagement/v5/']::text[], file_path = '/specs/tmf632-party-management.yaml', file_bytes = 274757,
  sha256 = '629e0236773c10dd', source_file = 'TMF632-Party_Management-v5.0.0.oas.yaml',
  drive_file_id = '1KcQGP05M5Tq6A4hNuHduCTd7rjnd-Jbp', retrieved_on = current_date,
  operation_count = 20, is_tmf_standard = true, note = null,
  operations = '[{"method": "POST", "path": "/hub", "summary": "Create a subscription (hub) to receive Events", "description": "Sets the communication endpoint to receive Events.", "operationId": "createHub", "tag": "events subscription"}, {"method": "DELETE", "path": "/hub/{id}", "summary": "Remove a subscription (hub) to receive Events", "description": "", "operationId": "hubDelete", "tag": "events subscription"}, {"method": "GET", "path": "/individual", "summary": "List or find Individual objects", "description": "List or find Individual objects", "operationId": "listIndividual", "tag": "individual"}, {"method": "POST", "path": "/individual", "summary": "Creates a Individual", "description": "This operation creates a Individual entity.", "operationId": "createIndividual", "tag": "individual"}, {"method": "DELETE", "path": "/individual/{id}", "summary": "Deletes a Individual", "description": "This operation deletes a Individual entity.", "operationId": "deleteIndividual", "tag": "individual"}, {"method": "GET", "path": "/individual/{id}", "summary": "Retrieves a Individual by ID", "description": "This operation retrieves a Individual entity. Attribute selection enabled for all first level attributes.", "operationId": "retrieveIndividual", "tag": "individual"}, {"method": "PATCH", "path": "/individual/{id}", "summary": "Updates partially a Individual", "description": "This operation updates partially a Individual entity.", "operationId": "patchIndividual", "tag": "individual"}, {"method": "POST", "path": "/listener/individualAttributeValueChangeEvent", "summary": "Client listener for entity IndividualAttributeValueChangeEvent", "description": "Example of a client listener for receiving the notification IndividualAttributeValueChangeEvent", "operationId": "individualAttributeValueChangeEvent", "tag": "notification listener"}, {"method": "POST", "path": "/listener/individualCreateEvent", "summary": "Client listener for entity IndividualCreateEvent", "description": "Example of a client listener for receiving the notification IndividualCreateEvent", "operationId": "individualCreateEvent", "tag": "notification listener"}, {"method": "POST", "path": "/listener/individualDeleteEvent", "summary": "Client listener for entity IndividualDeleteEvent", "description": "Example of a client listener for receiving the notification IndividualDeleteEvent", "operationId": "individualDeleteEvent", "tag": "notification listener"}, {"method": "POST", "path": "/listener/individualStateChangeEvent", "summary": "Client listener for entity IndividualStateChangeEvent", "description": "Example of a client listener for receiving the notification IndividualStateChangeEvent", "operationId": "individualStateChangeEvent", "tag": "notification listener"}, {"method": "POST", "path": "/listener/organizationAttributeValueChangeEvent", "summary": "Client listener for entity OrganizationAttributeValueChangeEvent", "description": "Example of a client listener for receiving the notification OrganizationAttributeValueChangeEvent", "operationId": "organizationAttributeValueChangeEvent", "tag": "notification listener"}, {"method": "POST", "path": "/listener/organizationCreateEvent", "summary": "Client listener for entity OrganizationCreateEvent", "description": "Example of a client listener for receiving the notification OrganizationCreateEvent", "operationId": "organizationCreateEvent", "tag": "notification listener"}, {"method": "POST", "path": "/listener/organizationDeleteEvent", "summary": "Client listener for entity OrganizationDeleteEvent", "description": "Example of a client listener for receiving the notification OrganizationDeleteEvent", "operationId": "organizationDeleteEvent", "tag": "notification listener"}, {"method": "POST", "path": "/listener/organizationStateChangeEvent", "summary": "Client listener for entity OrganizationStateChangeEvent", "description": "Example of a client listener for receiving the notification OrganizationStateChangeEvent", "operationId": "organizationStateChangeEvent", "tag": "notification listener"}, {"method": "GET", "path": "/organization", "summary": "List or find Organization objects", "description": "List or find Organization objects", "operationId": "listOrganization", "tag": "organization"}, {"method": "POST", "path": "/organization", "summary": "Creates a Organization", "description": "This operation creates a Organization entity.", "operationId": "createOrganization", "tag": "organization"}, {"method": "DELETE", "path": "/organization/{id}", "summary": "Deletes a Organization", "description": "This operation deletes a Organization entity.", "operationId": "deleteOrganization", "tag": "organization"}, {"method": "GET", "path": "/organization/{id}", "summary": "Retrieves a Organization by ID", "description": "This operation retrieves a Organization entity. Attribute selection enabled for all first level attributes.", "operationId": "retrieveOrganization", "tag": "organization"}, {"method": "PATCH", "path": "/organization/{id}", "summary": "Updates partially a Organization", "description": "This operation updates partially a Organization entity.", "operationId": "patchOrganization", "tag": "organization"}]'::jsonb
 where api_id = 'AP-PTY';
update api_versions set version = '5.0.0', base_path = '/tmf-api/customerBillManagement/v5'
 where id = 'AP-SET@1.0.0';
update api_versions set version = '5.0.0', base_path = '/tmf-api/partyManagement/v5'
 where id = 'AP-PTY@1.0.0';

alter table api_endpoints drop constraint api_endpoints_version_id_fkey;
alter table operator_api_subscriptions drop constraint operator_api_subscriptions_version_id_fkey;

update api_versions set id = 'AP-SET@5.0.0' where id = 'AP-SET@1.0.0';
update api_versions set id = 'AP-PTY@5.0.0' where id = 'AP-PTY@1.0.0';
update api_endpoints set version_id = 'AP-SET@5.0.0' where version_id = 'AP-SET@1.0.0';
update api_endpoints set version_id = 'AP-PTY@5.0.0' where version_id = 'AP-PTY@1.0.0';
update operator_api_subscriptions set version_id = 'AP-SET@5.0.0', version = '5.0.0' where version_id = 'AP-SET@1.0.0';
update operator_api_subscriptions set version_id = 'AP-PTY@5.0.0', version = '5.0.0' where version_id = 'AP-PTY@1.0.0';
update api_call_log set version_id = 'AP-SET@5.0.0' where version_id = 'AP-SET@1.0.0';
update api_call_log set version_id = 'AP-PTY@5.0.0' where version_id = 'AP-PTY@1.0.0';

alter table api_endpoints add constraint api_endpoints_version_id_fkey
  foreign key (version_id) references api_versions(id) on delete cascade;
alter table operator_api_subscriptions add constraint operator_api_subscriptions_version_id_fkey
  foreign key (version_id) references api_versions(id);

do $$
declare bad text; n int;
begin
  select string_agg(tmf || ' (' || title || ' ' || declared_version || ')', ', ') into bad
    from api_specs where not is_tmf_standard;
  if bad is not null then
    raise exception 'still publishing something that is not the standard it names: %', bad;
  end if;

  select string_agg(v.id || ' = ' || v.version, ', ') into bad from api_versions v
   where split_part(v.version, '.', 1)::int < 4;
  if bad is not null then raise exception 'versions still below 4.0: %', bad; end if;

  select string_agg(s.tmf, ', ') into bad from api_specs s
   where not exists (select 1 from api_versions v where v.id = s.version_id);
  if bad is not null then raise exception 'specifications attached to no version: %', bad; end if;

  select sum(operation_count) into n from api_specs;
  if n < 140 then raise exception 'only % operations across the seven specifications', n; end if;
end $$;

commit;
