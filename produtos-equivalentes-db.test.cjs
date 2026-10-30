const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const fs = require('node:fs');

test('produto equivalente preserva pedidos e histórico e pode ser revertido', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table public.produtos(id bigint primary key, nome text);
      create table public.itens_pedido(id bigint primary key, produto_id bigint references public.produtos(id));
      create table public.historico_precos(id bigint primary key, produto_id bigint references public.produtos(id));
      insert into public.produtos values (1, 'Principal'), (2, 'Duplicado');
      insert into public.itens_pedido values (1, 2);
      insert into public.historico_precos values (1, 2);`);
    await db.exec(fs.readFileSync('supabase/migrations/20261030182342_produtos_equivalentes.sql', 'utf8'));
    await db.exec('update public.produtos set produto_principal_id=1 where id=2');
    assert.equal((await db.query('select produto_id from public.itens_pedido')).rows[0].produto_id, 2);
    assert.equal((await db.query('select produto_id from public.historico_precos')).rows[0].produto_id, 2);
    await assert.rejects(db.exec('update public.produtos set produto_principal_id=2 where id=2'));
    await db.exec('update public.produtos set produto_principal_id=null where id=2');
    assert.equal((await db.query('select produto_principal_id from public.produtos where id=2')).rows[0].produto_principal_id, null);
  } finally { await db.close(); }
});
