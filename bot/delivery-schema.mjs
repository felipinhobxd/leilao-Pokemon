export async function assertDeliverySchema(db) {
  const { data, error } = await db.rpc('bot_delivery_revision');
  if (error && !['PGRST202','42883'].includes(error.code)) throw error;
  if (error || data !== 2) {
    throw Object.assign(new Error('Instale as migrations 20261028190535 e 20261028192328 antes de iniciar o bot 0.2.23 e depois use Reconectar.'), { code: 'delivery_schema_missing' });
  }
}
