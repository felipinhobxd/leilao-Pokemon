export async function assertDeliverySchema(db) {
  const { data, error } = await db.rpc('bot_delivery_revision');
  if (error && !['PGRST202','42883'].includes(error.code)) throw error;
  if (error || data !== 1) {
    throw Object.assign(new Error('Instale a migration 20261028190535 antes de iniciar o bot 0.2.22 e depois use Reconectar.'), { code: 'delivery_schema_missing' });
  }
}
