/*
 * The UAE banner had no picture.
 *
 * `bn-008-ae` ("Family safety across the account (UAE)") was copied from
 * `bn-008` in 20260802440000, before banners carried an image, and nothing
 * filled it in afterwards. It is the only banner without one, so the operator's
 * Storefront Banners screen and the storefront showed the empty-picture state.
 * It takes the Indian original's picture and alt text — only where it still
 * has none, so a picture set since is never overwritten.
 *
 * Idempotent, one transaction, self-check last.
 */

begin;

update public.operator_banners ae
   set image_url = src.image_url,
       alt       = coalesce(ae.alt, src.alt)
  from public.operator_banners src
 where ae.id = 'bn-008-ae'
   and src.id = 'bn-008'
   and ae.image_url is null
   and src.image_url is not null;

do $$
<<chk>>
declare
  v_n int;
begin
  select count(*) into v_n from public.operator_banners where image_url is null;
  if v_n <> 0 then
    raise exception '% banners still have no picture', v_n;
  end if;
end $$;

commit;
