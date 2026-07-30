-- Preferred language, time zone and data units on the consumer profile.
--
-- The prototype's My Details carries a three-up preferences grid — language, time
-- zone, data units — sitting above the sign-in and security block. None of it existed
-- here, so a customer had no way to say what language to talk to them in.
--
-- Defaults rather than nulls: everyone has an effective language whether or not they
-- have chosen one, and a null would make every screen decide what to fall back to.

alter table consumer_profile add column if not exists preferred_language text not null default 'English';
alter table consumer_profile add column if not exists time_zone          text not null default 'Asia/Kolkata (IST)';
alter table consumer_profile add column if not exists data_units         text not null default 'GB';

comment on column consumer_profile.preferred_language is
  'What to write to this customer in. Bills, notifications and support replies follow it.';

-- Checked in the database as well as the form. The picker cannot currently produce
-- anything else, but nothing stops a direct PATCH through PostgREST, and a language
-- nobody can render is worse than a rejected write.
alter table consumer_profile drop constraint if exists consumer_profile_language_check;
alter table consumer_profile add constraint consumer_profile_language_check
  check (preferred_language in ('English', 'हिन्दी', 'العربية', 'Kiswahili'));

alter table consumer_profile drop constraint if exists consumer_profile_units_check;
alter table consumer_profile add constraint consumer_profile_units_check
  check (data_units in ('GB', 'MB'));

-- The marketplace states three regions on its own landing page — India, UAE and Kenya
-- — so the languages are those regions' and the zones include Nairobi. The prototype
-- listed English only and omitted Nairobi; a one-option picker is not a preference,
-- and a Kenyan customer with no Kenyan time zone is a gap rather than a decision.
