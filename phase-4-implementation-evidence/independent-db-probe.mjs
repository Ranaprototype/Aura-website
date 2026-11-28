/**
 * Independent Phase 4 DB security probe (verification tooling, NOT implementation).
 * Reconstructed after the sandbox restore dropped gitignored artifacts. Loads the
 * real migration ledger into disposable PGlite engines and asserts the security
 * posture + publication boundary + four-eyes + note confidentiality + limiter
 * isolation + 0009 determinism/rollback. Output is preserved as evidence.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const DIR = "supabase/migrations";
const files = (await readdir(DIR)).filter(f => f.endsWith(".sql")).sort();
const sql = Object.fromEntries(
  await Promise.all(files.map(async f => [f, await readFile(path.join(DIR, f), "utf8")]))
);
const upto = name => files.slice(0, files.indexOf(name) + 1);

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}${detail ? " — " + detail : ""}`); }
};

async function fresh(last = files[files.length - 1]) {
  const e = new PGlite();
  await e.waitReady;
  for (const f of upto(last)) await e.exec(sql[f]);
  return e;
}
const one = async (e, q, p) => (await e.query(q, p)).rows[0];
const val = async (e, q, p) => Object.values((await e.query(q, p)).rows[0])[0];

// Run as the restricted runtime role with a bound principal (transaction-local).
async function asApp(e, principal, org, fn) {
  await e.exec("begin");
  await e.exec("set local role aura_app");
  if (principal) await e.query("select set_config('aura.principal_id',$1,true)", [principal]);
  if (org) {
    await e.query("select set_config('aura.org_id',$1,true)", [org]);
    await e.query("select set_config('aura.role',$1,true)", ["owner"]);
  }
  try { const r = await fn(); await e.exec("commit"); return r; }
  catch (err) { await e.exec("rollback"); throw err; }
}
async function asPublic(e, fn) {
  await e.exec("begin");
  await e.exec("set local role aura_public");
  try { const r = await fn(); await e.exec("commit"); return r; }
  catch (err) { await e.exec("rollback"); throw err; }
}
const expectError = async (fn, pattern) => {
  try { await fn(); return false; }
  catch (err) { return pattern.test(String(err.message || err)); }
};

// ---------------------------------------------------------------------------
// Engine 1: full ledger replayed twice (replay safety) + behavioural fixtures.
// ---------------------------------------------------------------------------
const e = await fresh();
for (const f of files) await e.exec(sql[f]); // second replay

const VIEWS = ["public_products", "public_product_variants", "public_product_media", "public_product_attributes", "public_slug_redirects"];

// 1. aura_public SELECT denied on every base table (the isolated limiter table is
//    the single intentional grant and is verified separately in 12/12b).
const baseTables = (await e.query(
  `select c.oid, c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='aura' and c.relkind='r' order by c.relname`)).rows;
const checked = baseTables.filter(t => t.relname !== "public_rate_limits");
const leaks = [];
for (const t of checked)
  if (await val(e, `select has_table_privilege('aura_public',$1::oid,'SELECT')`, [t.oid])) leaks.push(t.relname);
check("1 aura_public SELECT denied on every base table", leaks.length === 0, `leaks: ${leaks.join(",")}`);
console.log(`     (checked ${checked.length} base tables)`);

// 2 / 2b. View grants.
let viewsOk = true;
for (const v of VIEWS)
  if (!(await val(e, `select has_table_privilege('aura_public',$1,'SELECT')`, [`aura.${v}`]))) viewsOk = false;
check("2 aura_public SELECT on all 5 definer views", viewsOk);
check("2b aura_public NOT granted storefront_products",
  !(await val(e, `select has_table_privilege('aura_public','aura.storefront_products','SELECT')`)));

// 3. Zero EXECUTE for aura_public on aura functions.
check("3 aura_public EXECUTE on zero aura functions",
  (await val(e, `select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='aura' and has_function_privilege('aura_public',p.oid,'EXECUTE')`)) === 0);

// 4 / 4b / 4c. Ownership + invoker flags.
let ownedOk = true;
for (const v of VIEWS)
  if ((await val(e, `select pg_get_userbyid(relowner) from pg_class where relname=$1`, [v])) !== "aura_catalog_owner") ownedOk = false;
check("4 all public views owned by aura_catalog_owner", ownedOk);
const ppOpts = (await one(e, `select reloptions from pg_class where relname='public_products'`)).reloptions;
check("4b public_products has no security_invoker (definer)",
  !ppOpts || !ppOpts.includes("security_invoker=true"));
const sfOpts = (await one(e, `select reloptions from pg_class where relname='storefront_products'`)).reloptions;
check("4c storefront_products security_invoker=true", !!sfOpts && sfOpts.includes("security_invoker=true"));

// 5 / 5b. Owner role attributes + base-table ownership.
const owner = await one(e, `select rolsuper, rolbypassrls, rolcanlogin from pg_roles where rolname='aura_catalog_owner'`);
check("5 catalog owner NOSUPERUSER/NOBYPASSRLS/NOLOGIN",
  owner && !owner.rolsuper && !owner.rolbypassrls && !owner.rolcanlogin);
let baseOwnedOk = true;
for (const t of ["products", "product_variants", "product_media", "product_attribute_values", "categories", "category_attributes", "seller_profiles", "slug_redirects"])
  if ((await val(e, `select pg_get_userbyid(relowner) from pg_class where relname=$1`, [t])) !== "aura_catalog_owner") baseOwnedOk = false;
check("5b catalog owner owns every base table the views read", baseOwnedOk);

// 6. Accessor posture.
const acc = await one(e, `select prosecdef, proconfig from pg_proc where proname='seller_suspension_note'`);
check("6 accessor SECURITY DEFINER + pinned search_path + app-only",
  acc.prosecdef && (acc.proconfig || []).some(c => c.startsWith("search_path=pg_catalog, aura")) &&
  (await val(e, `select has_function_privilege('aura_app','aura.seller_suspension_note(uuid)','EXECUTE')`)) &&
  !(await val(e, `select has_function_privilege('aura_public','aura.seller_suspension_note(uuid)','EXECUTE')`)) &&
  !(await val(e, `select has_function_privilege('public','aura.seller_suspension_note(uuid)','EXECUTE')`)));

// 7. No FORCE RLS.
check("7 no FORCE ROW LEVEL SECURITY on aura tables",
  (await val(e, `select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='aura' and c.relkind='r' and c.relforcerowsecurity`)) === 0);

// ---- Behavioural fixtures (seed as superuser with user triggers disabled) ----
const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VIEWER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OPERATOR = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const INSIDER = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const ORG = "11111111-1111-4111-8111-111111111111";
const NOTE = "Confidential suspension reason — do not leak.";
await e.exec(`alter table aura.seller_profiles disable trigger user;
  alter table aura.products disable trigger user;
  alter table aura.product_revisions disable trigger user;`);
await e.query(`insert into aura.principals (id, issuer, subject, email, display_name) values
  ($1,'probe','owner','owner@probe.test','Owner'),
  ($2,'probe','viewer','viewer@probe.test','Viewer'),
  ($3,'probe','operator','operator@probe.test','Operator'),
  ($4,'probe','insider','insider@probe.test','Insider')`, [OWNER, VIEWER, OPERATOR, INSIDER]);
await e.query(`insert into aura.organizations (id, name, slug, created_by) values ($1,'Probe Org','probe-org',$2)`, [ORG, OWNER]);
await e.query(`insert into aura.memberships (org_id, principal_id, role) values
  ($1,$2,'owner'),($1,$3,'viewer'),($1,$4,'owner')`, [ORG, OWNER, VIEWER, INSIDER]);
await e.query(`insert into aura.platform_admins (principal_id, note) values ($1,'probe'),($2,'probe')`, [OPERATOR, INSIDER]);
const cat = await val(e, `select id from aura.categories where slug='sneakers'`);
const seller = await val(e, `insert into aura.seller_profiles
  (org_id, display_name, legal_name, business_email, country, status, reviewed_at, reviewed_by, created_by)
  values ($1,'Probe Seller','Probe Legal LLC','seller@probe.test','US','approved',now(),$2,$3) returning id`, [ORG, OPERATOR, OWNER]);
const prod = await val(e, `insert into aura.products
  (org_id, seller_profile_id, category_id, slug, title, status, created_by)
  values ($1,$2,$3,'probe-product','Probe Product','draft',$4) returning id`, [ORG, seller, cat, OWNER]);
const rev = await val(e, `insert into aura.product_revisions
  (product_id, org_id, revision_number, snapshot, submitted_by, decision, reviewed_by, reviewed_at)
  values ($1,$2,1,'{}'::jsonb,$3,'approved',$4,now()) returning id`, [prod, ORG, OWNER, OPERATOR]);
await e.query(`update aura.products set status='approved', approved_at=now(), pending_changes=false, approved_revision_id=$1 where id=$2`, [rev, prod]);
await e.exec(`alter table aura.seller_profiles enable trigger user;
  alter table aura.products enable trigger user;
  alter table aura.product_revisions enable trigger user;`);

// 8 / 8b. Publication boundary + direct base SELECT denial.
check("8 public_products shows only approved+published",
  (await asPublic(e, () => val(e, `select count(*)::int from aura.public_products where slug='probe-product'`))) === 1);
check("8b direct base SELECT as aura_public denied",
  await expectError(() => asPublic(e, () => e.query(`select * from aura.products`)), /permission denied/));

// 10b. Four-eyes blocks insider SUSPEND (insider is a member + platform admin).
check("10b four-eyes blocks insider SUSPEND",
  await expectError(() => asApp(e, INSIDER, ORG, () =>
    e.query(`update aura.seller_profiles set suspended_at=now(), suspension_note=$1 where org_id=$2`, [NOTE, ORG])),
    /review_separation_required/));

// 9. Operator (non-member admin) suspends; product vanishes from public.
await asApp(e, OPERATOR, null, () =>
  e.query(`update aura.seller_profiles set suspended_at=now(), suspension_note=$1 where org_id=$2`, [NOTE, ORG]));
check("9 suspended seller's product hidden from public",
  (await asPublic(e, () => val(e, `select count(*)::int from aura.public_products where slug='probe-product'`))) === 0);

// 10. Four-eyes blocks insider RESTORE.
check("10 four-eyes blocks insider RESTORE",
  await expectError(() => asApp(e, INSIDER, ORG, () =>
    e.query(`update aura.seller_profiles set suspended_at=null where org_id=$1`, [ORG])),
    /review_separation_required/));

// 11 / 11b / 11c / 11d. Note confidentiality.
check("11 owner reads confidential note via accessor",
  (await asApp(e, OWNER, ORG, () => val(e, `select aura.seller_suspension_note($1)`, [ORG]))) === NOTE);
check("11b viewer denied note accessor",
  await expectError(() => asApp(e, VIEWER, ORG, () => val(e, `select aura.seller_suspension_note($1)`, [ORG])), /forbidden/));
check("11c aura_public cannot execute note accessor",
  await expectError(() => asPublic(e, () => val(e, `select aura.seller_suspension_note($1)`, [ORG])), /permission denied/));
const auditDetail = await val(e, `select detail::text from aura.audit_events where entity_type='seller_profile' and action='seller.suspended' order by created_at desc limit 1`);
check("11d suspension note text absent from audit", !auditDetail.includes(NOTE) && auditDetail.includes("noteRecorded"));

// 12 / 12b. Limiter isolation.
check("12 PUBLIC role has no privilege on public_rate_limits",
  !(await val(e, `select has_table_privilege('public','aura.public_rate_limits','SELECT')`)));
let limiterOk = true;
try {
  await asPublic(e, async () => {
    await e.query(`insert into aura.public_rate_limits (bucket, window_start, hits) values ('sf:probe', date_trunc('minute', now()), 1)`);
    await e.query(`update aura.public_rate_limits set hits=hits+1 where bucket='sf:probe'`);
    await e.query(`delete from aura.public_rate_limits where bucket='sf:probe'`);
  });
} catch { limiterOk = false; }
check("12b aura_public (server pool) CRUD on limiter works", limiterOk);
await e.close();

// ---------------------------------------------------------------------------
// Engine 2: 0009 determinism + rollback (seed a cross-org slug collision).
// ---------------------------------------------------------------------------
const e2 = await fresh("0008_public_storefront.sql");
const cat2 = await val(e2, `select id from aura.categories where slug='sneakers'`);
const OX = "22222222-2222-4222-8222-222222222222";
const OY = "33333333-3333-4333-8333-333333333333";
const PX = "44444444-4444-4444-8444-444444444444";
const PY = "55555555-5555-4555-8555-555555555555";
await e2.exec(`alter table aura.seller_profiles disable trigger user; alter table aura.products disable trigger user;`);
await e2.query(`insert into aura.principals (id, issuer, subject, email, display_name) values ($1,'probe','c','c@probe.test','C')`, [OWNER]);
for (const [org, slugOrg] of [[OX, "org-x"], [OY, "org-y"]]) {
  await e2.query(`insert into aura.organizations (id, name, slug, created_by) values ($1,$2,$3,$4)`, [org, slugOrg, slugOrg, OWNER]);
  const s = await val(e2, `insert into aura.seller_profiles (org_id, display_name, legal_name, business_email, country, created_by)
    values ($1,'S','L',$2,'US',$3) returning id`, [org, `${slugOrg}@probe.test`, OWNER]);
  await e2.query(`insert into aura.products (org_id, seller_profile_id, category_id, slug, title, created_by, created_at)
    values ($1,$2,$3,'shared-slug','Shared',$4, now() - interval '1 day')`, [org, s, cat2, OWNER]);
}
// Make OX the earliest (keeps slug), OY later (renamed).
await e2.query(`update aura.products set created_at = now() - interval '2 days' where org_id=$1`, [OX]);
await e2.query(`update aura.products set id=$1 where org_id=$2`, [PY, OY]);
await e2.exec(`alter table aura.seller_profiles enable trigger user; alter table aura.products enable trigger user;`);
const idY = await val(e2, `select id from aura.products where org_id=$1`, [OY]);
await e2.exec(sql["0009_global_product_slugs.sql"]);

check("13 earliest product keeps slug deterministically",
  (await val(e2, `select slug from aura.products where org_id=$1`, [OX])) === "shared-slug");
const expectedY = `shared-slug-${idY.slice(0, 8)}`;
check("13b later product renamed with id-derived suffix",
  (await val(e2, `select slug from aura.products where org_id=$1`, [OY])) === expectedY);
check("13c collision redirect recorded",
  (await val(e2, `select count(*)::int from aura.slug_redirects where reason='global_collision' and slug='shared-slug' and replacement_slug=$1`, [expectedY])) === 1);
check("13d global unique index present",
  (await val(e2, `select count(*)::int from pg_indexes where schemaname='aura' and indexname='products_slug_global_key'`)) === 1);
await e2.exec(sql["0009_global_product_slugs.sql"]); // replay
check("13e 0009 replay does not rename again",
  (await val(e2, `select slug from aura.products where org_id=$1`, [OY])) === expectedY);

const rollback = await readFile("supabase/rollback/rollback_0009_global_product_slugs.sql", "utf8");
await e2.exec(rollback);
check("14 rollback restores original slug",
  (await val(e2, `select slug from aura.products where org_id=$1`, [OY])) === "shared-slug");
check("14b rollback removes only collision redirects",
  (await val(e2, `select count(*)::int from aura.slug_redirects where reason='global_collision'`)) === 0);

// Drift: re-apply 0009, change the renamed slug, then rollback must abort.
await e2.exec(sql["0009_global_product_slugs.sql"]);
await e2.exec(`alter table aura.products disable trigger user;`);
await e2.query(`update aura.products set slug='drifted-slug' where org_id=$1`, [OY]);
await e2.exec(`alter table aura.products enable trigger user;`);
check("14c rollback aborts on drift (no silent data loss)",
  await expectError(() => e2.exec(rollback), /slug_redirect_rollback_conflict/));
check("14d drifted slug untouched after aborted rollback",
  (await val(e2, `select slug from aura.products where org_id=$1`, [OY])) === "drifted-slug");
await e2.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
